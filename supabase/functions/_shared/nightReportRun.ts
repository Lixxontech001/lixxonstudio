// The night report, callable from one place. It checks the owner's day, reads that day, and saves one report.
// Two callers use it: the owner-only Edge function, and the night report clock (_shared/nightReportClock.ts), which
// runs once a night on a schedule that is not applied yet. A night with nothing in it is still reported honestly.
// The report is never copied into the morning briefing. The briefing reads the day's log and events, not this report.

import { serviceNightReportSource, writeNightReport, type NightReportWriteResult } from "./mindsNightReport.ts";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar day in YYYY-MM-DD form. */
export function isNightReportDay(day: unknown): day is string {
  if (typeof day !== "string" || !DAY_RE.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === date;
}

/**
 * Writes the owner's night report for one day. Reads only that owner's rows.
 * A bad day is refused before anything is read. A failed read writes nothing. A second write for the day is refused.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runNightReport(client: { from: (table: string) => any }, ownerId: string, day: unknown): Promise<NightReportWriteResult> {
  if (!isNightReportDay(day)) return { status: "failed", ran: false, reason: "The day is not valid. Nothing was written." };
  return writeNightReport(serviceNightReportSource(client, ownerId), day);
}
