import {
  callerUser,
  EMAIL_RE,
  env,
  rateLimit,
  serviceClient,
} from "../_shared/http.ts";
import {
  buildDistributionReadback,
  classifyReadbackStatus,
  parseDistributionReadback,
  parseResendReceipt,
  parseTelegramChatReadback,
  parseTelegramReceipt,
  readbackForMissingCredentials,
  type DistributionAdapterChannel,
  type DistributionCredentials,
  type SafeProviderCode,
  type SafeProviderStatus,
} from "../_shared/distributionAdapters.ts";
import { isAllowedAutomationOrigin } from "../_shared/automationKeyChecks.ts";
import {
  distributionPreflight,
  distributionResponse,
} from "../_shared/distributionCors.ts";
import { deliverPendingDistributionFailureAlerts } from "../_shared/automationAlerts.ts";

const MAX_BODY_BYTES = 2048;
const PROVIDER_TIMEOUT_MS = 8_000;
const CHANNELS: readonly DistributionAdapterChannel[] = [
  "instagram", "facebook", "youtube_shorts", "tiktok", "pinterest", "telegram",
  "threads", "linkedin", "x", "tumblr", "whatsapp", "newsletter", "site_widget",
];

export interface DistributionHandlerDeps {
  caller: typeof callerUser;
  service: typeof serviceClient;
  fetcher: typeof fetch;
  siteOrigin: (raw: string | null) => boolean;
  ownerCheck?: (req: Request) => Promise<boolean>;
  emailFrom?: () => string | undefined;
}

type ResponseBuilder = (req: Request, body: unknown, status?: number) => Response;

function defaultOriginCheck(origin: string | null): boolean {
  return isAllowedAutomationOrigin(origin, env("SITE_URL"));
}

async function defaultOwnerCheck(req: Request, fetcher: typeof fetch): Promise<boolean> {
  const projectUrl = env("SUPABASE_URL", "SUPABASE_PROJECT_URL");
  const anonKey = env("SUPABASE_ANON_KEY", "SUPABASE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!projectUrl || !anonKey || !authorization) return false;
  try {
    const response = await fetcher(`${projectUrl.replace(/\/+$/, "")}/rest/v1/rpc/automation_distribution_owner_check`, {
      method: "POST", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { Authorization: authorization, apikey: anonKey, "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* discard auth response */ }
      return false;
    }
    return await readBoundedJson(response, 128) === true;
  } catch {
    return false;
  }
}

async function boundedText(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch { return null; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validChannel(value: unknown): value is DistributionAdapterChannel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

function statusMessage(status: SafeProviderStatus): string {
  switch (status) {
    case "connected": return "Read-only provider readback passed. Per-item approval is still required.";
    case "blocked_by_provider_review": return "The provider rejected the credential or required account scope. The manual kit remains available.";
    case "quota_exhausted": return "The provider rate-limited this read-only check. The manual kit remains available.";
    case "not_configured": return "Required credentials are not configured. The manual kit remains available.";
    case "unavailable": return "Provider readback was unavailable or inconclusive. No post was sent.";
  }
}

async function getSecret(sb: ReturnType<typeof serviceClient>, name: string): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: name });
    return !error && typeof data === "string" && data.length > 0 ? data : null;
  } catch { return null; }
}

async function credentialsFor(sb: ReturnType<typeof serviceClient>, channel: DistributionAdapterChannel): Promise<DistributionCredentials> {
  const names: Record<DistributionAdapterChannel, string[]> = {
    instagram: ["meta_access_token", "instagram_user_id"],
    facebook: ["meta_access_token", "facebook_page_id"],
    youtube_shorts: ["youtube_client_id", "youtube_client_secret", "youtube_refresh_token"],
    tiktok: ["tiktok_access_token"],
    pinterest: ["pinterest_access_token", "pinterest_board_id"],
    telegram: ["telegram_bot_token", "telegram_chat_id"],
    threads: ["threads_access_token", "threads_user_id"],
    linkedin: ["linkedin_access_token", "linkedin_organization_id"],
    x: ["x_api_key", "x_api_secret", "x_access_token", "x_access_token_secret"],
    tumblr: ["tumblr_consumer_key", "tumblr_consumer_secret", "tumblr_access_token", "tumblr_token_secret", "tumblr_blog_identifier"],
    whatsapp: ["whatsapp_access_token", "whatsapp_phone_number_id"],
    newsletter: ["resend_api_key"],
    site_widget: [],
  };
  const entries = await Promise.all(names[channel].map(async name => [name, await getSecret(sb, name)] as const));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] !== null));
}

function pairConfigured(channel: DistributionAdapterChannel, secrets: DistributionCredentials): boolean {
  const required: Record<DistributionAdapterChannel, string[]> = {
    instagram: ["meta_access_token", "instagram_user_id"],
    facebook: ["meta_access_token", "facebook_page_id"],
    youtube_shorts: ["youtube_client_id", "youtube_client_secret", "youtube_refresh_token"],
    tiktok: ["tiktok_access_token"],
    pinterest: ["pinterest_access_token", "pinterest_board_id"],
    telegram: ["telegram_bot_token", "telegram_chat_id"],
    threads: ["threads_access_token", "threads_user_id"],
    linkedin: ["linkedin_access_token", "linkedin_organization_id"],
    x: ["x_api_key", "x_api_secret", "x_access_token", "x_access_token_secret"],
    tumblr: ["tumblr_consumer_key", "tumblr_consumer_secret", "tumblr_access_token", "tumblr_token_secret", "tumblr_blog_identifier"],
    whatsapp: ["whatsapp_access_token", "whatsapp_phone_number_id"],
    newsletter: ["resend_api_key"],
    site_widget: [],
  };
  return channel === "site_widget" || required[channel].every(name => Boolean(secrets[name]));
}

async function recordReadback(
  sb: ReturnType<typeof serviceClient>,
  channel: DistributionAdapterChannel,
  status: SafeProviderStatus,
  code: SafeProviderCode,
  quotaRemaining: number | null = null,
): Promise<boolean> {
  const { error } = await sb.rpc("automation_record_channel_readback", {
    p_channel_key: channel,
    p_status: status,
    p_safe_code: code,
    p_quota_remaining: quotaRemaining,
  });
  return !error;
}

async function readBoundedJson(response: Response, limit = 24_000): Promise<unknown | null> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > limit) {
    try { await response.body?.cancel(); } catch { /* discard unread provider body */ }
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch { return null; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { return null; }
}

async function youtubeReadback(secrets: DistributionCredentials, fetcher: typeof fetch): Promise<{ status: SafeProviderStatus; code: SafeProviderCode }> {
  const clientId = secrets.youtube_client_id;
  const clientSecret = secrets.youtube_client_secret;
  const refreshToken = secrets.youtube_refresh_token;
  if (!clientId || !clientSecret || !refreshToken) return readbackForMissingCredentials();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let tokenResponse: Response | null = null;
  try {
    tokenResponse = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    if (!tokenResponse.ok) return classifyReadbackStatus(tokenResponse.status);
    const tokenBody = await readBoundedJson(tokenResponse, 16_000);
    const accessToken = isRecord(tokenBody) && typeof tokenBody.access_token === "string" && tokenBody.access_token.length < 8192
      ? tokenBody.access_token : null;
    if (!accessToken) return { status: "blocked_by_provider_review", code: "PROVIDER_AUTH" };
    const channels = await fetcher("https://youtube.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=1", {
      method: "GET", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!channels.ok) return classifyReadbackStatus(channels.status);
    const body = await readBoundedJson(channels, 16_000);
    return isRecord(body) && Array.isArray(body.items) && body.items.length > 0
      ? { status: "connected", code: "PROVIDER_READBACK_OK" }
      : { status: "blocked_by_provider_review", code: "PROVIDER_REVIEW_REQUIRED" };
  } catch {
    return { status: "unavailable", code: "PROVIDER_UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
    try { await tokenResponse?.body?.cancel(); } catch { /* response body is not returned or logged */ }
  }
}

async function checkChannel(
  req: Request,
  sb: ReturnType<typeof serviceClient>,
  channel: DistributionAdapterChannel,
  fetcher: typeof fetch,
  respond: ResponseBuilder,
): Promise<Response> {
  const secrets = await credentialsFor(sb, channel);
  if (!pairConfigured(channel, secrets)) {
    const missing = readbackForMissingCredentials();
    const recorded = await recordReadback(sb, channel, missing.status, missing.code);
    return respond(req, { ok: recorded, channel, state: "not_configured", message: statusMessage(missing.status) }, recorded ? 200 : 503);
  }

  let result: { status: SafeProviderStatus; code: SafeProviderCode };
  if (channel === "youtube_shorts") {
    result = await youtubeReadback(secrets, fetcher);
  } else {
    const request = buildDistributionReadback(channel, secrets);
    if (!request) {
      // X API calls may consume paid credit; Tumblr needs signed OAuth 1.0a.
      if (channel === "x" || channel === "tumblr") {
        return respond(req, {
          ok: true, channel, state: "manual_kit", message: channel === "x"
            ? "X stays manual-only because an API request can consume paid credit. No request was made."
            : "Tumblr stays manual-only until its signed OAuth 1.0a readback adapter is verified. No request was made.",
        }, 200);
      }
      const invalid = readbackForMissingCredentials();
      const recorded = await recordReadback(sb, channel, invalid.status, invalid.code);
      return respond(req, { ok: recorded, channel, state: invalid.status, message: statusMessage(invalid.status) }, recorded ? 200 : 503);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    let upstream: Response | null = null;
    try {
      upstream = await fetcher(request.url, { ...request.init, signal: controller.signal });
      if (request.parseTelegramChat) {
        const chatId = secrets.telegram_chat_id || "";
        result = await parseTelegramChatReadback(upstream, chatId);
      } else {
        result = await parseDistributionReadback(channel, upstream, request.expectedResourceId);
      }
    } catch {
      result = { status: "unavailable", code: controller.signal.aborted ? "PROVIDER_UNAVAILABLE" : "PROVIDER_UNAVAILABLE" };
    } finally {
      clearTimeout(timer);
      try { await upstream?.body?.cancel(); } catch { /* provider body is not logged */ }
    }
  }

  const recorded = await recordReadback(sb, channel, result.status, result.code);
  if (recorded) await deliverPendingDistributionFailureAlerts(sb, fetcher);
  return respond(req, { ok: recorded, channel, state: result.status, message: statusMessage(result.status) }, recorded ? 200 : 503);
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function sendTelegram(
  req: Request,
  sb: ReturnType<typeof serviceClient>,
  actorId: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
  respond: ResponseBuilder,
): Promise<Response> {
  if (!validUuid(body.draft_id) || !validHash(body.payload_sha256)) return respond(req, { error: "Approved distribution draft is required." }, 400);
  const { data: claimData, error: claimError } = await sb.rpc("automation_claim_distribution_delivery", {
    p_actor_id: actorId,
    p_draft_id: body.draft_id,
    p_expected_sha256: body.payload_sha256,
  });
  if (claimError || !isRecord(claimData)) return respond(req, { error: "The owner-approved Telegram delivery could not be claimed safely." }, 409);
  if (claimData.ok !== true) return respond(req, { error: claimData.safe_error_code === "PROVIDER_QUOTA" ? "The owner-set Telegram daily cap is exhausted." : "This delivery is already in progress or requires a new approved copy." }, 409);
  if (claimData.already_sent === true) return respond(req, { ok: true, sent: true, alreadySent: true, remotePostId: claimData.remote_post_id }, 200);
  if (!Number.isInteger(claimData.log_id) || !isRecord(claimData.payload)
      || typeof claimData.payload.caption !== "string" || typeof claimData.payload.link !== "string"
      || !/^https:\/\/lixxonstudio\.com\/blog\/[a-z0-9-]+\?utm_source=telegram&/.test(claimData.payload.link)) {
    return respond(req, { error: "The saved owner-approved copy did not match the safe delivery contract." }, 409);
  }
  const botToken = await getSecret(sb, "telegram_bot_token");
  const chatId = await getSecret(sb, "telegram_chat_id");
  if (!botToken || !/^[0-9]{5,15}:[A-Za-z0-9_-]{20,128}$/.test(botToken)
      || !chatId || !/^-?[0-9]{1,32}$/.test(chatId)) {
    await sb.rpc("automation_complete_distribution_delivery", {
      p_log_id: claimData.log_id,
      p_status: "blocked",
      p_safe_error_code: "PROVIDER_NOT_CONFIGURED",
    });
    return respond(req, { error: "Telegram alert destination or bot credential is not configured. The manual kit remains available." }, 409);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let upstream: Response | null = null;
  let receipt: Awaited<ReturnType<typeof parseTelegramReceipt>>;
  try {
    upstream = await fetcher(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${claimData.payload.caption}\n\n${claimData.payload.link}`,
        disable_web_page_preview: false,
      }),
    });
    receipt = await parseTelegramReceipt(upstream, chatId);
  } catch {
    receipt = { ok: false, remoteMessageId: null, safeStatus: "unavailable", safeCode: "PROVIDER_UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
    try { await upstream?.body?.cancel(); } catch { /* response text is not logged or returned */ }
  }

  const deliveryStatus = receipt.ok ? "sent"
    : receipt.safeStatus === "quota_exhausted" ? "quota_exhausted"
      : receipt.safeStatus === "blocked_by_provider_review" ? "blocked" : "failed";
  const { error: completionError } = await sb.rpc("automation_complete_distribution_delivery", {
    p_log_id: claimData.log_id,
    p_status: deliveryStatus,
    p_remote_post_id: receipt.remoteMessageId,
    p_safe_error_code: receipt.ok ? null : receipt.safeCode,
  });
  if (completionError) return respond(req, { error: "Telegram returned no safely recorded receipt. Check the private channel before retrying." }, 503);
  await deliverPendingDistributionFailureAlerts(sb, fetcher);
  if (!receipt.ok) return respond(req, { error: `Telegram delivery did not complete: ${receipt.safeCode}. The approved manual kit is retained.` }, 502);
  return respond(req, { ok: true, sent: true, alreadySent: false, remotePostId: receipt.remoteMessageId }, 200);
}

function emailHtmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function hasUnsafeEmailHeader(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 0 || code === 10 || code === 13) return true;
  }
  return false;
}

async function sendNewsletterTest(
  req: Request,
  sb: ReturnType<typeof serviceClient>,
  actorId: string,
  recipient: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
  emailFrom: () => string | undefined,
  respond: ResponseBuilder,
): Promise<Response> {
  if (!validUuid(body.draft_id) || !validHash(body.payload_sha256)) {
    return respond(req, { error: 'An approved newsletter preview is required.' }, 400);
  }
  const resendKey = await getSecret(sb, 'resend_api_key');
  if (!resendKey || resendKey.length > 10000 || /[\r\n]/.test(resendKey)) {
    return respond(req, { error: 'Resend is not configured in Vault. The owner-only preview and manual kit remain available.' }, 409);
  }
  const { data: claimData, error: claimError } = await sb.rpc('automation_claim_newsletter_test', {
    p_actor_id: actorId,
    p_draft_id: body.draft_id,
    p_expected_sha256: body.payload_sha256,
  });
  if (claimError || !isRecord(claimData)) {
    return respond(req, { error: 'A fresh Resend readback and current owner-approved newsletter copy are required.' }, 409);
  }
  if (claimData.ok !== true) {
    const quota = claimData.safe_error_code === 'PROVIDER_QUOTA';
    return respond(req, {
      error: quota ? 'The owner-only test-email safety cap is exhausted for today.' : 'This approved version already has a test attempt. Check Resend before preparing a revised copy.',
    }, quota ? 429 : 409);
  }
  if (claimData.already_sent === true && typeof claimData.remote_email_id === 'string') {
    return respond(req, { ok: true, sent: true, alreadySent: true, testEmailId: claimData.remote_email_id }, 200);
  }
  if (!Number.isInteger(claimData.test_id) || !isRecord(claimData.payload)
      || typeof claimData.payload.subject !== 'string' || typeof claimData.payload.title !== 'string'
      || typeof claimData.payload.caption !== 'string' || typeof claimData.payload.link !== 'string'
      || !/^https:\/\/lixxonstudio\.com\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*\?utm_source=newsletter&utm_medium=email&utm_campaign=[a-z0-9-]+$/.test(claimData.payload.link)
      || (claimData.payload.image_url !== null && typeof claimData.payload.image_url !== 'string')) {
    return respond(req, { error: 'The saved email preview does not match the safe owner-test contract.' }, 409);
  }

  const configuredFrom = emailFrom() || 'Lixxon Studio <onboarding@resend.dev>';
  const from = configuredFrom.length <= 200 && !hasUnsafeEmailHeader(configuredFrom)
    ? configuredFrom : 'Lixxon Studio <onboarding@resend.dev>';
  const image = typeof claimData.payload.image_url === 'string' && /^https:\/\/[^\s]+$/.test(claimData.payload.image_url)
    ? `<p><img src="${emailHtmlEscape(claimData.payload.image_url)}" alt="${emailHtmlEscape(typeof claimData.payload.image_alt === 'string' ? claimData.payload.image_alt : '')}" style="max-width:100%;height:auto"></p>`
    : '';
  const caption = emailHtmlEscape(claimData.payload.caption).replace(/\r?\n/g, '<br>');
  const link = emailHtmlEscape(claimData.payload.link);
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#242424"><p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Lixxon Studio · owner-only test preview</p><h1>${emailHtmlEscape(claimData.payload.title)}</h1>${image}<p>${caption}</p><p><a href="${link}">Read the full owner-written article</a></p><p style="font-size:12px;color:#666">Test sent only to the signed-in owner. This preview does not contact subscribers.</p></body></html>`;
  const text = `${claimData.payload.caption}\n\n${claimData.payload.link}\n\nOwner-only test preview; no subscribers were contacted.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let upstream: Response | null = null;
  let receipt: Awaited<ReturnType<typeof parseResendReceipt>>;
  try {
    upstream = await fetcher('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({ from, to: [recipient], subject: `[TEST] ${claimData.payload.subject}`, html, text }),
    });
    receipt = await parseResendReceipt(upstream);
  } catch {
    receipt = { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
    try { await upstream?.body?.cancel(); } catch { /* provider payload and recipient are never logged */ }
  }

  const status = receipt.ok ? 'sent'
    : receipt.safeStatus === 'quota_exhausted' ? 'quota_exhausted'
      : receipt.safeStatus === 'blocked_by_provider_review' ? 'blocked' : 'failed';
  const { error: completionError } = await sb.rpc('automation_complete_newsletter_test', {
    p_test_id: claimData.test_id,
    p_status: status,
    p_remote_email_id: receipt.remoteMessageId,
    p_safe_error_code: receipt.ok ? null : receipt.safeCode,
  });
  if (completionError) return respond(req, { error: 'Resend returned no safely recorded test receipt. Check the Resend dashboard before trying another copy.' }, 503);
  await deliverPendingDistributionFailureAlerts(sb, fetcher);
  if (!receipt.ok) return respond(req, { error: `Owner-only test email was not confirmed: ${receipt.safeCode}. No subscriber campaign was sent.` }, 502);
  return respond(req, { ok: true, sent: true, alreadySent: false, testEmailId: receipt.remoteMessageId }, 200);
}

export async function handleAutomationDistribution(
  req: Request,
  deps: DistributionHandlerDeps = {
    caller: callerUser,
    service: serviceClient,
    fetcher: fetch,
    siteOrigin: defaultOriginCheck,
    emailFrom: () => env("EMAIL_FROM"),
  },
): Promise<Response> {
  const respond: ResponseBuilder = (request, body, status = 200) =>
    distributionResponse(request, body, status, deps.siteOrigin);
  if (req.method === "OPTIONS") return distributionPreflight(req, deps.siteOrigin);
  if (req.method !== "POST") return respond(req, { error: "Method not allowed." }, 405);
  if (!deps.siteOrigin(req.headers.get("Origin"))) return respond(req, { error: "Origin is not allowed." }, 403);
  const user = await deps.caller(req);
  if (!user) return respond(req, { error: "Sign in with an active owner account." }, 401);
  const raw = await boundedText(req, MAX_BODY_BYTES);
  if (raw === null) return respond(req, { error: "Request body is too large." }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return respond(req, { error: "Invalid request body." }, 400); }
  if (!isRecord(body) || (body.action !== "check" && body.action !== "send_telegram" && body.action !== "test_newsletter") || !validChannel(body.channel)) {
    return respond(req, { error: "Unsupported distribution operation." }, 400);
  }
  const sb = deps.service();
  try {
    const allowed = await rateLimit(sb, user.id, "automation_distribution", body.action === "check" ? 12 : 4, 600);
    if (!allowed) return respond(req, { error: "Distribution actions are temporarily rate-limited." }, 429);
  } catch {
    return respond(req, { error: "Distribution actions are temporarily unavailable." }, 503);
  }
  if (body.action === "check") {
    if (!(await (deps.ownerCheck ? deps.ownerCheck(req) : defaultOwnerCheck(req, deps.fetcher)))) return respond(req, { error: "Only an active owner or founder can test distribution connections." }, 403);
    if (body.channel === "site_widget") {
      return respond(req, { ok: true, channel: body.channel, state: "manual_kit", message: "The widget kit is local-only; copy the approved snippet or link. No provider request was made." }, 200);
    }
    return await checkChannel(req, sb, body.channel, deps.fetcher, respond);
  }

  if (!(await (deps.ownerCheck ? deps.ownerCheck(req) : defaultOwnerCheck(req, deps.fetcher)))) return respond(req, { error: "Only an active owner or founder can use a distribution sender." }, 403);
  if (body.action === "test_newsletter") {
    if (body.channel !== "newsletter") return respond(req, { error: "Newsletter test delivery is available only for the newsletter channel." }, 400);
    const recipient = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!user.email_confirmed_at || !EMAIL_RE.test(recipient)) {
      return respond(req, { error: "A confirmed email address on the signed-in owner account is required for this test." }, 409);
    }
    return await sendNewsletterTest(req, sb, user.id, recipient, body, deps.fetcher, deps.emailFrom || (() => env("EMAIL_FROM")), respond);
  }
  if (body.channel !== "telegram") return respond(req, { error: "This provider is manual-kit only in the current verified sender set." }, 409);
  return await sendTelegram(req, sb, user.id, body, deps.fetcher, respond);
}
