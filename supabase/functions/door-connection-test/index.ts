// Owner-only connection test for one free door. Reads the door's saved details from Vault on the server,
// makes one read-only check with the door, and returns one plain status. It never posts, and it never
// returns or logs a saved value. The browser sends only the door id.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { callerUser, env, serviceClient, sha256 } from "../_shared/http.ts";
import { isAllowedAutomationOrigin } from "../_shared/automationKeyChecks.ts";
import { DOORS, doorStatus, isDoorId, type DoorId } from "../_shared/doorRegistry.ts";
import { doorTestMessage, testDoorConnection, type DoorTestStatus } from "../_shared/doorConnectionTests.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 256;
const RATE_LIMIT = 6;
const RATE_WINDOW_SECONDS = 600;

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

function result(req: Request, door: DoorId, status: DoorTestStatus): Response {
  return reply(req, { door, status, message: doorTestMessage(status) });
}

async function readBoundedText(req: Request, limit: number): Promise<string | null> {
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

async function allowTest(sb: ReturnType<typeof serviceClient>, userId: string): Promise<boolean | null> {
  try {
    const salt = env("RATE_LIMIT_SALT") || "lixxon";
    const keyHash = await sha256(`${salt}:door-connection-test:${userId}`);
    const { data, error } = await sb.rpc("check_rate_limit", {
      p_key_hash: keyHash,
      p_action: "door_connection_test",
      p_limit: RATE_LIMIT,
      p_window_seconds: RATE_WINDOW_SECONDS,
    });
    if (error) return null;
    return data === true;
  } catch {
    return null;
  }
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
  const rawBody = await readBoundedText(req, MAX_BODY_BYTES);
  if (rawBody === null) return reply(req, { error: "Request body is too large or unreadable." }, 413);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return reply(req, { error: "Invalid request body." }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply(req, { error: "Invalid request body." }, 400);
  const body = payload as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "door")) return reply(req, { error: "Only a door id is accepted." }, 400);
  if (!isDoorId(body.door)) return reply(req, { error: "Unknown door." }, 400);
  const door: DoorId = body.door;

  const user = await callerUser(req);
  if (!user) return reply(req, { error: "Owner authentication required." }, 401);

  const supabaseUrl = env("SUPABASE_URL", "SUPABASE_PROJECT_URL");
  const anonKey = env("SUPABASE_ANON_KEY", "SUPABASE_KEY");
  if (!supabaseUrl || !anonKey) return reply(req, { error: "Connection test is not configured." }, 503);

  // The owner's own session decides who may test. automation_list_secrets is owner-only.
  let saved: Set<string>;
  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.rpc("automation_list_secrets");
    if (error || !Array.isArray(data)) return reply(req, { error: "Owner-only key access is required." }, 403);
    saved = new Set(
      (data as Array<{ name?: unknown; configured?: unknown }>)
        .filter((row) => row && row.configured === true && typeof row.name === "string")
        .map((row) => row.name as string),
    );
  } catch {
    return reply(req, { error: "Owner-only key access is required." }, 403);
  }

  if (doorStatus(door, saved).state !== "connected") return result(req, door, "not_connected");

  let sb: ReturnType<typeof serviceClient>;
  try {
    sb = serviceClient();
  } catch {
    return reply(req, { error: "Connection test is not configured." }, 503);
  }
  const allowed = await allowTest(sb, user.id);
  if (allowed === null) return result(req, door, "unavailable");
  if (!allowed) return result(req, door, "rate_limited");

  const values: Record<string, string> = {};
  try {
    for (const field of DOORS[door].fields) {
      const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: field.secretName });
      if (!error && typeof data === "string" && data.length > 0) values[field.secretName] = data;
    }
  } catch {
    return result(req, door, "unavailable");
  }

  let status: DoorTestStatus = "unavailable";
  try {
    status = await testDoorConnection(door, values, fetch);
  } catch {
    // Provider and Vault errors are reduced to a plain status. Nothing is logged.
  } finally {
    for (const name of Object.keys(values)) delete values[name];
  }
  return result(req, door, status);
});
