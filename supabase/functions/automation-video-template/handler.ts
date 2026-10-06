import {
  callerUser,
  env,
  rateLimit,
  serviceClient,
} from "../_shared/http.ts";
import { isAllowedAutomationOrigin } from "../_shared/automationKeyChecks.ts";
import {
  distributionPreflight,
  distributionResponse,
} from "../_shared/distributionCors.ts";
import { classifyGitHubDispatchStatus } from "../../../src/lib/automationPipeline.ts";

/**
 * V22 — one owner action, no deploy.
 *
 * The owner edits the look of the daily vertical video in admin (a row in `video_templates`).
 * This function reads that one active row, re-checks it against the renderer contract, and
 * dispatches the ephemeral render workflow with the document as its only input. It never
 * accepts a document from the browser, never invents a default, and never lets the look reach
 * the workflow through a URL, a query string or a log line.
 */
const WORKFLOW_FILE = "video-render-test.yml";
const WORKFLOW_URL =
  `https://api.github.com/repos/Lixxontech001/lixxonstudio/actions/workflows/${WORKFLOW_FILE}/dispatches`;
const DISPATCH_REF = "main";
const MAX_BODY_BYTES = 512;
const MAX_TEMPLATE_BYTES = 4096;
const DISPATCH_TIMEOUT_MS = 8_000;
const RATE_LIMIT_PER_10_MINUTES = 4;

const REQUIRED_KEYS = [
  "schema", "name", "duration_seconds", "music", "fps", "movement",
  "title", "caption", "end_card", "watermark",
] as const;
const SECTION_KEYS: Record<string, readonly string[]> = {
  movement: ["zoom_step", "zoom_max", "pan_x", "pan_y", "pan_x_period", "pan_y_period"],
  title: ["font_size", "line_spacing", "color", "box_height", "seconds"],
  caption: ["font_size", "line_spacing", "color", "box_top", "box_height", "max_characters_per_line", "max_lines"],
  end_card: ["font_size", "line_spacing", "color", "text"],
  watermark: ["text", "font_size"],
};
const COLOR_RE = /^0x[0-9A-F]{6}$/;

export interface VideoTemplateHandlerDeps {
  caller: typeof callerUser;
  service: typeof serviceClient;
  fetcher: typeof fetch;
  originAllowed: (origin: string | null) => boolean;
}

export type VideoTemplateErrorCode =
  | "GITHUB_TOKEN_MISSING"
  | "GITHUB_AUTH"
  | "GITHUB_FORBIDDEN"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_UNAVAILABLE"
  | "GITHUB_UNEXPECTED"
  | "GITHUB_NETWORK_ERROR";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** The document is accepted only if every number is inside the bounds the renderer enforces. */
function documentIsRenderable(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (JSON.stringify(value).length > MAX_TEMPLATE_BYTES) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== REQUIRED_KEYS.length || keys.some((key, index) => key !== [...REQUIRED_KEYS].sort()[index])) return false;
  if (value.schema !== "lixxon.video-template.v1" || value.music !== "none") return false;
  if (typeof value.name !== "string" || value.name.length < 1 || value.name.length > 80) return false;
  const duration = value.duration_seconds;
  if (!Number.isInteger(duration) || (duration as number) < 8 || (duration as number) > 60) return false;
  if (![24, 25, 30].includes(value.fps as number)) return false;
  for (const [section, expected] of Object.entries(SECTION_KEYS)) {
    const body = value[section];
    if (!isRecord(body)) return false;
    const sectionKeys = Object.keys(body).sort();
    if (sectionKeys.length !== expected.length || sectionKeys.some((key, index) => key !== [...expected].sort()[index])) return false;
    for (const entry of Object.values(body)) {
      if (typeof entry === "string") {
        if (entry.length === 0 || entry.length > 200 || /[\u0000-\u001f\u007f]/.test(entry.replace(/\n/g, ""))) return false;
      } else if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0) {
        return false;
      }
    }
    for (const color of [body.color].filter(Boolean)) {
      if (typeof color !== "string" || !COLOR_RE.test(color)) return false;
    }
  }
  const title = value.title as Record<string, number>;
  const caption = value.caption as Record<string, number>;
  const endCard = value.end_card as { text?: string };
  const watermark = value.watermark as { text?: string };
  if (title.font_size < 28 || title.font_size > 96 || title.seconds < 1 || title.seconds > 6) return false;
  if (title.box_height < 200 || title.box_height > 900) return false;
  if (caption.font_size < 24 || caption.font_size > 72) return false;
  if (caption.box_top < 200 || caption.box_top > 1700 || caption.box_height < 200 || caption.box_height > 900) return false;
  if (caption.max_characters_per_line < 16 || caption.max_characters_per_line > 48) return false;
  if (caption.max_lines < 3 || caption.max_lines > 10) return false;
  if (title.box_height + 100 > 1920 || caption.box_top + caption.box_height > 1900) return false;
  if (typeof endCard.text !== "string" || endCard.text.length < 1 || endCard.text.length > 200) return false;
  if (typeof watermark.text !== "string" || watermark.text.length < 1 || watermark.text.length > 60
      || watermark.text.includes("\n")) return false;
  return true;
}

async function readBounded(req: Request, limit: number): Promise<string | null> {
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
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* provider bodies are never inspected */ }
}

function classifyDispatchError(status: number): VideoTemplateErrorCode {
  switch (classifyGitHubDispatchStatus(status)) {
    case "auth": return "GITHUB_AUTH";
    case "forbidden": return "GITHUB_FORBIDDEN";
    case "rate_limited": return "GITHUB_RATE_LIMITED";
    case "unavailable": return "GITHUB_UNAVAILABLE";
    case "unexpected": return "GITHUB_UNEXPECTED";
    case "dispatched": return "GITHUB_UNEXPECTED";
  }
}

async function getSecret(sb: ReturnType<typeof serviceClient>, name: string): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: name });
    return !error && typeof data === "string" && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

async function activeTemplate(sb: ReturnType<typeof serviceClient>): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await sb.rpc("automation_video_template_active_internal");
    return !error && isRecord(data) ? data : null;
  } catch {
    return null;
  }
}

export async function handleAutomationVideoTemplate(
  req: Request,
  overrides: Partial<VideoTemplateHandlerDeps> = {},
): Promise<Response> {
  const deps: VideoTemplateHandlerDeps = {
    caller: callerUser,
    service: serviceClient,
    fetcher: fetch,
    originAllowed: (origin) => isAllowedAutomationOrigin(origin, env("SITE_URL")),
    ...overrides,
  };
  const respond = (body: unknown, status = 200) => distributionResponse(req, body, status, deps.originAllowed);

  if (req.method === "OPTIONS") return distributionPreflight(req, deps.originAllowed);
  if (req.method !== "POST") return respond({ error: "Method not allowed." }, 405);
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return respond({ error: "JSON request required." }, 415);
  }
  const user = await deps.caller(req);
  if (!user) return respond({ error: "Sign in as the owner to dispatch a render." }, 401);

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return respond({ error: "Request too large." }, 413);
  const rawBody = await readBounded(req, MAX_BODY_BYTES);
  if (rawBody === null) return respond({ error: "Request too large or unreadable." }, 413);
  let payload: unknown;
  try { payload = JSON.parse(rawBody || "{}"); } catch { return respond({ error: "Invalid request body." }, 400); }
  if (!isRecord(payload) || payload.action !== "dispatch") {
    return respond({ error: "Only a render dispatch is accepted." }, 400);
  }

  let sb: ReturnType<typeof serviceClient>;
  try { sb = deps.service(); } catch { return respond({ error: "Video template dispatch is unavailable." }, 503); }

  if (!await rateLimit(sb, user.id, "automation_video_template", RATE_LIMIT_PER_10_MINUTES, 600)) {
    return respond({ error: "Too many render dispatches. Try again in a few minutes." }, 429);
  }

  const template = await activeTemplate(sb);
  if (!template || !documentIsRenderable(template.document)) {
    return respond({ error: "No live look passed the render contract, so nothing was dispatched. Check the video template panel." }, 409);
  }

  const token = await getSecret(sb, "github_dispatch_token");
  if (!token) {
    return respond({ error: "The GitHub dispatch token is not configured in Vault. Copy the template JSON and run the workflow manually." }, 409);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
  let status = 0;
  let errorCode: VideoTemplateErrorCode | null = "GITHUB_NETWORK_ERROR";
  try {
    const response = await deps.fetcher(WORKFLOW_URL, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: DISPATCH_REF, inputs: { template_json: JSON.stringify(template.document) } }),
    });
    status = response.status;
    if (response.status === 204) {
      errorCode = null;
      await discard(response);
    } else {
      errorCode = classifyDispatchError(response.status);
      await discard(response);
    }
  } catch {
    errorCode = controller.signal.aborted ? "GITHUB_UNAVAILABLE" : "GITHUB_NETWORK_ERROR";
    status = 0;
  } finally {
    clearTimeout(timeout);
  }
  const safeTemplateName = typeof template.name === "string" ? template.name.slice(0, 80) : "";

  if (errorCode === null) {
    return respond({
      status: "dispatched",
      workflow: WORKFLOW_FILE,
      template_name: safeTemplateName,
      message: "The render workflow was dispatched with the live look. Watch the run in Actions; the video stays an unpublished test artifact.",
    });
  }
  console.error("video template dispatch failed", errorCode, status);
  return respond({
    status: "blocked",
    workflow: WORKFLOW_FILE,
    template_name: safeTemplateName,
    error_code: errorCode,
    message: errorCode === "GITHUB_TOKEN_MISSING"
      ? "The GitHub dispatch token is not configured in Vault. Copy the template JSON and run the workflow manually."
      : "GitHub refused or could not be reached. Nothing was rendered; the live look is unchanged.",
  }, 502);
}
