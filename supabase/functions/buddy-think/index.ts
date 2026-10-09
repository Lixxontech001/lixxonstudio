import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { callerUser, env, serviceClient, sha256 } from "../_shared/http.ts";
import { isAllowedAutomationOrigin } from "../_shared/automationKeyChecks.ts";
import {
  callGemini,
  handleBuddyThink,
  type BuddyThinkDeps,
} from "../_shared/buddyThink.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 4096;
const KEY_NAME = "gemini_api_key";
const LIMITS = { probe: { limit: 5, window: 600 }, ask: { limit: 20, window: 600 } } as const;

function corsFor(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!isAllowedAutomationOrigin(origin, env("SITE_URL"))) return null;
  return {
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Apikey, Content-Type, X-Client-Info",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
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

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (!cors) return new Response(null, { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed." }, 405);
  if (req.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reply(req, { error: "JSON request body required." }, 415);
  }
  if (Number(req.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) {
    return reply(req, { error: "Request body is too large." }, 413);
  }
  const rawBody = await readBoundedBody(req, MAX_BODY_BYTES);
  if (rawBody === null) return reply(req, { error: "Request body is too large or unreadable." }, 413);
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return reply(req, { error: "Invalid request body." }, 400);
  }

  const user = await callerUser(req);
  if (!user) return reply(req, { error: "Owner authentication required." }, 401);

  const supabaseUrl = env("SUPABASE_URL", "SUPABASE_PROJECT_URL");
  const anonKey = env("SUPABASE_ANON_KEY", "SUPABASE_KEY");
  if (!supabaseUrl || !anonKey) return reply(req, { error: "Buddy is not configured." }, 503);

  // Owner check: the same owner-only catalogue read the Automation keys page uses. Its
  // answer also tells us whether the Google key is saved, without reading the key itself.
  let keyConfigured = false;
  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.rpc("automation_list_secrets");
    if (error || !Array.isArray(data)) return reply(req, { error: "Owner-only access is required." }, 403);
    const row = (data as Array<{ name?: unknown; configured?: unknown }>).find((entry) => entry?.name === KEY_NAME);
    keyConfigured = row?.configured === true;
  } catch {
    return reply(req, { error: "Owner-only access is required." }, 403);
  }

  let sb: ReturnType<typeof serviceClient>;
  try {
    sb = serviceClient();
  } catch {
    return reply(req, { error: "Buddy is not configured." }, 503);
  }

  const deps: BuddyThinkDeps = {
    keyConfigured: async () => keyConfigured,
    readKey: async () => {
      try {
        const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: KEY_NAME });
        return !error && typeof data === "string" && data.length > 0 ? data : null;
      } catch {
        return null;
      }
    },
    allowCall: async (action) => {
      try {
        const salt = env("RATE_LIMIT_SALT") || "lixxon";
        const keyHash = await sha256(`${salt}:buddy-think:${action}:${user.id}`);
        const { data, error } = await sb.rpc("check_rate_limit", {
          p_key_hash: keyHash,
          p_action: `buddy_think_${action}`,
          p_limit: LIMITS[action].limit,
          p_window_seconds: LIMITS[action].window,
        });
        if (error) return null;
        return data === true;
      } catch {
        return null;
      }
    },
    askGemini: (apiKey, input) => callGemini(apiKey, input),
    recordProbe: async (status) => {
      try {
        await sb.rpc("test_automation_secret", { p_secret_name: KEY_NAME, p_result: status });
      } catch {
        // The probe answer is still returned to the owner; only the stored status is lost.
      }
    },
  };

  const result = await handleBuddyThink(payload, deps);
  return reply(req, result.body, result.status);
});
