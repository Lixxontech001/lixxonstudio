// The once-a-day run, decided by plain rules. Pure logic: the doors (database and the placement run) are passed in.
// Takeover off, or Kill on the run's minds, means nothing runs and nothing is read or written. Orders stay waiting.
// A run on the owner's request picks the oldest runnable waiting order. The daily trigger first queues today's
// order (once per day, in the database) and then runs it.

import type { LanedOrder } from "./buddyOrders.ts";
import type { KillScope } from "./placementRun.ts";

export type DayTrigger = "owner" | "daily";

export const TAKEOVER_OFF_DETAIL = "Takeover is off. Nothing runs. Your orders stay waiting.";
export const KILL_BLOCK_DETAIL = "A Kill switch is on for a mind this run needs. Nothing runs. Your orders stay waiting.";
export const NOTHING_TO_RUN_DETAIL = "No waiting order can run right now.";
export const NOT_WAITING_DETAIL = "That order is not waiting, or it cannot run yet.";

/** Kill values that stop the run. Analyst and CEO are not needed by a placement, so they do not block it. */
const KILL_BLOCKS: readonly KillScope[] = ["all", "strategist", "executioner", "auditor"];

/** Why nothing may run, or null when the run may go ahead. Takeover is checked first. */
export function blockedDetail(takeover: boolean, killScope: KillScope): string | null {
  if (!takeover) return TAKEOVER_OFF_DETAIL;
  if (KILL_BLOCKS.includes(killScope)) return KILL_BLOCK_DETAIL;
  return null;
}

export interface DayRunInput {
  localDay: string;
  trigger: DayTrigger;
  takeover: boolean;
  killScope: KillScope;
  waiting: LanedOrder[];
  /** The order the owner named, if any. Only a runnable waiting order is accepted. */
  orderId?: string | null;
}

export type DayPlan =
  | { kind: "none"; detail: string }
  | { kind: "run_order"; orderId: string; detail: string }
  | { kind: "create_daily"; localDay: string; detail: string };

export function isRunnable(order: LanedOrder): boolean {
  return order.lane.lane === "product_line" || order.lane.lane === "daily_run";
}

export function planDayRun(input: DayRunInput): DayPlan {
  const blocked = blockedDetail(input.takeover, input.killScope);
  if (blocked) return { kind: "none", detail: blocked };
  if (input.trigger === "daily") {
    return { kind: "create_daily", localDay: input.localDay, detail: "Queuing today's run." };
  }
  const runnable = input.waiting.filter(isRunnable);
  if (input.orderId) {
    const named = runnable.find((order) => order.id === input.orderId);
    if (!named) return { kind: "none", detail: NOT_WAITING_DETAIL };
    return { kind: "run_order", orderId: named.id, detail: "Running the order you chose." };
  }
  const oldest = runnable[0];
  if (!oldest) return { kind: "none", detail: NOTHING_TO_RUN_DETAIL };
  return { kind: "run_order", orderId: oldest.id, detail: "Running your oldest waiting order." };
}

export interface DayRunPorts {
  /** Queues today's daily order. Returns its id, or null when it could not be saved. Idempotent per day. */
  createDailyOrder(localDay: string): Promise<string | null>;
  /** Runs one order through the placement run and reports the plain outcome. */
  runOrder(orderId: string): Promise<{ status: string; detail: string }>;
}

export interface DayRunResult {
  status: string;
  detail: string;
  orderId: string | null;
}

/** Runs the day once: decides with planDayRun, then calls the ports. Nothing is called when the plan says none. */
export async function runDay(input: DayRunInput, ports: DayRunPorts): Promise<DayRunResult> {
  const plan = planDayRun(input);
  if (plan.kind === "none") return { status: "nothing_to_do", detail: plan.detail, orderId: null };
  if (plan.kind === "create_daily") {
    const id = await ports.createDailyOrder(plan.localDay);
    if (!id) return { status: "held", detail: "Today's order could not be saved. Nothing changed.", orderId: null };
    const outcome = await ports.runOrder(id);
    return { status: outcome.status, detail: outcome.detail, orderId: id };
  }
  const outcome = await ports.runOrder(plan.orderId);
  return { status: outcome.status, detail: outcome.detail, orderId: plan.orderId };
}
