// The 08:00 morning run on the owner's clock. The time rules are pure and the tick takes its doors as ports, so a
// whole day of ticks can be replayed in a test with no database, no network and no real clock.
//
// Takeover off, or a Kill that stops the run, means nothing is queued and nothing is read: the run's own rule
// (blockedDetail in runDay.ts) is asked first, so there is one place that decides it. The day's order is queued by
// the database rule public.minds_queue_daily_run, which refuses a second order for the same owner and day and
// refuses everything while Takeover is off.
//
// The tick runs from the minds-morning-clock function, which pg_cron calls through pg_net with the internal
// function secret. The schedule is in supabase/migrations/20261021000000_minds_morning_clock.sql and it is NOT
// applied. Nothing here posts, spends, publishes, writes an article or creates a product.

import { ownerDayAndMinutes } from "./nightReportClock.ts";
import { blockedDetail, TAKEOVER_OFF_DETAIL } from "./runDay.ts";
import type { KillScope } from "./placementRun.ts";

/** The run is due at 08:00 on the owner's clock. */
export const MORNING_RUN_MINUTES = 8 * 60;
/** Until 12:00 on the owner's clock the 08:00 run is still queued, in case a tick was missed. After that the day waits for tomorrow. */
export const MORNING_CATCH_UP_UNTIL_MINUTES = 12 * 60;

/** The owner's day whose 08:00 run is due at this instant, or null when the clock is outside the window. */
export function morningRunDayDue(now: Date): string | null {
  const { day, minutes } = ownerDayAndMinutes(now);
  return minutes >= MORNING_RUN_MINUTES && minutes < MORNING_CATCH_UP_UNTIL_MINUTES ? day : null;
}

/** The plain line for a tick outside the window. Nothing was read and nothing was written. */
export const NOT_DUE_DETAIL = "The 08:00 run is not due. Nothing was read and nothing was written.";
/** The plain line when the owner list cannot be read. Nothing was queued. */
export const OWNERS_UNREADABLE_DETAIL = "The owner could not be read. Nothing was queued.";

export interface MorningClockPorts {
  /** Every owner id. A read failure means nothing runs. */
  readOwners(): Promise<{ ok: true; owners: string[] } | { ok: false }>;
  /** Takeover and the Kill scope, from the one controls row. Anything unreadable counts as stopped. */
  readControls(): Promise<{ ok: true; takeover: boolean; killScope: KillScope } | { ok: false }>;
  /** Queues the day's order through the database rule. Null means the rule refused, so nothing was written. */
  queueDailyRun(ownerId: string, day: string): Promise<string | null>;
}

export interface MorningClockCounts {
  owners: number;
  /** Owners whose day order is in place: queued now, or already queued by an earlier tick. */
  queued: number;
  /** Owners the rules held back: Takeover off, a Kill, or the database refusing the name. */
  skipped: number;
  /** Owners the clock could not read at all. */
  failed: number;
}

export interface MorningClockResult extends MorningClockCounts {
  status: "not_due" | "takeover_off" | "done" | "failed";
  day: string | null;
  detail: string;
}

/**
 * One tick of the clock. Outside the 08:00 window it returns before any port is called, so an idle hour costs
 * nothing. Inside it, every owner is read once, the run's own rule decides whether the day may be queued, and only
 * then is the database rule asked. A second tick on the same day finds the order already there and queues nothing.
 */
export async function runMorningClock(now: Date, ports: MorningClockPorts): Promise<MorningClockResult> {
  const day = morningRunDayDue(now);
  if (!day) {
    return { status: "not_due", day: null, owners: 0, queued: 0, skipped: 0, failed: 0, detail: NOT_DUE_DETAIL };
  }

  let ownerIds: string[];
  try {
    const read = await ports.readOwners();
    if (!read.ok) {
      return { status: "failed", day, owners: 0, queued: 0, skipped: 0, failed: 0, detail: OWNERS_UNREADABLE_DETAIL };
    }
    ownerIds = [...new Set(read.owners)];
  } catch {
    return { status: "failed", day, owners: 0, queued: 0, skipped: 0, failed: 0, detail: OWNERS_UNREADABLE_DETAIL };
  }

  let queued = 0;
  let skipped = 0;
  let failed = 0;
  let stopped = 0;
  let blockedLine = "";

  for (const ownerId of ownerIds) {
    let controls: { ok: true; takeover: boolean; killScope: KillScope } | { ok: false };
    try {
      controls = await ports.readControls();
    } catch {
      failed += 1;
      continue;
    }
    if (!controls.ok) {
      failed += 1;
      continue;
    }

    const blocked = blockedDetail(controls.takeover, controls.killScope);
    if (blocked) {
      skipped += 1;
      stopped += 1;
      blockedLine = blocked;
      continue;
    }

    let orderId: string | null = null;
    try {
      orderId = await ports.queueDailyRun(ownerId, day);
    } catch {
      orderId = null;
    }
    if (orderId) queued += 1;
    else skipped += 1;
  }

  const allStopped = ownerIds.length > 0 && stopped === ownerIds.length;
  const status: MorningClockResult["status"] = allStopped ? "takeover_off" : "done";
  const detail = allStopped
    ? blockedLine || TAKEOVER_OFF_DETAIL
    : `Queued the day for ${queued} of ${ownerIds.length} owner(s).`;
  return { status, day, owners: ownerIds.length, queued, skipped, failed, detail };
}
