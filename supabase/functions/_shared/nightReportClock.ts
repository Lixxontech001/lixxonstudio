// Buddy's night report on a clock. The time rules are pure. The tick writes each owner's report for the night that is due.
// The tick runs from the buddy-night-clock function, which pg_cron calls through pg_net with the internal function secret.
// The schedule is in supabase/migrations/20261016000000_buddy_night_clock.sql, and it is NOT applied yet.
// The writer is the same one the owner-only function uses (runNightReport). The morning briefing never reads these reports.

import { OWNER_UTC_OFFSET_HOURS, type NightReportWriteResult } from "./mindsNightReport.ts";
import { runNightReport } from "./nightReportRun.ts";

/** A night is due from 23:30 on the owner's clock. */
export const NIGHT_DUE_MINUTES = 23 * 60 + 30;
/** Until 04:00 on the owner's clock, the night that just ended is still written, in case the 23:30 tick missed it. */
export const NIGHT_CATCH_UP_UNTIL_MINUTES = 4 * 60;

/** The owner's day and the minutes since the owner's midnight, for one instant. */
export function ownerDayAndMinutes(now: Date): { day: string; minutes: number } {
  const shifted = new Date(now.getTime() + OWNER_UTC_OFFSET_HOURS * 3_600_000);
  return {
    day: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** The day before a YYYY-MM-DD day, with the calendar rules (month and year ends included). */
export function previousDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}

/** The owner's day whose night report is due at this instant, or null when no night is due. */
export function nightReportDayDue(now: Date): string | null {
  const { day, minutes } = ownerDayAndMinutes(now);
  if (minutes >= NIGHT_DUE_MINUTES) return day;
  if (minutes < NIGHT_CATCH_UP_UNTIL_MINUTES) return previousDay(day);
  return null;
}

export type NightClockResult =
  | { status: "not_due"; day: null; owners: 0; written: 0; already_written: 0; failed: 0 }
  | { status: "done"; day: string; owners: number; written: number; already_written: number; failed: number }
  | { status: "failed"; day: string; reason: string };

/**
 * One tick of the clock. Outside the due window it reads and writes nothing.
 * Inside it, it reads the owner list (role owner only) and writes that night's report for each owner, once.
 * A second tick for the same night is refused by the database and counted as already written.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runNightClock(client: { from: (table: string) => any }, now: Date): Promise<NightClockResult> {
  const day = nightReportDayDue(now);
  if (!day) return { status: "not_due", day: null, owners: 0, written: 0, already_written: 0, failed: 0 };

  let ownerIds: string[];
  try {
    const { data, error } = await client.from("app_admins").select("user_id").eq("role", "owner");
    if (error || !Array.isArray(data)) return { status: "failed", day, reason: "The owner could not be read. Nothing was written." };
    ownerIds = [...new Set((data as Array<{ user_id?: unknown }>).map((row) => row.user_id).filter((id): id is string => typeof id === "string"))];
  } catch {
    return { status: "failed", day, reason: "The owner could not be read. Nothing was written." };
  }

  let written = 0;
  let alreadyWritten = 0;
  let failed = 0;
  for (const ownerId of ownerIds) {
    const result: NightReportWriteResult = await runNightReport(client, ownerId, day);
    if (result.status === "written") written += 1;
    else if (result.status === "already_written") alreadyWritten += 1;
    else failed += 1;
  }
  return { status: "done", day, owners: ownerIds.length, written, already_written: alreadyWritten, failed };
}
