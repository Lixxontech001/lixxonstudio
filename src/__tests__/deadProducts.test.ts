import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEAD_TELL_LIMIT,
  deadProductWindows,
  looksDead,
  planDeadProductActs,
  salesByProduct,
  type PaidItem,
  type ProductSales,
} from '../../supabase/functions/_shared/deadProducts';
import { isoWeekKey } from '../../supabase/functions/_shared/buddyWeek';

// Phase I slice 4: a product looks dead only when it sold nothing this week and nothing the 7 days before, and only
// when it has been on sale through both weeks. Buddy never deletes a product, and the owner decides what to do.

const NOW = new Date('2026-10-10T12:00:00Z');
const WINDOWS = deadProductWindows(NOW);
const DAY = '2026-10-10';

function product(overrides: Partial<ProductSales> = {}): ProductSales {
  return {
    id: 'p1',
    name: 'Calm Skin Guide',
    createdAt: '2026-08-01T10:00:00Z',
    paidThisWeek: 0,
    paidLastWeek: 0,
    ...overrides,
  };
}

describe('looksDead: two empty weeks, and never day one', () => {
  it('is dead when nothing was paid this week and nothing last week', () => {
    expect(looksDead(product(), WINDOWS)).toBe(true);
  });

  it('is not dead when either week had a paid order', () => {
    expect(looksDead(product({ paidThisWeek: 1 }), WINDOWS)).toBe(false);
    expect(looksDead(product({ paidLastWeek: 2 }), WINDOWS)).toBe(false);
  });

  it('is never day one: a product made inside the earlier week has not been on sale long enough', () => {
    const insideEarlierWeek = new Date(Date.parse(WINDOWS.lastStart) + 3_600_000).toISOString();
    expect(looksDead(product({ createdAt: insideEarlierWeek }), WINDOWS)).toBe(false);
    expect(looksDead(product({ createdAt: WINDOWS.lastStart }), WINDOWS)).toBe(true);
  });

  it('a made-date that cannot be read is never a death sentence', () => {
    expect(looksDead(product({ createdAt: null }), WINDOWS)).toBe(false);
    expect(looksDead(product({ createdAt: 'not a date' }), WINDOWS)).toBe(false);
  });
});

describe('salesByProduct: paid items counted for the two windows only', () => {
  const items: PaidItem[] = [
    { productId: 'p1', at: '2026-10-09T09:00:00Z' }, // this week
    { productId: 'p1', at: '2026-10-05T09:00:00Z' }, // this week
    { productId: 'p1', at: '2026-10-01T09:00:00Z' }, // last week
    { productId: 'p2', at: '2026-09-20T09:00:00Z' }, // older than the two windows
    { productId: null, at: '2026-10-08T09:00:00Z' }, // no product
    { productId: 'p3', at: 'not a date' }, // unreadable time
  ];

  it('counts each product in the week it was paid', () => {
    const sales = salesByProduct(items, WINDOWS);
    expect(sales.get('p1')).toEqual({ thisWeek: 2, lastWeek: 1 });
    expect(sales.get('p2')).toBeUndefined();
    expect(sales.get('p3')).toBeUndefined();
  });
});

describe('planDeadProductActs: the act words, and only the dead ones', () => {
  const products: ProductSales[] = [
    product({ id: 'p1', name: 'Calm Skin Guide' }),
    product({ id: 'p2', name: 'Bright Kit', paidThisWeek: 2 }),
    product({ id: 'p3', name: 'Night Cream', createdAt: '2026-10-08T00:00:00Z' }),
  ];

  it('names only the dead products, through the act list', () => {
    const acts = planDeadProductActs(products, WINDOWS, DAY);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ kind: 'product_looks_dead', mind: 'strategist', outcome: 'done' });
    expect(acts[0].title).toBe('Looks dead: "Calm Skin Guide"');
    expect(acts[0].detail).toContain('Paid orders: 0 this week and 0 last week.');
  });

  it('never says delete, and hands the choice to the owner', () => {
    const [act] = planDeadProductActs(products, WINDOWS, DAY);
    expect(act.detail).toContain('Nothing was deleted.');
    expect(act.detail).toMatch(/You decide: write an article that fits it, or make a new product yourself\./);
    expect(act.detail.toLowerCase()).not.toMatch(/\bdeleted? it\b|\bremove\b|\bdelete the\b/);
  });

  it('tells at most the limit in one day', () => {
    const many = Array.from({ length: DEAD_TELL_LIMIT + 3 }, (_, index) => product({ id: `p${index}`, name: `Guide ${index}` }));
    expect(planDeadProductActs(many, WINDOWS, DAY)).toHaveLength(DEAD_TELL_LIMIT);
  });

  it('keys the telling so the same finding is not told every morning', () => {
    // The run passes the owner's week, not the day, so the database refuses a second telling in the same week.
    const [act] = planDeadProductActs(products, WINDOWS, isoWeekKey(DAY));
    expect(act.key).toBe(`product_looks_dead:Calm Skin Guide:${isoWeekKey(DAY)}`);
  });
});

describe('the day run reports a dead product through the act list, and never deletes', () => {
  const run = readFileSync(path.join(process.cwd(), 'supabase/functions/minds-run-placement/index.ts'), 'utf8');
  const dayPacks = readFileSync(path.join(process.cwd(), 'supabase/functions/_shared/deadProducts.ts'), 'utf8');

  it('reads the two windows, checks the products, and reports each act', () => {
    expect(run).toContain('await scanDeadProducts(sb, localDay, told)');
    expect(run).toContain('for (const act of await scanDeadProducts(sb, localDay, told)) {');
    expect(run).toContain('await reportAct(act, acts);');
    expect(run).toContain('planDeadProductActs(products, windows, localDay)');
    expect(run).toContain('.from("order_items")');
  });

  it('never deletes a product from anywhere in the run', () => {
    expect(run).not.toMatch(/\.from\("products"\)[\s\S]{0,200}?\.delete\(/);
    expect(dayPacks).not.toContain('.delete(');
  });

  it('keeps "looks dead" honest about what it is: two weeks of paid orders, not one quiet morning', () => {
    expect(dayPacks).toContain('product.paidThisWeek > 0 || product.paidLastWeek > 0');
    expect(dayPacks).toContain('made <= earlierStart');
  });
});
