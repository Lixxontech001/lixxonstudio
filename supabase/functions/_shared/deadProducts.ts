// Phase I slice 4: a product that looks dead, and the one honest way to say it.
//
// A product looks dead when it sold nothing this week and nothing the 7 days before that. Two empty weeks are what
// "looks dead" means; one quiet morning is not. A product that has not been on sale for two full weeks is never
// called dead: that is the day-one rule. A date that cannot be read is never a death sentence either.
//
// Buddy never deletes a product. It says the product looks dead, and the owner decides: write an article that fits
// it, or make a new product himself. Nothing in this file writes anything.
//
// Pure logic: no database, no Deno globals, so it runs under Vitest. The run passes in the rows it read.

import { productLooksDeadAct, type ActWords } from "./mindActs.ts";
import { weekWindows, type WeekWindows } from "./buddyWeek.ts";

/** How many dead products are named in one day. The rest keep, and are named on later days. */
export const DEAD_TELL_LIMIT = 2;

/** The newest day a product may have been made for it to count: it must have been on sale through both weeks. */
export interface ProductSales {
  id: string;
  name: string;
  /** When the product was made, as an ISO time. Null when it could not be read. */
  createdAt: string | null;
  paidThisWeek: number;
  paidLastWeek: number;
}

/** One paid order item: which product it was, and when it was paid. */
export interface PaidItem {
  productId: string | null;
  at: string;
}

export interface ProductWindowSales {
  thisWeek: number;
  lastWeek: number;
}

/**
 * True when the product looks dead: no paid order this week and none the 7 days before, and it has been on sale for
 * both of those weeks. A missing made-date, or a date inside the earlier week, says no.
 */
export function looksDead(product: ProductSales, windows: WeekWindows): boolean {
  if (product.paidThisWeek > 0 || product.paidLastWeek > 0) return false;
  if (!product.createdAt) return false;
  const made = Date.parse(product.createdAt);
  const earlierStart = Date.parse(windows.lastStart);
  if (Number.isNaN(made) || Number.isNaN(earlierStart)) return false;
  return made <= earlierStart;
}

/**
 * Paid items counted per product for the two windows. An item with no product, or a time that cannot be read, is
 * left out; the rest still count. This is the only place the two weeks are read for products.
 */
export function salesByProduct(items: readonly PaidItem[], windows: WeekWindows): Map<string, ProductWindowSales> {
  const start = Date.parse(windows.thisStart);
  const earlier = Date.parse(windows.lastStart);
  const end = Date.parse(windows.end);
  const counts = new Map<string, ProductWindowSales>();
  for (const item of items) {
    if (!item.productId) continue;
    const at = Date.parse(item.at);
    if (Number.isNaN(at) || Number.isNaN(start) || Number.isNaN(earlier) || at < earlier || at > end) continue;
    const current = counts.get(item.productId) ?? { thisWeek: 0, lastWeek: 0 };
    if (at >= start) current.thisWeek += 1;
    else current.lastWeek += 1;
    counts.set(item.productId, current);
  }
  return counts;
}

/** The act words for every product that looks dead, from the rows and the read. Null when the window is not readable. */
export function planDeadProductActs(
  products: readonly ProductSales[],
  windows: WeekWindows,
  day: string,
  limit: number = DEAD_TELL_LIMIT,
): ActWords[] {
  return products
    .filter((product) => looksDead(product, windows))
    .slice(0, limit)
    .map((product) => productLooksDeadAct(product.name, product.paidThisWeek, product.paidLastWeek, day));
}

/** The two windows of one moment, exposed so the caller reads orders for exactly the same days. */
export function deadProductWindows(now: Date): WeekWindows {
  return weekWindows(now);
}
