import {
  classifyGitHubDispatchStatus,
  isSafeAutomationRunId,
} from "../../../src/lib/automationPipeline.ts";
import { deliverPendingAutomationFailureAlerts } from "../_shared/automationAlerts.ts";
import { env, serviceClient } from "../_shared/http.ts";

const GITHUB_DISPATCH_URL = "https://api.github.com/repos/Lixxontech001/lixxonstudio/actions/workflows/automation.yml/dispatches";
const MAX_BODY_BYTES = 256;
const DISPATCH_TIMEOUT_MS = 8_000;
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

type DispatchErrorCode =
  | "GITHUB_TOKEN_MISSING"
  | "GITHUB_AUTH"
  | "GITHUB_FORBIDDEN"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_UNAVAILABLE"
  | "GITHUB_UNEXPECTED"
  | "GITHUB_NETWORK_ERROR";

type ClaimedRun = { run_id: string };

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "X-Content-Type-Options": "nosniff" },
  });
}

async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* Never inspect provider response bodies. */ }
}

async function readBounded(req: Request): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function classifyDispatchError(status: number): DispatchErrorCode {
  switch (classifyGitHubDispatchStatus(status)) {
    case "auth": return "GITHUB_AUTH";
    case "forbidden": return "GITHUB_FORBIDDEN";
    case "rate_limited": return "GITHUB_RATE_LIMITED";
    case "unavailable": return "GITHUB_UNAVAILABLE";
    case "unexpected": return "GITHUB_UNEXPECTED";
    case "dispatched": return "GITHUB_UNEXPECTED";
  }
}

async function recordDispatch(
  sb: ReturnType<typeof serviceClient>,
  runId: string,
  result: "dispatched" | "failed",
  errorCode: DispatchErrorCode | null,
  httpStatus: number | null,
): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("automation_record_daily_dispatch", {
      p_run_id: runId,
      p_result: result,
      p_safe_error_code: errorCode,
      p_http_status: httpStatus,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

async function getDispatchCredential(sb: ReturnType<typeof serviceClient>): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: "github_dispatch_token" });
    return !error && typeof data === "string" && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

export async function handleAutomationScheduler(req: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "JSON request required." }, 415);
  }
  const expectedSecret = env("INTERNAL_FN_SECRET");
  const suppliedSecret = req.headers.get("x-internal-secret") || "";
  if (!expectedSecret || !suppliedSecret || !safeEqual(suppliedSecret, expectedSecret)) {
    return json({ error: "Internal scheduler authorization required." }, 401);
  }
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
  const rawBody = await readBounded(req);
  if (rawBody === null) return json({ error: "Request too large or unreadable." }, 413);
  let payload: unknown;
  try { payload = JSON.parse(rawBody || "{}"); } catch { return json({ error: "Invalid request body." }, 400); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 0) {
    return json({ error: "Only an empty scheduler request is accepted." }, 400);
  }

  let sb: ReturnType<typeof serviceClient>;
  try { sb = serviceClient(); } catch { return json({ error: "Automation scheduler is unavailable." }, 503); }

  let claims: ClaimedRun[];
  try {
    const { data, error } = await sb.rpc("automation_claim_daily_runs");
    if (error || !Array.isArray(data)) return json({ error: "Daily pipeline claim failed safely." }, 503);
    claims = (data as ClaimedRun[]).filter(row => row && isSafeAutomationRunId(row.run_id)).slice(0, 2);
  } catch {
    return json({ error: "Daily pipeline claim failed safely." }, 503);
  }
  // Failures are claimed transactionally in SQL, including preflight failures that
  // did not produce a GitHub dispatch claim. Delivery is email-first with Telegram fallback.
  await deliverPendingAutomationFailureAlerts(sb, fetcher);
  if (claims.length === 0) return json({ status: "idle", claimed: 0, dispatched: 0 });

  let githubToken = await getDispatchCredential(sb);
  if (!githubToken) {
    let recorded = 0;
    for (const claim of claims) {
      if (await recordDispatch(sb, claim.run_id, "failed", "GITHUB_TOKEN_MISSING", null)) recorded += 1;
    }
    await deliverPendingAutomationFailureAlerts(sb, fetcher);
    return json({ status: "blocked", claimed: claims.length, dispatched: 0, recorded, error_code: "GITHUB_TOKEN_MISSING" });
  }

  let dispatched = 0;
  let failed = 0;
  let recordFailures = 0;
  for (const claim of claims) {
    let result: "dispatched" | "failed" = "failed";
    let errorCode: DispatchErrorCode | null = "GITHUB_NETWORK_ERROR";
    let httpStatus: number | null = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
    try {
      const response = await fetcher(GITHUB_DISPATCH_URL, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        // Article title, body, secret and capability are deliberately absent.
        body: JSON.stringify({ ref: "main", inputs: { run_id: claim.run_id } }),
      });
      httpStatus = response.status;
      if (response.status === 204) {
        result = "dispatched";
        errorCode = null;
        await discard(response);
      } else {
        errorCode = classifyDispatchError(response.status);
        await discard(response);
      }
    } catch {
      errorCode = controller.signal.aborted ? "GITHUB_UNAVAILABLE" : "GITHUB_NETWORK_ERROR";
      httpStatus = null;
    } finally {
      clearTimeout(timeout);
    }

    if (!await recordDispatch(sb, claim.run_id, result, errorCode, httpStatus)) {
      recordFailures += 1;
      failed += 1;
    } else if (result === "dispatched") {
      dispatched += 1;
    } else {
      failed += 1;
    }
  }
  githubToken = null;
  await deliverPendingAutomationFailureAlerts(sb, fetcher);
  return json({
    status: failed === 0 ? "dispatched" : dispatched > 0 ? "partial" : "blocked",
    claimed: claims.length,
    dispatched,
    failed,
    record_failures: recordFailures,
  });
}

Deno.serve((req: Request) => handleAutomationScheduler(req));
