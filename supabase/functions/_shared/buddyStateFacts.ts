// Buddy's read-only view of the minds: Takeover, the kill switch, orders still waiting, the newest
// log rows and the newest notable events. Pure rules. The edge function does the reads (select only)
// and passes the rows here. Each part says plainly when it could not be read, so Buddy never guesses.

import { cleanLine } from "./buddySiteFacts.ts";
import { MIND_LABELS, type MindLogLine, type MindName } from "./buddyRouter.ts";
import { ownerClock } from "./mindsNightReport.ts";

export const STATE_ORDER_LIMIT = 5;
export const STATE_LOG_LIMIT = 8;
export const STATE_NOTABLE_LIMIT = 5;
export const STATE_DOOR_LIMIT = 8;

export interface StateOrder {
  instruction: string;
  mind: string | null;
}

export interface StateDoor {
  happenedAt: string;
  door: string;
  status: string;
}

export interface StateNotable {
  happenedAt: string;
  title: string;
}

export interface BuddyStateFacts {
  /** The Takeover switch. Null when it could not be read. */
  takeover: boolean | null;
  /** The kill switch as saved: "none", "all", or one mind's key. Null when it could not be read. */
  killScope: string | null;
  orders: { ok: boolean; total: number; items: StateOrder[] };
  log: { ok: boolean; rows: MindLogLine[] };
  doors: { ok: boolean; rows: StateDoor[] };
  notable: { ok: boolean; rows: StateNotable[] };
}

const KILL_WORDS: Record<string, string> = {
  none: "none. Nothing is stopped.",
  all: "all minds are stopped.",
};

function killLine(scope: string | null): string {
  if (scope === null) return "could not be read just now.";
  if (KILL_WORDS[scope]) return KILL_WORDS[scope];
  const label = MIND_LABELS[scope as MindName];
  return label ? `the ${label} is stopped.` : "could not be read just now.";
}

/** The block added to Buddy's instructions for one question. Plain text, one fact per line. */
export function stateFactsBlock(state: BuddyStateFacts): string {
  const lines: string[] = ["THE OPERATIONS RIGHT NOW (read only, from the live database; use only this):"];

  if (state.takeover === null) lines.push("Takeover: could not be read just now. Do not say whether it is on or off.");
  else if (state.takeover) lines.push("Takeover: on. The minds may run their daily work.");
  else lines.push("Takeover: off. No mind runs, and orders wait for the owner.");

  lines.push(`Kill switch: ${killLine(state.killScope)}`);

  if (!state.orders.ok) {
    lines.push("Orders waiting: could not be read just now. Do not say how many are waiting.");
  } else if (state.orders.total === 0) {
    lines.push("Orders waiting: none.");
  } else {
    lines.push(`Orders waiting: ${state.orders.total}. Oldest first:`);
    for (const order of state.orders.items) {
      const label = order.mind ? MIND_LABELS[order.mind as MindName] : undefined;
      const who = label ? `for the ${label}` : "no mind chosen yet";
      lines.push(`- "${order.instruction}" (${who})`);
    }
    if (state.orders.total > state.orders.items.length) {
      lines.push(`(and ${state.orders.total - state.orders.items.length} more not listed here)`);
    }
  }

  if (!state.log.ok) {
    lines.push("Mind steps: could not be read just now. Do not describe what the minds did.");
  } else if (state.log.rows.length === 0) {
    lines.push("Mind steps: none logged yet.");
  } else {
    lines.push(`Newest mind steps (up to ${STATE_LOG_LIMIT}), newest first:`);
    for (const row of state.log.rows.slice(0, STATE_LOG_LIMIT)) {
      const action = cleanLine(row.action, 160) ?? "step";
      const detail = cleanLine(row.detail, 300);
      lines.push(`- ${row.day} ${ownerClock(row.happened_at)}: ${row.mind}, ${action}. ${row.outcome}.${detail ? ` ${detail}` : ""}`);
    }
  }

  if (!state.doors.ok) {
    lines.push("Door sends: could not be read just now.");
  } else if (state.doors.rows.length === 0) {
    lines.push("Door sends: none logged yet.");
  } else {
    lines.push(`Newest door sends (up to ${STATE_DOOR_LIMIT}), newest first:`);
    for (const row of state.doors.rows.slice(0, STATE_DOOR_LIMIT)) {
      const door = cleanLine(row.door, 40) ?? "door";
      const status = cleanLine(row.status, 40) ?? "unknown status";
      lines.push(`- ${ownerClock(row.happenedAt)}: ${door}, ${status}.`);
    }
  }

  if (!state.notable.ok) {
    lines.push("Notable events: could not be read just now.");
  } else if (state.notable.rows.length === 0) {
    lines.push("Notable events: none.");
  } else {
    lines.push(`Newest notable events (up to ${STATE_NOTABLE_LIMIT}):`);
    for (const row of state.notable.rows.slice(0, STATE_NOTABLE_LIMIT)) {
      const title = cleanLine(row.title, 160);
      if (title) lines.push(`- ${ownerClock(row.happenedAt)}: ${title}`);
    }
  }

  return lines.join("\n");
}
