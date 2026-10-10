// The owner's Takeover or Kill was just saved in the Minds screen. The database trigger wrote the notable row.
// This function attempts the owner's push for that row, once. It sends only to the caller's own devices,
// and only for the caller's own fresh rows. It never returns a key, an endpoint or a device detail.
import { callerUser, env, serviceClient } from "../_shared/http.ts";
import { isAllowedAutomationOrigin } from "../_shared/automationKeyChecks.ts";
import { ownerNotablePorts, pushNewestNotable } from "../_shared/notablePushServer.ts";

const CONTROL_KINDS = ["takeover_changed", "kill_changed"] as const;
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

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
  if (!cors) return new Response(JSON.stringify({ error: "origin not allowed" }), { status: 403, headers: JSON_HEADERS });
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const cors = corsFor(req);
    return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
  }
  if (req.method !== "POST") return reply(req, { error: "method not allowed" }, 405);
  const user = await callerUser(req);
  if (!user) return reply(req, { error: "sign in first" }, 401);
  const sb = serviceClient();
  const pushed: Record<string, string | null> = {};
  for (const kind of CONTROL_KINDS) {
    pushed[kind] = await pushNewestNotable(kind, ownerNotablePorts(sb, user.id));
  }
  return reply(req, { ok: true, pushed });
});
