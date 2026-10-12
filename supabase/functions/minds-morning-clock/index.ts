// The 08:00 morning clock. Called by pg_cron through pg_net with the internal function secret, never by a browser.
// It queues the owner's day run, and only when Takeover is On, then runs the morning pipeline: the Analyst reads,
// the Strategist plans, the CEO puts the day in order, and the Executioner acts through the same run the owner
// starts by hand (minds-run-placement). The rules are in _shared/morningClock.ts and _shared/mindPipeline.ts.
//
// It has no owner session, so it does not use the owner check; the internal secret is the only way in. Nothing here
// posts, spends, publishes, writes an article or creates a product: every live change happens in the owner path,
// behind the Auditor, exactly as it does when the owner presses Run today.

import { env, json, serviceClient } from "../_shared/http.ts";
import { callInternal, internalCallDetail } from "../_shared/internalCall.ts";
import { LIVING_MINDS, STOPPED_ACTION, clip, type LivingMind } from "../_shared/buddyLivingMinds.ts";
import { makeMindThink } from "../_shared/mindThink.ts";
import { briefText, runMindPipeline, type PipelineInput, type PipelineResult } from "../_shared/mindPipeline.ts";
import { morningRunDayDue, runMorningClock, type MorningClockPorts, type MorningClockResult, type PipelineRunSummary } from "../_shared/morningClock.ts";
import { weekWindows } from "../_shared/buddyWeek.ts";
import { readMemoryBlock } from "../_shared/mindMemoryServer.ts";
import type { KillScope } from "../_shared/placementRun.ts";

/** The Kill values the minds understand. Anything else counts as "all", the stopped direction. */
const KILL_SCOPES: readonly KillScope[] = ["none", "all", "analyst", "strategist", "ceo", "executioner", "auditor"];
/** The longest a run call may take before the clock gives up on it and says so honestly. */
const RUN_TIMEOUT_MS = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

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

/** This week and last week, as counts only. A failed read says so, and is never a guess. Same shape as the owner path. */
async function readMindFacts(sb: ServiceClient): Promise<string> {
  const w = weekWindows(new Date());
  const views = (from: string, to: string) =>
    sb.from("article_views").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to);
  const paid = (from: string, to: string) =>
    sb.from("orders").select("id", { count: "exact", head: true }).eq("payment_status", "paid").gte("created_at", from).lt("created_at", to);
  const [tv, lv, tp, lp] = await Promise.all([views(w.thisStart, w.end), views(w.lastStart, w.thisStart), paid(w.thisStart, w.end), paid(w.lastStart, w.thisStart)]);
  if (tv.error || lv.error || tp.error || lp.error) return "The site numbers could not be read this run.";
  return `Last 7 days: ${tv.count ?? 0} article views and ${tp.count ?? 0} paid orders. The 7 days before: ${lv.count ?? 0} article views and ${lp.count ?? 0} paid orders.`;
}

/** Today's rows for the three thinking minds: which already ran, and which Kill stopped today. */
async function readMindDayRows(sb: ServiceClient, owner: string, day: string): Promise<{ doneToday: LivingMind[]; stoppedToday: LivingMind[] }> {
  const { data, error } = await sb.from("minds_daily_log").select("mind,action,outcome").eq("owner_id", owner).eq("day", day).in("mind", [...LIVING_MINDS]);
  if (error) return { doneToday: [], stoppedToday: [] };
  const rows = (data ?? []) as Array<{ mind: string; action: string; outcome: string }>;
  return {
    doneToday: LIVING_MINDS.filter((mind) => rows.some((row) => row.mind === mind && row.outcome === "done")),
    stoppedToday: LIVING_MINDS.filter((mind) => rows.some((row) => row.mind === mind && row.action === STOPPED_ACTION)),
  };
}

/** True when the day's order is already finished, so the 08:00 run does not run the day twice. */
async function dayOrderDone(sb: ServiceClient, owner: string, day: string): Promise<boolean> {
  const { data, error } = await sb
    .from("buddy_orders")
    .select("status")
    .eq("owner_id", owner)
    .like("instruction", `Daily run for ${day}:%`)
    .not("status", "eq", "waiting")
    .limit(1);
  if (error) return true; // An unreadable order state never runs the day twice: the clock waits for the owner.
  return Array.isArray(data) && data.length > 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const expected = env("INTERNAL_FN_SECRET");
  const supplied = req.headers.get("x-internal-secret") || "";
  if (!expected || !safeEqual(supplied, expected)) return json({ error: "Forbidden" }, 403);

  let sb: ServiceClient;
  try {
    sb = serviceClient();
  } catch {
    return json({ error: "Buddy is not configured." }, 503);
  }

  const functionsUrl = (env("SUPABASE_URL", "SUPABASE_PROJECT_URL") || "").replace(/\/+$/, "");
  // The day's run is the owner's own run, called on the server with the internal secret and a checked owner id.
  const think = makeMindThink(async (secretName: string) => {
    try {
      const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: secretName });
      return !error && typeof data === "string" && data.length > 0 ? data : null;
    } catch {
      return null;
    }
  });

  const runPipelineForOwner = async (ownerId: string, day: string): Promise<PipelineRunSummary> => {
    const controls = parseControls(((await sb.from("minds_controls").select("takeover,kill_scope").eq("id", 1).maybeSingle()).data));
    if (!controls.ok) return { status: "held", detail: "Minds settings could not be read. Nothing ran.", minds: 0, plans: 0, changed: 0 };
    const [facts, rows, done] = await Promise.all([readMindFacts(sb), readMindDayRows(sb, ownerId, day), dayOrderDone(sb, ownerId, day)]);
    let memory: string | null = null;
    try {
      memory = await readMemoryBlock(sb, ownerId, facts);
    } catch {
      // Memory is extra. A failed read leaves the minds with the facts alone, never with invented words.
      memory = null;
    }
    const input: PipelineInput = {
      day,
      takeover: controls.takeover,
      killScope: controls.killScope,
      facts,
      memory,
      orders: [],
      doneToday: rows.doneToday,
      stoppedToday: rows.stoppedToday,
      alreadyRanToday: done,
    };
    const result: PipelineResult = await runMindPipeline(input, {
      think,
      log: async (entry) => {
        await sb.from("minds_daily_log").insert({
          owner_id: ownerId,
          day,
          mind: entry.mind,
          action: clip(entry.action, 120),
          outcome: entry.outcome,
          detail: clip(entry.detail, 500),
          order_id: null,
        });
      },
      runExecutioner: async (brief) => {
        if (!functionsUrl) return { status: "failed", detail: "The run address is not configured. Nothing changed.", changed: 0 };
        const answer = await callInternal(
          `${functionsUrl}/minds-run-placement`,
          expected,
          { local_day: day, owner_id: ownerId, brief: briefText(brief) },
          fetch,
          RUN_TIMEOUT_MS,
        );
        if (!answer.ok) return { status: "failed", detail: internalCallDetail(answer), changed: 0 };
        const status = typeof answer.body?.status === "string" ? answer.body.status : "done";
        const detail = typeof answer.body?.detail === "string" ? answer.body.detail : "The day ran.";
        // A run that applied a change says so; anything else made no live change.
        return { status, detail, changed: status === "applied" ? 1 : 0 };
      },
    });
    return {
      status: result.status,
      detail: result.detail,
      minds: result.steps.filter((step) => step.mind !== "executioner").length,
      plans: result.plans,
      changed: result.changed,
    };
  };

  const now = new Date();
  const dueDay = morningRunDayDue(now);
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
    // The thinking and the run happen only when the clock is inside the window, the day was queued, and Takeover is on.
    runPipeline: dueDay ? runPipelineForOwner : undefined,
  };

  const result: MorningClockResult = await runMorningClock(now, ports);
  return json(result, result.status === "failed" ? 503 : 200);
});

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
