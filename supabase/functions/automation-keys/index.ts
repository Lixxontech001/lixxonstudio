import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  callerUser,
  env,
  serviceClient,
  sha256,
} from "../_shared/http.ts";
import {
  buildProviderCheckRequest,
  classifyProviderResponse,
  fetchProviderStatus,
  isAllowedAutomationOrigin,
  localCredentialCheck,
  type AutomationKeyTestStatus,
  type ProviderCheckRequest,
} from "../_shared/automationKeyChecks.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 1024;
const PROVIDER_TIMEOUT_MS = 8_000;
const VAPID_DEFAULT_SUBJECT = "mailto:owner@lixxonstudio.com";
const YOUTUBE_CREDENTIALS = ["youtube_client_id", "youtube_client_secret", "youtube_refresh_token"] as const;

type SecretName = string;

type VapidMaterial = {
  privateKey: string;
  publicKey: string;
  subject: string;
};

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function validVapidSubject(value: string): boolean {
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

async function generateVapidMaterial(subject: string): Promise<VapidMaterial> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const [privateJwk, publicJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.privateKey),
    crypto.subtle.exportKey("jwk", pair.publicKey),
  ]);
  const x = typeof publicJwk.x === "string" ? decodeBase64Url(publicJwk.x) : new Uint8Array();
  const y = typeof publicJwk.y === "string" ? decodeBase64Url(publicJwk.y) : new Uint8Array();
  const privateKey = typeof privateJwk.d === "string" ? privateJwk.d : "";
  if (x.length !== 32 || y.length !== 32 || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) {
    throw new Error("Generated VAPID key material was invalid");
  }
  const publicKey = encodeBase64Url(new Uint8Array([4, ...x, ...y]));
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey)) throw new Error("Generated VAPID public key was invalid");
  return { privateKey, publicKey, subject };
}

async function storeVapidMaterial(
  client: SupabaseClient,
  material: VapidMaterial,
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("automation_vapid_store", {
      p_private_key: material.privateKey,
      p_public_key: material.publicKey,
      p_subject: material.subject,
    });
    return !error && Boolean(data && typeof data === "object" && (data as { ok?: unknown }).ok === true);
  } catch {
    return false;
  }
}
type SafeCatalogRow = { name: string; configured: boolean };

function corsFor(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!isAllowedAutomationOrigin(origin, env("SITE_URL"))) return null;
  return {
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Apikey, Content-Type, X-Client-Info",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function reply(req: Request, body: unknown, status = 200): Response {
  const cors = corsFor(req);
  return new Response(JSON.stringify(body), {
    status: cors ? status : 403,
    headers: { ...JSON_HEADERS, ...(cors || {}) },
  });
}

async function readBoundedBody(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return '';
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

function safeMessage(status: AutomationKeyTestStatus): string {
  switch (status) {
    case "ok": return "Read-only provider check verified; write scopes were not exercised.";
    case "local_ok": return "Local format check passed; provider connectivity is not verified.";
    case "invalid": return "Provider rejected this credential or required scope.";
    case "rate_limited": return "Provider rate-limited the test; retry later.";
    case "unavailable": return "Provider is temporarily unavailable.";
    case "not_configured": return "This credential is not configured.";
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Provider payloads are never needed for a key test; cancellation failure is ignored.
  }
}

async function fetchReadOnly(request: ProviderCheckRequest): Promise<AutomationKeyTestStatus> {
  return await fetchProviderStatus(request, fetch, PROVIDER_TIMEOUT_MS);
}

async function getVaultCredential(sb: ReturnType<typeof serviceClient>, name: SecretName): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: name });
    return !error && typeof data === "string" && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

async function allowKeyTest(sb: ReturnType<typeof serviceClient>, userId: string): Promise<boolean | null> {
  try {
    const salt = env("RATE_LIMIT_SALT") || "lixxon";
    const keyHash = await sha256(`${salt}:automation-key-test:${userId}`);
    const { data, error } = await sb.rpc("check_rate_limit", {
      p_key_hash: keyHash,
      p_action: "automation_key_test",
      p_limit: 8,
      p_window_seconds: 600,
    });
    if (error) return null;
    return data === true;
  } catch {
    return null;
  }
}

async function recordTestResult(
  sb: ReturnType<typeof serviceClient>,
  name: string,
  status: AutomationKeyTestStatus,
): Promise<boolean> {
  try {
    const { error } = await sb.rpc("test_automation_secret", { p_secret_name: name, p_result: status });
    return !error;
  } catch {
    return false;
  }
}

function localFallback(name: string, value: string): AutomationKeyTestStatus {
  return localCredentialCheck(name, value) || "invalid";
}

async function testYouTubeCredential(
  sb: ReturnType<typeof serviceClient>,
  currentName: string,
  currentValue: string,
): Promise<AutomationKeyTestStatus> {
  const values: Partial<Record<(typeof YOUTUBE_CREDENTIALS)[number], string>> = { [currentName]: currentValue };
  for (const name of YOUTUBE_CREDENTIALS) {
    if (name === currentName) continue;
    const value = await getVaultCredential(sb, name);
    if (value) values[name] = value;
  }
  if (!YOUTUBE_CREDENTIALS.every((name) => values[name])) return localFallback(currentName, currentValue);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let accessToken = "";
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: values.youtube_client_id!,
        client_secret: values.youtube_client_secret!,
        refresh_token: values.youtube_refresh_token!,
      }),
    });
    if (!tokenResponse.ok) {
      const status = classifyProviderResponse(tokenResponse.status, tokenResponse.headers);
      await discardBody(tokenResponse);
      return status;
    }

    let tokenPayload: unknown;
    try {
      tokenPayload = await tokenResponse.json();
    } catch {
      return "unavailable";
    }
    if (!tokenPayload || typeof tokenPayload !== "object" || typeof (tokenPayload as { access_token?: unknown }).access_token !== "string") {
      return "invalid";
    }
    accessToken = (tokenPayload as { access_token: string }).access_token;

    const channelRequest: ProviderCheckRequest = {
      url: "https://youtube.googleapis.com/youtube/v3/channels?part=id&mine=true",
      init: {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      },
    };
    return await fetchReadOnly(channelRequest);
  } catch {
    return "unavailable";
  } finally {
    accessToken = "";
    clearTimeout(timeout);
  }
}

async function testWhatsAppCredential(
  sb: ReturnType<typeof serviceClient>,
  currentName: string,
  currentValue: string,
): Promise<AutomationKeyTestStatus> {
  const token = currentName === "whatsapp_access_token"
    ? currentValue
    : await getVaultCredential(sb, "whatsapp_access_token");
  const phoneId = currentName === "whatsapp_phone_number_id"
    ? currentValue
    : await getVaultCredential(sb, "whatsapp_phone_number_id");

  if (!token || !phoneId) {
    if (currentName === "whatsapp_phone_number_id") return localFallback(currentName, currentValue);
    return currentValue.trim().length >= 12 ? "local_ok" : "invalid";
  }

  const safePhoneId = phoneId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(safePhoneId)) return "invalid";
  return await fetchReadOnly({
    url: `https://graph.facebook.com/v23.0/${encodeURIComponent(safePhoneId)}?fields=id`,
    init: {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    },
  });
}

async function runKeyTest(
  sb: ReturnType<typeof serviceClient>,
  name: string,
  value: string,
): Promise<AutomationKeyTestStatus> {
  if (name.startsWith("youtube_")) return await testYouTubeCredential(sb, name, value);
  if (name === "whatsapp_access_token" || name === "whatsapp_phone_number_id") {
    return await testWhatsAppCredential(sb, name, value);
  }

  const localStatus = localCredentialCheck(name, value);
  if (localStatus) return localStatus;

  // X calls are intentionally not made: API access can consume paid credit. Tumblr's
  // OAuth 1.0a values need a full future channel adapter before a safe probe is possible.
  if (name.startsWith("x_") || name.startsWith("tumblr_")) return localFallback(name, value);

  const request = buildProviderCheckRequest(name, value);
  if (!request) return "unavailable";
  return await fetchReadOnly(request);
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (!cors) return new Response(null, { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed." }, 405);
  if (req.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reply(req, { error: "JSON request body required." }, 415);
  }

  const declaredLength = Number(req.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return reply(req, { error: "Request body is too large." }, 413);
  const rawBody = await readBoundedBody(req, MAX_BODY_BYTES);
  if (rawBody === null) return reply(req, { error: "Request body is too large or unreadable." }, 413);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return reply(req, { error: "Invalid request body." }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply(req, { error: "Invalid request body." }, 400);
  const body = payload as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["action", "name", "subject", "replace"].includes(key))) {
    return reply(req, { error: "Only an action, catalogue name, subject and replace choice are accepted." }, 400);
  }

  const user = await callerUser(req);
  if (!user) return reply(req, { error: "Owner authentication required." }, 401);

  const supabaseUrl = env("SUPABASE_URL", "SUPABASE_PROJECT_URL");
  const anonKey = env("SUPABASE_ANON_KEY", "SUPABASE_KEY");
  if (!supabaseUrl || !anonKey) return reply(req, { error: "Key service is not configured." }, 503);

  if (body.action === "generate_vapid") {
    if (body.name !== undefined || (body.replace !== undefined && typeof body.replace !== "boolean")) {
      return reply(req, { error: "A VAPID generation request is invalid." }, 400);
    }
    const subject = typeof body.subject === "string" && body.subject.trim().length > 0
      ? body.subject.trim()
      : VAPID_DEFAULT_SUBJECT;
    if (subject.length > 320 || !validVapidSubject(subject)) {
      return reply(req, { error: "Use a valid mailto: or HTTPS VAPID subject." }, 400);
    }
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const material = await generateVapidMaterial(subject);
      if (!await storeVapidMaterial(userClient, material)) {
        return reply(req, { error: "The VAPID pair could not be stored. Existing values were left unchanged." }, 503);
      }
      return reply(req, { action: "generate_vapid", public_key: material.publicKey, subject: material.subject });
    } catch {
      return reply(req, { error: "The VAPID pair could not be generated. No private key was returned." }, 503);
    }
  }

  if (body.action !== "test" || typeof body.name !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(body.name)) {
    return reply(req, { error: "A valid key test action is required." }, 400);
  }
  const name = body.name;

  let catalog: SafeCatalogRow[];
  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.rpc("automation_list_secrets");
    if (error || !Array.isArray(data)) return reply(req, { error: "Owner-only key access is required." }, 403);
    catalog = data as SafeCatalogRow[];
  } catch {
    return reply(req, { error: "Owner-only key access is required." }, 403);
  }

  const selected = catalog.find((row) => row?.name === name);
  if (!selected) return reply(req, { error: "Key name is not in the enabled catalogue." }, 400);
  if (!selected.configured) {
    return reply(req, { name, status: "not_configured", message: safeMessage("not_configured") });
  }

  let sb: ReturnType<typeof serviceClient>;
  try {
    sb = serviceClient();
  } catch {
    return reply(req, { error: "Key test service is not configured." }, 503);
  }
  const rateLimitResult = await allowKeyTest(sb, user.id);
  if (rateLimitResult === null) {
    const status: AutomationKeyTestStatus = "unavailable";
    if (!await recordTestResult(sb, name, status)) return reply(req, { error: "The safe test result could not be saved." }, 503);
    return reply(req, { name, status, message: safeMessage(status) });
  }
  if (!rateLimitResult) {
    const status: AutomationKeyTestStatus = "rate_limited";
    if (!await recordTestResult(sb, name, status)) return reply(req, { error: "The safe test result could not be saved." }, 503);
    return reply(req, { name, status, message: safeMessage(status) });
  }

  let secret: string | null = null;
  try {
    const result = await sb.rpc("automation_secret_get_internal", { p_secret_name: name });
    if (!result.error && typeof result.data === "string" && result.data.length > 0) secret = result.data;
  } catch {
    // Do not log provider, Vault, request, or credential errors.
  }
  if (!secret) {
    const status: AutomationKeyTestStatus = "unavailable";
    if (!await recordTestResult(sb, name, status)) return reply(req, { error: "The safe test result could not be saved." }, 503);
    return reply(req, { name, status, message: safeMessage(status) });
  }

  let status: AutomationKeyTestStatus = "unavailable";
  try {
    status = await runKeyTest(sb, name, secret);
  } catch {
    // Provider, Vault and request errors are intentionally reduced to a safe status.
  } finally {
    secret = null;
  }
  if (!await recordTestResult(sb, name, status)) return reply(req, { error: "The safe test result could not be saved." }, 503);
  return reply(req, { name, status, message: safeMessage(status) });
});
