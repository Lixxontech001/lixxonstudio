/**
 * Owner-only Web Push endpoint.
 *
 * Actions:
 *   config — returns the VAPID *public* key and contact subject so the browser
 *            can subscribe. The private key is only reported as present/absent.
 *   test   — sends one fixed, explicitly confirmed test notification to this
 *            owner's own confirmed devices. Requires the caller to prove intent
 *            with `confirm: true`; rate-limited; never accepts a payload.
 *
 * The VAPID private key is read from Vault inside this function and never
 * leaves it: no response, log line or error message contains it.
 */
import { callerUser, env, rateLimit, serviceClient } from "../_shared/http.ts";
import { isAllowedAutomationOrigin } from "../_shared/automationKeyChecks.ts";
import {
  sendPushNotification,
  testNotificationPayload,
  type PushSendResult,
  type PushTarget,
  type VapidCredentials,
} from "../_shared/webPush.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 1024;
const MAX_TEST_DEVICES = 5;

export interface PushHandlerDeps {
  caller: typeof callerUser;
  service: typeof serviceClient;
  fetcher: typeof fetch;
  originAllowed: (origin: string | null) => boolean;
  ownerCheck?: (req: Request) => Promise<boolean>;
}

function corsFor(req: Request, originAllowed: PushHandlerDeps["originAllowed"]): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!originAllowed(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Apikey, Content-Type, X-Client-Info",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function defaultOriginAllowed(origin: string | null): boolean {
  return isAllowedAutomationOrigin(origin, env("SITE_URL"));
}

/** Confirms the caller is the signed-in owner. Failures are never explained in detail. */
async function defaultOwnerCheck(req: Request, fetcher: typeof fetch): Promise<boolean> {
  const projectUrl = env("SUPABASE_URL", "SUPABASE_PROJECT_URL");
  const anonKey = env("SUPABASE_ANON_KEY", "SUPABASE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!projectUrl || !anonKey || !authorization) return false;
  try {
    const response = await fetcher(`${projectUrl.replace(/\/+$/, "")}/rest/v1/rpc/push_owner_check`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }
    const value = await response.json().catch(() => null);
    return value === true;
  } catch {
    return false;
  }
}

async function readBoundedBody(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function readVault(sb: ReturnType<typeof serviceClient>, name: string): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: name });
    return !error && typeof data === "string" && data.trim().length > 0 ? data.trim() : null;
  } catch {
    return null;
  }
}

async function isPushEnabled(sb: ReturnType<typeof serviceClient>): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("automation_feature_flags");
    if (error || !data || typeof data !== "object") return false;
    return (data as Record<string, unknown>)["automation.push"] === true;
  } catch {
    return false;
  }
}

export async function handleAutomationPush(
  req: Request,
  overrides: Partial<PushHandlerDeps> = {},
): Promise<Response> {
  const deps: PushHandlerDeps = {
    caller: overrides.caller ?? callerUser,
    service: overrides.service ?? serviceClient,
    fetcher: overrides.fetcher ?? fetch,
    originAllowed: overrides.originAllowed ?? defaultOriginAllowed,
    ownerCheck: overrides.ownerCheck,
  };

  const cors = corsFor(req, deps.originAllowed);
  const reply = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status: cors ? status : 403, headers: { ...JSON_HEADERS, ...(cors || {}) } });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: cors ? 204 : 403, headers: cors || JSON_HEADERS });
  }
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  const raw = await readBoundedBody(req, MAX_BODY_BYTES);
  if (raw === null) return reply({ error: "Request body is too large." }, 413);
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(raw || "{}");
    parsed = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return reply({ error: "Invalid request body." }, 400);
  }

  const action = typeof parsed.action === "string" ? parsed.action : "";
  if (action !== "config" && action !== "test") return reply({ error: "Unknown action." }, 400);

  const user = await deps.caller(req);
  if (!user?.id) return reply({ error: "Sign in as the owner to manage push notifications." }, 401);

  const isOwner = deps.ownerCheck
    ? await deps.ownerCheck(req)
    : await defaultOwnerCheck(req, deps.fetcher);
  if (!isOwner) return reply({ error: "Only the owner can manage push notifications." }, 403);

  const sb = deps.service();

  if (action === "config") {
    const publicKey = await readVault(sb, "vapid_public_key");
    const subject = await readVault(sb, "vapid_subject");
    const privateKey = await readVault(sb, "vapid_private_key");
    return reply({
      ok: true,
      public_key: publicKey,
      subject,
      private_key_configured: privateKey !== null,
      keys_ready: publicKey !== null && subject !== null && privateKey !== null,
      push_enabled: await isPushEnabled(sb),
    });
  }

  // ---- test: the only thing this endpoint can send, and only when confirmed.
  if (parsed.confirm !== true) {
    return reply({ ok: false, reason: "confirmation_required" }, 400);
  }

  const allowed = await rateLimit(sb, `push-test:${user.id}`, "automation_push_test", 5, 600);
  if (!allowed) return reply({ ok: false, reason: "rate_limited" }, 429);

  const credentials: VapidCredentials = {
    publicKey: (await readVault(sb, "vapid_public_key")) ?? "",
    privateKey: (await readVault(sb, "vapid_private_key")) ?? "",
    subject: (await readVault(sb, "vapid_subject")) ?? "",
  };
  if (!credentials.publicKey || !credentials.privateKey || !credentials.subject) {
    await sb.rpc("push_record_test_delivery", { p_owner_user_id: user.id, p_status: "failed" }).catch(() => undefined);
    return reply({ ok: false, reason: "missing_keys" });
  }

  let targets: PushTarget[] = [];
  try {
    const { data, error } = await sb.rpc("push_test_targets", {
      p_owner_user_id: user.id,
      p_limit: MAX_TEST_DEVICES,
    });
    if (error || !Array.isArray(data)) return reply({ ok: false, reason: "unavailable" }, 503);
    targets = data as PushTarget[];
  } catch {
    return reply({ ok: false, reason: "unavailable" }, 503);
  }

  if (targets.length === 0) return reply({ ok: false, reason: "no_device" });

  const payload = testNotificationPayload();
  let sent = 0;
  let failed = 0;
  let expired = 0;
  let reason: PushSendResult["reason"] = "delivered";

  for (const target of targets) {
    const result = await sendPushNotification(target, payload, credentials, { fetcher: deps.fetcher });
    if (result.status === "sent") sent += 1;
    else if (result.status === "expired") expired += 1;
    else {
      failed += 1;
      if (reason === "delivered") reason = result.reason;
    }
    // Expired subscriptions are revoked and scrubbed by the record function.
    if (target.id && result.status !== "failed") {
      await sb.rpc("push_record_delivery", { p_id: target.id, p_status: result.status }).catch(() => undefined);
    }
  }

  await sb.rpc("push_record_test_delivery", {
    p_owner_user_id: user.id,
    p_status: sent > 0 ? "sent" : "failed",
  }).catch(() => undefined);

  // Safe aggregates only: no endpoint, key material or device label.
  return reply({
    ok: sent > 0,
    sent,
    failed,
    expired,
    devices: targets.length,
    reason: sent > 0 ? "delivered" : reason,
  });
}
