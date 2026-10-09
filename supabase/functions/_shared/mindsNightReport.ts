// Buddy's night report: the rules, and a writer that saves one report per owner per day.
// Rules:
// - "Nothing ran" is said only when the daily log shows no mind action for that day.
// - If any read fails, nothing is written. A failed read is never reported as a quiet night.
// - Times are the owner's own clock. The report is owner-only and never names a country.
// - A second write for the same day is refused by the database, so a retry cannot duplicate it.

/** The owner's clock. Fixed offset, no daylight saving, so it is stated plainly. */
export const OWNER_UTC_OFFSET_HOURS = 1;
export const NIGHT_REPORT_BODY_LIMIT = 20000;
export const NOTHING_RAN_LINE = "Nothing ran last night. No mind took an action.";

const MIND_NAMES: Record<string, string> = {
  buddy: "Buddy",
  analyst: "Analyst",
  strategist: "Strategist",
  ceo: "CEO",
  executioner: "Executioner",
  auditor: "Auditor",
  owner: "You",
};

export type MindOutcome = "done" | "skipped" | "blocked" | "failed";

export interface MindLogRow {
  happened_at: string;
  mind: string;
  action: string;
  outcome: MindOutcome;
  detail: string;
}

export interface NotableEventRow {
  happened_at: string;
  mind: string;
  kind: string;
  title: string;
  detail: string;
}

export interface OrderRow {
  id: string;
  instruction: string;
  mind: string | null;
  status: "waiting" | "done" | "blocked";
  blocked_reason: string | null;
}

export interface NightReportInput {
  day: string; // YYYY-MM-DD, the owner's day
  log: MindLogRow[];
  events: NotableEventRow[];
  orders: OrderRow[];
}

export interface NightReport {
  day: string;
  title: string;
  body: string;
  ran: boolean;
  counts: Record<MindOutcome, number>;
}

/** HH:MM on the owner's clock. Bad timestamps show as a dash, never a guess. */
export function ownerClock(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "--:--";
  const shifted = new Date(time + OWNER_UTC_OFFSET_HOURS * 3_600_000);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

/** The UTC range that covers one owner day. Used to read events by time. */
export function ownerDayWindow(day: string): { start: string; end: string } {
  const [year, month, date] = day.split("-").map(Number);
  const start = Date.UTC(year, month - 1, date) - OWNER_UTC_OFFSET_HOURS * 3_600_000;
  return { start: new Date(start).toISOString(), end: new Date(start + 86_400_000).toISOString() };
}

function mindName(mind: string): string {
  return MIND_NAMES[mind] ?? "A mind";
}

const OUTCOME_WORD: Record<MindOutcome, string> = {
  done: "Done",
  skipped: "Skipped",
  blocked: "Blocked",
  failed: "Failed",
};

/** Builds the report text from facts that were already read. Pure: no database, no clock. */
export function buildNightReport(input: NightReportInput): NightReport {
  const counts: Record<MindOutcome, number> = { done: 0, skipped: 0, blocked: 0, failed: 0 };
  for (const row of input.log) counts[row.outcome] += 1;
  // Skipped steps did not run. They do not make a night busy.
  const ran = input.log.some((row) => row.outcome !== "skipped");

  const lines: string[] = [];
  if (ran) {
    lines.push(`${input.log.length} step${input.log.length === 1 ? "" : "s"} logged for ${input.day}.`);
    lines.push("");
    lines.push("What the minds did");
    for (const row of input.log) {
      const detail = row.detail.trim() ? ` ${row.detail.trim()}` : "";
      lines.push(`${ownerClock(row.happened_at)} ${mindName(row.mind)}: ${row.action}. ${OUTCOME_WORD[row.outcome]}.${detail}`);
    }
  } else if (input.log.length > 0) {
    const reasons = input.log
      .map((row) => `${mindName(row.mind)}: ${row.detail.trim() || row.action}`)
      .join("; ");
    lines.push(NOTHING_RAN_LINE);
    lines.push(`${input.log.length} step${input.log.length === 1 ? " was" : "s were"} skipped. ${reasons}.`);
  } else {
    lines.push(NOTHING_RAN_LINE);
  }

  const blocked = input.orders.filter((order) => order.status === "blocked");
  const waiting = input.orders.filter((order) => order.status === "waiting");
  const done = input.orders.filter((order) => order.status === "done");
  lines.push("");
  lines.push("Orders");
  lines.push(`Waiting: ${waiting.length}. Done: ${done.length}. Blocked: ${blocked.length}.`);
  for (const order of blocked) {
    lines.push(`Blocked order: ${order.instruction}. Reason: ${order.blocked_reason ?? "not given"}.`);
  }

  if (input.events.length > 0) {
    lines.push("");
    lines.push("Notable");
    for (const event of input.events) {
      const detail = event.detail.trim() ? ` ${event.detail.trim()}` : "";
      lines.push(`${ownerClock(event.happened_at)} ${event.title}.${detail}`);
    }
  }

  return {
    day: input.day,
    title: `Night report for ${input.day}`,
    body: lines.join("\n").slice(0, NIGHT_REPORT_BODY_LIMIT),
    ran,
    counts,
  };
}

/** The reads and the one write the writer needs. The server adapter below implements it for the owner. */
export interface NightReportSource {
  readLog(day: string): Promise<MindLogRow[]>;
  readEvents(day: string): Promise<NotableEventRow[]>;
  readOrders(day: string): Promise<OrderRow[]>;
  saveReport(row: { report_date: string; title: string; body: string }): Promise<"written" | "already_written">;
}

export type NightReportWriteResult =
  | { status: "written" | "already_written"; ran: boolean }
  | { status: "failed"; ran: false; reason: string };

/** Reads the day, builds the report, and saves it. Reads that fail stop the write. */
export async function writeNightReport(source: NightReportSource, day: string): Promise<NightReportWriteResult> {
  let facts: NightReportInput;
  try {
    const [log, events, orders] = await Promise.all([source.readLog(day), source.readEvents(day), source.readOrders(day)]);
    facts = { day, log, events, orders };
  } catch {
    return { status: "failed", ran: false, reason: "The day could not be read. Nothing was written." };
  }
  const report = buildNightReport(facts);
  try {
    const status = await source.saveReport({ report_date: day, title: report.title, body: report.body });
    return { status, ran: report.ran };
  } catch {
    return { status: "failed", ran: false, reason: "The report could not be saved. Try again later." };
  }
}

/**
 * The server adapter. It reads only this owner's rows, through the caller's client.
 * Orders come from two reads: everything still waiting, and anything changed on the day.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serviceNightReportSource(client: { from: (table: string) => any }, ownerId: string): NightReportSource {
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  return {
    async readLog(day) {
      const { data, error } = await client.from("minds_daily_log").select("happened_at,mind,action,outcome,detail")
        .eq("owner_id", ownerId).eq("day", day).order("happened_at", { ascending: true });
      check(error);
      return (data ?? []) as MindLogRow[];
    },
    async readEvents(day) {
      const range = ownerDayWindow(day);
      const { data, error } = await client.from("minds_notable_events").select("happened_at,mind,kind,title,detail")
        .eq("owner_id", ownerId).gte("happened_at", range.start).lt("happened_at", range.end)
        .order("happened_at", { ascending: true });
      check(error);
      return (data ?? []) as NotableEventRow[];
    },
    async readOrders(day) {
      const range = ownerDayWindow(day);
      const waiting = await client.from("buddy_orders").select("id,instruction,mind,status,blocked_reason")
        .eq("owner_id", ownerId).eq("status", "waiting");
      check(waiting.error);
      const changed = await client.from("buddy_orders").select("id,instruction,mind,status,blocked_reason")
        .eq("owner_id", ownerId).gte("updated_at", range.start).lt("updated_at", range.end);
      check(changed.error);
      const byId = new Map<string, OrderRow>();
      for (const row of [...(waiting.data ?? []), ...(changed.data ?? [])] as OrderRow[]) byId.set(row.id, row);
      return [...byId.values()];
    },
    async saveReport(row) {
      const { data, error } = await client.from("buddy_reports")
        .upsert({ owner_id: ownerId, ...row }, { onConflict: "owner_id,report_date", ignoreDuplicates: true })
        .select("id");
      check(error);
      return Array.isArray(data) && data.length > 0 ? "written" : "already_written";
    },
  };
}
