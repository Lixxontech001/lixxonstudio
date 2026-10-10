// Notable events that come from the shop's own records: a paid order, a day's product clicks, a traffic
// source seen for the first time, and a placement job that really changed an article.
// Pure rules. The day run passes in the reads and the writer. Each event has a source key, so the same
// thing is written, and buzzed, once. Owner-only copy: plain words, USD only, no country, no em dash.

import { cleanLine } from "./buddySiteFacts.ts";

export const SALES_LOOKBACK_HOURS = 48;
export const ORDER_READ_LIMIT = 200;
export const CLICK_READ_LIMIT = 2000;
export const TRAFFIC_SOURCE_LIMIT = 20;
const SOURCE_MAX = 60;

export type NotableSourceKind = "sale" | "product_click" | "traffic_new_kind" | "job_finished";

export interface NotablePlan {
  /** Unique per owner. The database refuses a second row with the same key. */
  key: string;
  kind: NotableSourceKind;
  mind: "buddy" | "strategist";
  title: string;
  detail: string;
}

export interface OrderRow {
  id: string;
  amount: number | null;
  currency: string | null;
}

export interface ClickRow {
  source: string | null;
}

export interface ScanWindow {
  now: Date;
  localDay: string;
  /** Start and end of the owner's local day, as ISO times. */
  dayStartIso: string;
  dayEndIso: string;
}

export interface NotablePorts {
  /** Paid orders since the given time. Null when they cannot be read. */
  readPaidOrders(sinceIso: string): Promise<OrderRow[] | null>;
  /** Product clicks between two times. Null when they cannot be read. */
  readClicks(startIso: string, endIso: string): Promise<ClickRow[] | null>;
  /** Which of these sources had any click before the given time. Null when it cannot be read. */
  readEarlierSources(sources: string[], beforeIso: string): Promise<string[] | null>;
  /** Writes one notable event (and buzzes when its kind buzzes). True only when a new row was written. */
  record(plan: NotablePlan): Promise<boolean>;
}

export interface ScanResult {
  written: number;
  skipped: number;
  /** Which reads could not be made. Those parts were not written; the rest still was. */
  unreadable: string[];
}

/** One line of plain text for a traffic source. Null when nothing is left. */
export function cleanSource(value: string | null): string | null {
  return cleanLine(value ?? undefined, SOURCE_MAX);
}

/** A sale per paid order. Money is shown in USD only; any other currency gets the title with no amount. */
export function planSaleNotables(orders: OrderRow[]): NotablePlan[] {
  const plans: NotablePlan[] = [];
  for (const order of orders.slice(0, ORDER_READ_LIMIT)) {
    const id = typeof order.id === "string" ? order.id.trim() : "";
    if (!id) continue;
    const usd = order.currency === null || order.currency.toUpperCase() === "USD";
    const amount = typeof order.amount === "number" && Number.isFinite(order.amount) && order.amount >= 0 ? order.amount : null;
    const title = usd && amount !== null ? `Paid order: USD ${amount.toFixed(2)}.` : "Paid order.";
    plans.push({
      key: `sale:${id}`,
      kind: "sale",
      mind: "buddy",
      title,
      detail: "A paid order came in on the shop. Buddy changed nothing.",
    });
  }
  return plans;
}

/** One summary per local day, when there were clicks. The count is as of the first run that sees the day. */
export function planClickNotable(clicks: ClickRow[], localDay: string): NotablePlan[] {
  const count = clicks.length;
  if (count === 0) return [];
  return [{
    key: `clicks:${localDay}`,
    kind: "product_click",
    mind: "buddy",
    title: `${count} product ${count === 1 ? "click" : "clicks"} today`,
    detail: "Shop product clicks for today. Counted by the first day run that saw them.",
  }];
}

/** A traffic source with clicks today and none before today. Each source is announced once, ever. */
export function planTrafficNotables(todaySources: string[], earlierSources: string[]): NotablePlan[] {
  const earlier = new Set(earlierSources.map(cleanSource).filter((item): item is string => item !== null));
  const seen = new Set<string>();
  const plans: NotablePlan[] = [];
  for (const raw of todaySources) {
    const source = cleanSource(raw);
    if (!source || earlier.has(source) || seen.has(source)) continue;
    seen.add(source);
    plans.push({
      key: `traffic:${source}`,
      kind: "traffic_new_kind",
      mind: "buddy",
      title: `New traffic source: ${source}`,
      detail: "This source sent shop clicks today, and none before today.",
    });
  }
  return plans;
}

/** One event when a placement job really changed an article. Any other status writes nothing. */
export function planJobNotable(status: string, orderId: string | null): NotablePlan | null {
  if (status !== "applied" || !orderId) return null;
  return {
    key: `job:${orderId}`,
    kind: "job_finished",
    mind: "strategist",
    title: "An article change went live",
    detail: "The Strategist planned one change, the Auditor checked it, and it was applied inside the rules. It is in the log.",
  };
}

async function safely<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/**
 * Reads the shop's records and writes the new notable events. Never throws. A failed read only leaves
 * out its own events, and each failure is reported by name.
 */
export async function scanNotableSources(ports: NotablePorts, window: ScanWindow): Promise<ScanResult> {
  const unreadable: string[] = [];
  const plans: NotablePlan[] = [];

  const sinceIso = new Date(window.now.getTime() - SALES_LOOKBACK_HOURS * 3_600_000).toISOString();
  const orders = await safely(() => ports.readPaidOrders(sinceIso));
  if (orders === null) unreadable.push("orders");
  else plans.push(...planSaleNotables(orders));

  const clicks = await safely(() => ports.readClicks(window.dayStartIso, window.dayEndIso));
  if (clicks === null) {
    unreadable.push("clicks");
  } else {
    plans.push(...planClickNotable(clicks, window.localDay));
    const todaySources = [...new Set(clicks.map((row) => cleanSource(row.source)).filter((item): item is string => item !== null))]
      .slice(0, TRAFFIC_SOURCE_LIMIT);
    if (todaySources.length > 0) {
      const earlier = await safely(() => ports.readEarlierSources(todaySources, window.dayStartIso));
      if (earlier === null) unreadable.push("traffic");
      else plans.push(...planTrafficNotables(todaySources, earlier));
    }
  }

  let written = 0;
  let skipped = 0;
  for (const plan of plans) {
    try {
      if (await ports.record(plan)) written += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { written, skipped, unreadable };
}
