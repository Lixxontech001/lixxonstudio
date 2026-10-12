// Phase I slice 2: the Auditor's one allowed fix. A blocked change gets one repaired plan, checked again; still
// blocked, the change is stopped. Fake brains and fake ports only: no model, no database, no article is changed.
import { describe, expect, it, vi } from 'vitest';
import {
  FIX_ONCE_REFUSED_DETAIL,
  auditPlacement,
  fixPlacementOnce,
  type ShopProduct,
} from '../../supabase/functions/_shared/productPlacement';
import { runPlacementOrder, type ApplyEdit, type RunArticle, type RunInput, type RunLog, type RunPorts } from '../../supabase/functions/_shared/placementRun';

const DAY = '2026-10-14';
const ORDER = '44444444-4444-4444-8444-444444444444';
const ARTICLE: RunArticle = {
  id: '55555555-5555-4555-8555-555555555555',
  title: 'The Calm Skin Routine Guide',
  content: 'A calm routine starts with less.\n\nCleanse once, then moisturise.\n\nChange one thing at a time.',
  liveProductIds: [],
  liveEdits: [],
};
const SHOP: ShopProduct[] = [
  { id: 'p1', name: 'Calm Cleanser', isDigital: false, priceUsd: 12 },
  { id: 'p2', name: 'Calm Guide', isDigital: true, priceUsd: 6 },
];

/** The Auditor blocks this plan: it claims a cure, which the shop rules never allow. */
const BAD_REPLY = JSON.stringify({ paragraph: 2, product_ids: ['p1'], sentences: 'Calm Cleanser cures dryness in a week.' });
/** The one fix keeps everything and drops the promise: the Auditor allows it. */
const GOOD_FIX = JSON.stringify({ paragraph: 2, product_ids: ['p1'], sentences: 'Calm Cleanser is a gentle first step for dry skin.' });
/** A fix that is still blocked: it uses a price that is not the shop price. */
const STILL_BAD = JSON.stringify({ paragraph: 2, product_ids: ['p1'], sentences: 'Calm Cleanser costs $99.00 and is gentle.' });

function fakeRun(replies: string[]) {
  const logs: RunLog[] = [];
  const notables: Array<{ kind: string; title: string; detail: string }> = [];
  const applied: ApplyEdit[] = [];
  let call = 0;
  const think = vi.fn(async () => {
    const text = replies[Math.min(call, replies.length - 1)] ?? replies[replies.length - 1];
    call += 1;
    return { ok: true as const, text };
  });
  const ports: RunPorts = {
    think,
    applyEdit: vi.fn(async (edit: ApplyEdit) => {
      applied.push(edit);
      return { ok: true as const };
    }),
    recordGap: vi.fn(async () => ({ ok: true as const })),
    log: vi.fn(async (entry: RunLog) => {
      logs.push(entry);
    }),
    notable: vi.fn(async (kind: string, title: string, detail: string) => {
      notables.push({ kind, title, detail });
    }),
  };
  const input: RunInput = {
    order: { id: ORDER, instruction: "Place a product on today's article" },
    localDay: DAY,
    takeover: true,
    killScope: 'none',
    shop: SHOP,
    articles: [ARTICLE],
    touchedToday: [],
  };
  return { ports, input, logs, notables, applied, think };
}

describe('Phase I slice 2: one fix, then the change is stopped', () => {
  it('a blocked plan gets exactly one repair, and the Auditor checks the repair', async () => {
    const { ports, input, applied, think, logs } = fakeRun([BAD_REPLY, GOOD_FIX]);
    const outcome = await runPlacementOrder(input, ports);
    expect(outcome.status).toBe('applied');
    expect(think).toHaveBeenCalledTimes(2);
    // The Auditor's own words went back to the Strategist.
    expect(think.mock.calls[1][0].prompt).toContain('Remove the health promise');
    expect(applied).toHaveLength(1);
    expect(applied[0].sentencesAdded).toContain('gentle first step');
    expect(logs.some((row) => row.mind === 'auditor' && row.outcome === 'done' && row.detail.includes('Allowed after one fix'))).toBe(true);
  });

  it('a fix that is still blocked stops that change, and nothing is applied', async () => {
    const { ports, input, applied, notables, logs } = fakeRun([BAD_REPLY, STILL_BAD]);
    const outcome = await runPlacementOrder(input, ports);
    expect(outcome.status).toBe('blocked');
    expect(applied).toEqual([]);
    expect(notables.some((item) => item.kind === 'auditor_blocked')).toBe(true);
    expect(logs.some((row) => row.detail === FIX_ONCE_REFUSED_DETAIL)).toBe(true);
  });

  it('a brain that cannot repair the plan stops the change after one ask', async () => {
    // First answer: a plan the Auditor blocks. Second (the one fix): the brain cannot answer at all.
    const { ports, input, applied, logs, think } = fakeRun([BAD_REPLY, BAD_REPLY]);
    let call = 0;
    (ports.think as unknown as { mockImplementation: (fn: () => Promise<unknown>) => void }).mockImplementation(async () => {
      call += 1;
      return call === 1 ? { ok: true, text: BAD_REPLY } : { ok: false, reason: 'unavailable' };
    });
    const outcome = await runPlacementOrder(input, ports);
    expect(outcome.status).toBe('blocked');
    expect(think).toHaveBeenCalledTimes(2);
    expect(applied).toEqual([]);
    expect(logs.some((row) => row.outcome === 'blocked' && row.detail.startsWith('Blocked.'))).toBe(true);
  });

  it('a first plan the brain cannot make at all is an honest failure, and no fix is asked for', async () => {
    const { ports, input, applied, think } = fakeRun([BAD_REPLY]);
    (ports.think as unknown as { mockImplementation: (fn: () => Promise<unknown>) => void }).mockImplementation(async () => ({ ok: false, reason: 'no_key' }));
    const outcome = await runPlacementOrder(input, ports);
    expect(outcome.status).toBe('cannot_think');
    expect(think).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([]);
  });

  it('the fix is asked once, never twice, even when the repair is empty', async () => {
    const { ports, input, think } = fakeRun([BAD_REPLY, JSON.stringify({ paragraph: -1, product_ids: [], sentences: '' })]);
    const outcome = await runPlacementOrder(input, ports);
    expect(outcome.status).toBe('blocked');
    expect(think).toHaveBeenCalledTimes(2);
  });

  it('a plan the Auditor allows first time is never sent back for a fix', async () => {
    const { ports, input, think, applied } = fakeRun([GOOD_FIX]);
    const outcome = await runPlacementOrder(input, ports);
    expect(outcome.status).toBe('applied');
    expect(think).toHaveBeenCalledTimes(1);
    expect(applied).toHaveLength(1);
  });

  it('the fixed plan edits its own paragraph, not the one the blocked plan named', async () => {
    const moved = JSON.stringify({ paragraph: 0, product_ids: ['p1'], sentences: 'Calm Cleanser is a gentle first step.' });
    const { ports, input, applied } = fakeRun([BAD_REPLY, moved]);
    await runPlacementOrder(input, ports);
    expect(applied[0].lineIndex).toBe(0);
  });
});

describe('Phase I slice 2: the one-fix helper is the same Auditor', () => {
  it('the repaired plan is read through the same reader and checked with the same Auditor', async () => {
    const think = vi.fn(async () => ({ ok: true as const, text: GOOD_FIX }));
    const candidate = await fixPlacementOnce({ id: ARTICLE.id, title: ARTICLE.title, content: ARTICLE.content }, SHOP, { paragraphIndex: 2, productIds: ['p1'], sentences: ['Calm Cleanser cures dryness.'] }, 'Remove the health promise.', think);
    expect(candidate).toEqual({ paragraphIndex: 2, productIds: ['p1'], sentences: ['Calm Cleanser is a gentle first step for dry skin.'] });
    expect(auditPlacement(candidate!, ARTICLE.content, SHOP).verdict).toBe('allow');
  });

  it('an answer that is not the agreed shape is no fix at all', async () => {
    const think = vi.fn(async () => ({ ok: true as const, text: 'I am not sure what to do.' }));
    expect(await fixPlacementOnce({ id: ARTICLE.id, title: ARTICLE.title, content: ARTICLE.content }, SHOP, { paragraphIndex: 2, productIds: ['p1'], sentences: ['x'] }, 'fix', think)).toBeNull();
  });

  it('a shop with nothing to place is no fix at all: no brain is asked', async () => {
    const think = vi.fn(async () => ({ ok: true as const, text: GOOD_FIX }));
    expect(await fixPlacementOnce({ id: ARTICLE.id, title: ARTICLE.title, content: ARTICLE.content }, [], { paragraphIndex: 2, productIds: ['p1'], sentences: ['x'] }, 'fix', think)).toBeNull();
    expect(think).not.toHaveBeenCalled();
  });
});
