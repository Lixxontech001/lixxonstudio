import {
  evaluatePipelineArticle,
  isSafeAutomationRunId,
  verifyGitHubActionsOidc,
  type PipelineArticleMetadata,
} from "../../../src/lib/automationPipeline.ts";
import { deliverPendingAutomationFailureAlerts } from "../_shared/automationAlerts.ts";
import { serviceClient, sha256 } from "../_shared/http.ts";

const MAX_BODY_BYTES = 2048;
const CAPABILITY_TTL_MS = 4 * 60 * 1000;
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const BEARER_RE = /^Bearer ([^\s]{8,16384})$/;

interface RunnerBody {
  action: "bootstrap" | "execute" | "fail";
  run_id: string;
}

type RunnerPost = {
  id: string;
  status: string;
  title: string | null;
  slug: string | null;
  excerpt: string | null;
  category_id: string | null;
  tags: string[] | null;
  cover_image: string | null;
  cover_image_alt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  scheduled_at: string | null;
  updated_at: string | null;
  content: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "X-Content-Type-Options": "nosniff" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function readBounded(req: Request): Promise<string | null> {
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
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

function parseBody(raw: string): RunnerBody | null {
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return null; }
  if (!isRecord(payload) || Object.keys(payload).some(key => !["action", "run_id"].includes(key))) return null;
  if (!isSafeAutomationRunId(payload.run_id)) return null;
  if (!(["bootstrap", "execute", "fail"] as unknown[]).includes(payload.action)) return null;
  return { action: payload.action as RunnerBody["action"], run_id: payload.run_id };
}

function randomCapability(): string {
  const value = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function safeRpcFailure(
  sb: ReturnType<typeof serviceClient>,
  runId: string,
  code: "APPROVAL_REVOKED" | "POST_MISSING" | "SOURCE_HASH_FAILED" | "SOURCE_EMPTY" | "SOURCE_CHANGED" | "METADATA_INVALID" | "UNSAFE_LINKS" | "RUNNER_STEP_FAILED" | "RUNNER_DATABASE_UNAVAILABLE",
): Promise<void> {
  try {
    const { data, error } = await sb.rpc("automation_fail_pipeline_run", { p_run_id: runId, p_safe_error_code: code });
    if (!error && data === true) await deliverPendingAutomationFailureAlerts(sb);
  } catch { /* Keep the original response generic; alert delivery is best-effort. */ }
}

function asPipelineMetadata(post: RunnerPost, content: string): PipelineArticleMetadata {
  return {
    status: post.status,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    categoryId: post.category_id,
    tags: Array.isArray(post.tags) ? post.tags.filter((tag): tag is string => typeof tag === "string") : null,
    coverImage: post.cover_image,
    coverImageAlt: post.cover_image_alt,
    seoTitle: post.seo_title,
    seoDescription: post.seo_description,
    scheduledAt: post.scheduled_at,
    content,
  };
}

export async function handleAutomationRunner(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "JSON request required." }, 415);
  }
  const rawBody = await readBounded(req);
  if (rawBody === null) return json({ error: "Request too large or unreadable." }, 413);
  const body = parseBody(rawBody);
  if (!body) return json({ error: "Invalid runner request." }, 400);

  const authorization = req.headers.get("authorization") || "";
  const bearer = BEARER_RE.exec(authorization)?.[1] || "";
  if (!bearer) return json({ error: "Runner authorization required." }, 401);

  if (body.action === "bootstrap" || body.action === "fail") {
    const identity = await verifyGitHubActionsOidc(bearer);
    if (!identity) return json({ error: "Trusted GitHub Actions identity required." }, 401);
    let sb: ReturnType<typeof serviceClient>;
    try { sb = serviceClient(); } catch { return json({ error: "Runner service is unavailable." }, 503); }

    if (body.action === "fail") {
      try {
        const { data, error } = await sb.rpc("automation_fail_runner", {
          p_run_id: body.run_id,
          p_github_run_id: identity.runId,
          p_github_run_attempt: identity.runAttempt,
        });
        if (!error && data === true) await deliverPendingAutomationFailureAlerts(sb);
        return error
          ? json({ error: "Runner failure status could not be recorded safely." }, 503)
          : json({ run_id: body.run_id, recorded: data === true }, 200);
      } catch {
        return json({ error: "Runner failure status could not be recorded safely." }, 503);
      }
    }

    const capability = randomCapability();
    const expiresAt = new Date(Date.now() + CAPABILITY_TTL_MS).toISOString();
    try {
      const { data, error } = await sb.rpc("automation_issue_run_capability", {
        p_run_id: body.run_id,
        p_token_hash: await sha256(capability),
        p_expires_at: expiresAt,
        p_github_run_id: identity.runId,
        p_github_run_attempt: identity.runAttempt,
      });
      if (error || data !== true) return json({ error: "This trusted runner cannot claim the requested run." }, 409);
      return json({ run_id: body.run_id, capability, expires_at: expiresAt }, 200);
    } catch {
      return json({ error: "This trusted runner cannot claim the requested run." }, 409);
    }
  }

  if (!/^[0-9a-f]{64}$/.test(bearer)) return json({ error: "Single-use run capability required." }, 401);
  let sb: ReturnType<typeof serviceClient>;
  try { sb = serviceClient(); } catch { return json({ error: "Runner service is unavailable." }, 503); }

  let work: unknown;
  try {
    const { data, error } = await sb.rpc("automation_redeem_run_capability", {
      p_run_id: body.run_id,
      p_token_hash: await sha256(bearer),
    });
    if (error || !isRecord(data) || data.run_id !== body.run_id || typeof data.post_id !== "string") {
      return json({ error: "The run capability is invalid, expired, or already used." }, 409);
    }
    work = data;
  } catch {
    return json({ error: "The run capability is invalid, expired, or already used." }, 409);
  }

  const postId = (work as Record<string, unknown>).post_id as string;
  let post: RunnerPost | null = null;
  try {
    const { data, error } = await sb.from("posts")
      .select("id,status,title,slug,excerpt,category_id,tags,cover_image,cover_image_alt,seo_title,seo_description,scheduled_at,updated_at,content")
      .eq("id", postId)
      .maybeSingle();
    if (error) {
      await safeRpcFailure(sb, body.run_id, "RUNNER_DATABASE_UNAVAILABLE");
      return json({ error: "The article preflight database check failed safely." }, 503);
    }
    post = (data || null) as RunnerPost | null;
  } catch {
    await safeRpcFailure(sb, body.run_id, "RUNNER_DATABASE_UNAVAILABLE");
    return json({ error: "The article preflight database check failed safely." }, 503);
  }
  if (!post) {
    await safeRpcFailure(sb, body.run_id, "POST_MISSING");
    return json({ error: "The approved article is no longer available." }, 409);
  }

  let content = typeof post.content === "string" ? post.content : "";
  let sourceHash = "";
  let safety: ReturnType<typeof evaluatePipelineArticle>;
  try {
    sourceHash = await sha256(content);
    safety = evaluatePipelineArticle(asPipelineMetadata(post, content));
  } catch {
    content = "";
    await safeRpcFailure(sb, body.run_id, "SOURCE_HASH_FAILED");
    return json({ error: "The article source snapshot could not be verified." }, 503);
  }
  content = "";

  if (!post.updated_at) {
    await safeRpcFailure(sb, body.run_id, "SOURCE_CHANGED");
    return json({ error: "The article changed before its source snapshot could be anchored." }, 409);
  }
  try {
    const { data, error } = await sb.rpc("automation_record_source_snapshot", {
      p_run_id: body.run_id,
      p_source_sha256: sourceHash,
      p_post_updated_at: post.updated_at,
    });
    if (error) {
      await safeRpcFailure(sb, body.run_id, "RUNNER_DATABASE_UNAVAILABLE");
      return json({ error: "The article source snapshot could not be anchored safely." }, 503);
    }
    if (data === "source_changed") {
      await safeRpcFailure(sb, body.run_id, "SOURCE_CHANGED");
      return json({ error: "The article changed before its source snapshot could be anchored." }, 409);
    }
    if (data === "approval_revoked") {
      await safeRpcFailure(sb, body.run_id, "APPROVAL_REVOKED");
      return json({ error: "The article approval is no longer active." }, 409);
    }
    if (data === "inactive") {
      return json({ error: "The pipeline run is no longer active." }, 409);
    }
    if (data === "paused") {
      return json({
        run_id: body.run_id,
        status: "paused",
        safe_error_code: "AUTOMATION_PAUSED",
        review_flags: {
          image_attribution_review_required: safety.imageAttributionReviewRequired,
          claim_review_required: safety.claimReviewRequired,
          disclaimer_required: safety.disclaimerRequired,
          disclaimer_present: safety.disclaimerPresent,
        },
        stages: [],
      }, 200);
    }
    if (data !== "recorded") {
      await safeRpcFailure(sb, body.run_id, "RUNNER_DATABASE_UNAVAILABLE");
      return json({ error: "The article source snapshot could not be anchored safely." }, 503);
    }
  } catch {
    await safeRpcFailure(sb, body.run_id, "RUNNER_DATABASE_UNAVAILABLE");
    return json({ error: "The article source snapshot could not be anchored safely." }, 503);
  }

  let duplicateSlug = false;
  if (post.slug) {
    try {
      const { data, error } = await sb.from("posts").select("id")
        .eq("slug", post.slug).neq("id", post.id).neq("status", "archived").limit(1);
      if (error) {
        await safeRpcFailure(sb, body.run_id, "RUNNER_DATABASE_UNAVAILABLE");
        return json({ error: "The article link preflight failed safely." }, 503);
      }
      duplicateSlug = Array.isArray(data) && data.length > 0;
    } catch {
      await safeRpcFailure(sb, body.run_id, "RUNNER_DATABASE_UNAVAILABLE");
      return json({ error: "The article link preflight failed safely." }, 503);
    }
  }
  if (duplicateSlug) safety.canonicalPathSafe = false;

  let result: Record<string, unknown>;
  try {
    const { data, error } = await sb.rpc("automation_complete_pipeline_run", {
      p_run_id: body.run_id,
      p_source_sha256: sourceHash,
      p_post_updated_at: post.updated_at,
      p_metadata_complete: safety.metadataComplete,
      p_image_url_https: safety.imageUrlHttps,
      p_canonical_path_safe: safety.canonicalPathSafe,
      p_article_links_safe: safety.articleLinksSafe,
      p_source_present: safety.sourcePresent,
      p_human_review_required: safety.humanReviewRequired,
    });
    if (error || !isRecord(data) || data.run_id !== body.run_id || typeof data.status !== "string") {
      await safeRpcFailure(sb, body.run_id, "RUNNER_DATABASE_UNAVAILABLE");
      return json({ error: "The safe pipeline result could not be recorded." }, 503);
    }
    result = data;
  } catch {
    await safeRpcFailure(sb, body.run_id, "RUNNER_DATABASE_UNAVAILABLE");
    return json({ error: "The safe pipeline result could not be recorded." }, 503);
  }

  const errorCode = typeof result.safe_error_code === "string" ? result.safe_error_code : null;
  if (result.status === "failed") await deliverPendingAutomationFailureAlerts(sb);
  const paused = result.status === "paused";
  const sourceFailed = ["SOURCE_EMPTY", "SOURCE_CHANGED", "SOURCE_HASH_FAILED"].includes(errorCode || "");
  const metadataFailed = ["METADATA_INVALID", "UNSAFE_LINKS"].includes(errorCode || "");
  const stages = paused
    ? [
      { step: "preflight", status: "skipped" },
      { step: "source_snapshot", status: "skipped" },
      { step: "metadata_links", status: "skipped" },
      { step: "channel_kit", status: "skipped" },
      { step: "asset_render", status: "skipped" },
      { step: "owner_review", status: "skipped" },
      { step: "publish_dispatch", status: "skipped" },
    ]
    : [
      { step: "preflight", status: "succeeded" },
      { step: "source_snapshot", status: sourceFailed ? "failed" : "succeeded" },
      { step: "metadata_links", status: metadataFailed ? "failed" : "succeeded" },
      { step: "channel_kit", status: result.status === "failed" ? "skipped" : safety.humanReviewRequired ? "awaiting_approval" : "succeeded" },
      { step: "asset_render", status: result.video_enabled === true ? "failed" : "skipped" },
      { step: "owner_review", status: result.status === "failed" ? "skipped" : "awaiting_approval" },
      { step: "publish_dispatch", status: result.status === "failed" ? "skipped" : "awaiting_approval" },
    ];
  return json({
    run_id: body.run_id,
    status: result.status,
    safe_error_code: typeof result.safe_error_code === "string" ? result.safe_error_code : null,
    source_checksum_recorded: result.source_checksum_recorded === true,
    kit_ready: result.kit_ready === true,
    human_review_required: safety.humanReviewRequired,
    review_flags: {
      image_attribution_review_required: safety.imageAttributionReviewRequired,
      claim_review_required: safety.claimReviewRequired,
      disclaimer_required: safety.disclaimerRequired,
      disclaimer_present: safety.disclaimerPresent,
    },
    stages,
  }, 200);
}
