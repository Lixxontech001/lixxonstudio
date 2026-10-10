export type AutomationKeyTestStatus =
  | "ok"
  | "local_ok"
  | "invalid"
  | "rate_limited"
  | "unavailable"
  | "not_configured";

export interface ProviderCheckRequest {
  url: string;
  init: RequestInit;
}

const LOCAL_ONLY_SECRETS = new Set([
  "meta_app_secret",
  "youtube_client_secret",
  "youtube_refresh_token",
  "tiktok_client_secret",
  "linkedin_client_secret",
  "x_api_key",
  "x_api_secret",
  "x_access_token",
  "x_access_token_secret",
  "tumblr_consumer_key",
  "tumblr_consumer_secret",
  "tumblr_access_token",
  "tumblr_token_secret",
  "flutterwave_webhook_hash",
]);

const LOCAL_ONLY_IDENTIFIERS = new Set([
  "meta_app_id",
  "youtube_client_id",
  "tiktok_client_key",
  "linkedin_client_id",
  "x_api_key",
  "tumblr_consumer_key",
  "whatsapp_phone_number_id",
  "vapid_subject",
  "instagram_user_id",
  "facebook_page_id",
  "threads_user_id",
  "pinterest_board_id",
  "linkedin_organization_id",
  "tumblr_blog_identifier",
  "telegram_chat_id",
]);

const FETCH_GUARDS: Pick<RequestInit, "cache" | "redirect" | "referrerPolicy"> = {
  cache: "no-store",
  redirect: "error",
  referrerPolicy: "no-referrer",
};

function guardedGet(headers: Record<string, string>): RequestInit {
  return { ...FETCH_GUARDS, method: "GET", headers: { Accept: "application/json", ...headers } };
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

/**
 * Return a single, read-only, HTTPS provider request. The secret is held only in
 * the server-side request header (except Telegram, whose official API puts its
 * bot token in the URL path). Unknown/paired credentials do not make a request.
 */
export function buildProviderCheckRequest(name: string, secret: string): ProviderCheckRequest | null {
  const bearer = { Authorization: `Bearer ${secret}` };
  switch (name) {
    case "openai_api_key":
      return { url: "https://api.openai.com/v1/models?limit=1", init: guardedGet(bearer) };
    case "gemini_api_key":
      return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", init: guardedGet({ "x-goog-api-key": secret }) };
    case "anthropic_api_key":
      return {
        url: "https://api.anthropic.com/v1/models?limit=1",
        init: guardedGet({ "x-api-key": secret, "anthropic-version": "2023-06-01" }),
      };
    case "github_dispatch_token":
      return {
        url: "https://api.github.com/repos/Lixxontech001/lixxonstudio/actions/workflows?per_page=1",
        init: {
          ...guardedGet({ ...bearer, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Lixxon-Studio-Key-Check" }),
        },
      };
    case "flutterwave_secret_key":
      return { url: "https://api.flutterwave.com/v3/balances", init: guardedGet(bearer) };
    case "resend_api_key":
      return { url: "https://api.resend.com/domains", init: guardedGet(bearer) };
    case "meta_access_token":
      return { url: "https://graph.facebook.com/v23.0/me?fields=id", init: guardedGet(bearer) };
    case "threads_access_token":
      return { url: "https://graph.threads.net/v1.0/me?fields=id", init: guardedGet(bearer) };
    case "tiktok_access_token":
      return { url: "https://open.tiktokapis.com/v2/user/info/?fields=open_id", init: guardedGet(bearer) };
    case "pinterest_access_token":
      return { url: "https://api.pinterest.com/v5/user_account", init: guardedGet(bearer) };
    case "linkedin_access_token":
      return { url: "https://api.linkedin.com/v2/userinfo", init: guardedGet(bearer) };
    case "coverr_api_key":
      return { url: "https://api.coverr.co/videos?page_size=1", init: guardedGet(bearer) };
    case "telegram_bot_token":
      return {
        url: `https://api.telegram.org/bot${encodeURIComponent(secret).replace(/%3A/gi, ":")}/getMe`,
        init: guardedGet({}),
      };
    // Phase A brains: one cheap read-only request each. Nothing is generated and nothing is published.
    case "groq_api_key":
      return { url: "https://api.groq.com/openai/v1/models", init: guardedGet(bearer) };
    case "nvidia_api_key":
      return { url: "https://integrate.api.nvidia.com/v1/models", init: guardedGet(bearer) };
    case "cloudflare_api_token":
      return { url: "https://api.cloudflare.com/client/v4/user/tokens/verify", init: guardedGet(bearer) };
    case "openrouter_api_key":
      return { url: "https://openrouter.ai/api/v1/key", init: guardedGet(bearer) };
    case "huggingface_token":
      return { url: "https://huggingface.co/api/whoami-v2", init: guardedGet(bearer) };
    default:
      return null;
  }
}

/**
 * Local-only checks are deliberately labelled as such: format validation must
 * never be confused with provider connectivity or permission verification.
 * null means the credential has a provider request (or needs a companion).
 */
export function localCredentialCheck(name: string, secret: string): "local_ok" | "invalid" | null {
  const value = secret.trim();
  if (!value || value.length > 10000 || hasControlCharacters(value)) return "invalid";
  if (name === "telegram_bot_token") {
    return /^[0-9]{5,15}:[A-Za-z0-9_-]{20,128}$/.test(value) ? null : "invalid";
  }
  if (name === "telegram_chat_id") {
    return /^-?[0-9]{1,32}$/.test(value) ? "local_ok" : "invalid";
  }

  if (name === "vapid_private_key") {
    return /^[A-Za-z0-9_-]{43,44}={0,2}$/.test(value) ? "local_ok" : "invalid";
  }
  if (name === "vapid_public_key") {
    return /^[A-Za-z0-9_-]{86,88}={0,2}$/.test(value) ? "local_ok" : "invalid";
  }
  if (name === "vapid_subject") {
    return /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+(?:\/[^\s]*)?)$/i.test(value)
      ? "local_ok"
      : "invalid";
  }
  if (LOCAL_ONLY_IDENTIFIERS.has(name)) {
    return /^[A-Za-z0-9._:@/-]{1,200}$/.test(value) ? "local_ok" : "invalid";
  }
  if (LOCAL_ONLY_SECRETS.has(name)) {
    return value.length >= 12 ? "local_ok" : "invalid";
  }
  return null;
}

/** Safe provider outcome mapping; provider response bodies are intentionally ignored. */
export async function fetchProviderStatus(
  request: ProviderCheckRequest,
  fetcher: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<AutomationKeyTestStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(request.url, { ...request.init, signal: controller.signal });
    const status = classifyProviderResponse(response.status, response.headers);
    try {
      await response.body?.cancel();
    } catch {
      // The response is never consumed or returned to the caller.
    }
    return status;
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}

export function classifyProviderResponse(
  status: number,
  headers?: Pick<Headers, "get">,
): AutomationKeyTestStatus {
  if (status >= 200 && status < 300) return "ok";
  if (
    status === 429 ||
    (status === 403 && (headers?.get("retry-after") || headers?.get("x-ratelimit-remaining") === "0"))
  ) return "rate_limited";
  if ([400, 401, 403].includes(status)) return "invalid";
  return "unavailable";
}

/** Origin allowlist for the owner-only Edge endpoint; no wildcard CORS. */
export function isAllowedAutomationOrigin(origin: string | null, configuredSiteUrl?: string): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    const host = parsed.hostname.toLowerCase();
    const isLocalDev = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(host) && ["3000", "4173", "5173"].includes(parsed.port);
    if (isLocalDev) return true;
    if (parsed.protocol !== "https:") return false;

    if (configuredSiteUrl) {
      try {
        if (new URL(configuredSiteUrl).origin === parsed.origin) return true;
      } catch {
        // An invalid optional SITE_URL must not broaden the allowlist.
      }
    }

    if (["lixxonstudio.com", "www.lixxonstudio.com", "lixxonstudio.vercel.app"].includes(host)) return true;
    if (/^lixxonstudio(?:-[a-z0-9-]+)?\.vercel\.app$/.test(host)) return true;
    return /^\d+-[a-z0-9-]+\.e2b\.app$/.test(host);
  } catch {
    return false;
  }
}
