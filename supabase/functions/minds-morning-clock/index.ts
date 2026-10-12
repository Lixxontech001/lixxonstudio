// The 08:00 morning clock. Called by pg_cron through pg_net with the internal function secret, never by a browser.
// It queues the owner's day run, and only when Takeover is On: the rules and the tick are in _shared/morningClock.ts.
// It has no owner session, so it does not use the owner check; the internal secret is the only way in.
// Nothing here posts, spends, publishes, writes an article or creates a product.

import { env, json, serviceClient } from "../_shared/http.ts";
import { runMorningClock, type MorningClockPorts, type MorningClockResult } from "../_shared/morningClock.ts";
import type { KillScope } from "../_shared/placementRun.ts";

/** The Kill values the minds understand. Anything else counts as "all", the stopped direction. */
const KILL_SCOPES: readonly KillScope[] = ["none", "all", "analyst", "strategist", "ceo", "executioner", "auditor"];

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** Takeover is on only when it is exactly true. An unreadable Kill scope counts as "all". */
function parseControls(row: unknown): { ok: true; takeover: boolean; killScope: KillScope } | { ok: false } {
  if (!row || typeof row !== "object") return { ok: false };
  const record = row as { takeover?: unknown; kill_scope?: unknown };
  const kill = String(record.kill_scope ?? "all");
  return {
    ok: true,
    takeover: record.takeover === true,
    killScope: (KILL_SCOPES as readonly string[]).includes(kill) ? (kill as KillScope) : "all",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const expected = env("INTERNAL_FN_SECRET");
  const supplied = req.headers.get("x-internal-secret") || "";
  if (!expected || !safeEqual(supplied, expected)) return json({ error: "Forbidden" }, 403);

  let sb;
  try {
    sb = serviceClient();
  } catch {
    return json({ error: "Buddy is not configured." }, 503);
  }

  const ports: MorningClockPorts = {
    readOwners: async () => {
      const { data, error } = await sb.from("app_admins").select("user_id").eq("role", "owner");
      if (error || !Array.isArray(data)) return { ok: false };
      return {
        ok: true,
        owners: (data as Array<{ user_id?: unknown }>).map((row) => row.user_id).filter((id): id is string => typeof id === "string"),
      };
    },
    readControls: async () => {
      const { data, error } = await sb.from("minds_controls").select("takeover,kill_scope").eq("id", 1).maybeSingle();
      if (error) return { ok: false };
      return parseControls(data);
    },
    queueDailyRun: async (ownerId, day) => {
      const { data, error } = await sb.rpc("minds_queue_daily_run", { p_owner_id: ownerId, p_local_day: day });
      if (error) return null;
      return typeof data === "string" ? data : null;
    },
  };

  const result: MorningClockResult = await runMorningClock(new Date(), ports);
  return json(result, result.status === "failed" ? 503 : 200);
});
