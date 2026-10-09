// Waiting orders: which ones a mind may run in this phase (product lines on articles), and the honest
// reason for every other order. Pure logic. The database read is passed in, so tests can use fake rows.

import { MIND_KEYS, type MindName } from "./buddyRouter.ts";

export const WAITING_READ_LIMIT = 50;

export interface BuddyOrder {
  id: string;
  instruction: string;
  mind: MindName | null;
  created_at: string;
}

export type OrderLane =
  | { lane: "product_line" }
  | { lane: "held"; reason: string };

export interface LanedOrder extends BuddyOrder {
  lane: OrderLane;
}

export const HELD_LATER_PHASE = "Posting to channels, video and email come in a later phase. This order waits for you.";
export const HELD_MONEY = "Minds do not change prices, spend money or refund. This order waits for you.";
export const HELD_CREATE = "Creating a product is your job. Tell Buddy the angle and Buddy will say what to create.";
export const HELD_UNKNOWN = "Buddy does not know yet how to run this kind of order. It waits for you.";

/** Channels, video, email and push: the later phases. Checked first, so "post it to instagram" waits. */
const LATER_PHASE =
  /\b(instagram|tiktok|facebook|pinterest|telegram|bluesky|mastodon|tumblr|discord|blogger|medium|youtube|pixelfed|wordpress|podcast|vimeo|video|videos|reel|reels|email|e-mail|newsletter|push|whatsapp|channel|channels|social|tweet|post\s+(it\s+)?(to|on)|publish\s+(it\s+)?(to|on))\b/i;
/** Prices, spending and refunds are never run by a mind. */
const MONEY = /\b(price|prices|pricing|discount|refund|spend|pay|ads?|advert|advertising)\b/i;
/** Creating a product is the owner's job. "Add a product to the guide" is a product line, not a create. */
const CREATE_PRODUCT = /\b(create|build|make|set\s+up)\s+((a|an|the|new|another)\s+)*(product|kit|bundle|sku)s?\b/i;
/** Work this phase can run: a product line on an article, or a swap of which products sit on it. */
const PRODUCT_LINE = /\b(article|articles|blog|guide|paragraph|sentence|product|products|shop|affiliate|digital|swap|replace)\b/i;

/** Sorts one order into the lane it belongs to. Order of checks matters: money and channels are held first. */
export function laneFor(instruction: string): OrderLane {
  if (MONEY.test(instruction)) return { lane: "held", reason: HELD_MONEY };
  if (LATER_PHASE.test(instruction)) return { lane: "held", reason: HELD_LATER_PHASE };
  if (CREATE_PRODUCT.test(instruction)) return { lane: "held", reason: HELD_CREATE };
  if (PRODUCT_LINE.test(instruction)) return { lane: "product_line" };
  return { lane: "held", reason: HELD_UNKNOWN };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Keeps only rows that look like a waiting order. Anything malformed is dropped, never guessed at. */
export function parseWaitingRow(row: unknown): BuddyOrder | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string" || typeof row.instruction !== "string" || typeof row.created_at !== "string") return null;
  if (!row.instruction.trim()) return null;
  const mind = typeof row.mind === "string" && (MIND_KEYS as readonly string[]).includes(row.mind) ? (row.mind as MindName) : null;
  return { id: row.id, instruction: row.instruction, mind, created_at: row.created_at };
}

export type WaitingRead = { ok: true; orders: LanedOrder[] } | { ok: false };

/**
 * Reads the waiting orders, oldest first, each with its lane. `fetchRows` returns null when the read fails.
 * A failed read is reported as not ok, so no caller can mistake it for "no orders".
 */
export async function readWaitingOrders(fetchRows: () => Promise<unknown[] | null>): Promise<WaitingRead> {
  const rows = await fetchRows();
  if (!rows) return { ok: false };
  const orders = rows
    .map(parseWaitingRow)
    .filter((order): order is BuddyOrder => order !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((order) => ({ ...order, lane: laneFor(order.instruction) }));
  return { ok: true, orders };
}
