import { describe, expect, it, vi } from 'vitest';
import { laneFor } from '../../supabase/functions/_shared/buddyOrders';
import { feedbackLine, orderOutcomeLine } from '../../supabase/functions/_shared/buddyFeedback';
import { filingKindFor, gateModelOrder, REFUSAL_LINE } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { routeFilingGate, routeMessage } from '../../supabase/functions/_shared/buddyRouter';
import { planDayRun, TAKEOVER_OFF_DETAIL, type DayRunInput } from '../../supabase/functions/_shared/runDay';
import {
  CAP_BLOCK_DETAIL,
  runPlacementOrder,
  type ApplyEdit,
  type GapRecord,
  type RunArticle,
  type RunInput,
  type RunLog,
  type RunPorts,
} from '../../supabase/functions/_shared/placementRun';
import type { MindThinkResult } from '../../supabase/functions/_shared/mindThink';
import type { ShopProduct } from '../../supabase/functions/_shared/productPlacement';

// Phase D slice 5: the owner's swap goes through the existing product-line path (the placement run), not a second path.
// Takeover on: the run applies the swap and the owner reads "Done." with the names. Takeover off: a waiting line.
// The cap of three and digital-first still hold. Every model reply and every database step here is a fake.

const LINE1 = 'Dry skin often feels tight after washing, and it can look dull by midday.';
const ARTICLE_TEXT = [
  '# Easy Skincare Routine for Dry Skin',
  LINE1,
  'A simple routine helps most people who want calm, comfortable skin.',
  '',
  '## What to look for',
  '- A gentle cleanser',
  '- A plain moisturiser',
  'Start with one change at a time, and give it a few weeks.',
].join('\n');
const SHOP: ShopProduct[] = [
  { id: 'p1', name: 'Calm Skin Routine Guide', isDigital: true, priceUsd: 12 },
  { id: 'p2', name: 'Barrier Repair Checklist', isDigital: true, priceUsd: 7.5 },
  { id: 'p3', name: 'Gentle Foaming Cleanser', isDigital: false, priceUsd: 18.99 },
  { id: 'p4', name: 'Night Cream Sample Pack', isDigital: false, priceUsd: 9 },
];
const ARTICLE: RunArticle = {
  id: 'post-1',
  title: 'Easy Skincare Routine for Dry Skin',
  content: ARTICLE_TEXT,
  liveProductIds: [],
  liveEdits: [],
};
const FULL_ARTICLE: RunArticle = { ...ARTICLE, liveProductIds: ['p2', 'p3', 'p4'] };
const GOOD_SENTENCE = 'The Calm Skin Routine Guide keeps the morning steps in one easy order.';
const SWAP = 'Ask the Executioner to swap the Calm Skin Routine Guide onto the skin guide';

function reply(paragraph: number, productIds: string[], sentences: string): MindThinkResult {
  return { ok: true, text: JSON.stringify({ paragraph, product_ids: productIds, sentences }) };
}

function input(overrides: Partial<RunInput> = {}): RunInput {
  return {
    order: { id: 'order-1', instruction: SWAP },
    localDay: '2026-10-10',
    takeover: true,
    killScope: 'none',
    shop: SHOP,
    articles: [ARTICLE],
    touchedToday: [],
    ...overrides,
  };
}

function fakePorts(thinkResult: MindThinkResult) {
  const logs: RunLog[] = [];
  const ports = {
    think: vi.fn(async () => thinkResult),
    applyEdit: vi.fn(async (_edit: ApplyEdit) => ({ ok: true as const })), // eslint-disable-line @typescript-eslint/no-unused-vars
    recordGap: vi.fn(async (_gap: GapRecord) => ({ ok: true as const })), // eslint-disable-line @typescript-eslint/no-unused-vars
    log: vi.fn(async (entry: RunLog) => {
      logs.push(entry);
    }),
    notable: vi.fn(async () => {}),
  };
  return { ports: ports as typeof ports & RunPorts, logs };
}

const WAITING = (instruction: string) => ({
  id: 'order-1',
  instruction,
  mind: 'executioner' as const,
  created_at: '2026-10-10T09:00:00Z',
  lane: laneFor(instruction),
});

describe('the owner\u2019s swap is filed as product_line_apply and laned as a product line', () => {
  it('a named-mind swap is an order, and it is filed as product_line_apply', () => {
    const route = routeMessage(SWAP, null);
    expect(route).toMatchObject({ kind: 'order', mind: 'executioner' });
    expect(routeFilingGate(route)).toEqual({ ok: true, kind: 'product_line_apply' });
    expect(filingKindFor(SWAP)).toBe('product_line_apply');
  });

  it('the lane for a swap is the product line, so the placement run can take it', () => {
    expect(laneFor(SWAP)).toEqual({ lane: 'product_line' });
  });

  it('a plain request for a mind is still mind_work, and a swap is never filed as anything else', () => {
    expect(filingKindFor('Ask the CEO to plan the spring article')).toBe('mind_work');
    expect(filingKindFor('Ask the Strategist to look at the kit plan')).toBe('mind_work');
  });

  it('a swap that asks for a channel, a price or a refund is still refused or held, not run', () => {
    expect(routeFilingGate({ kind: 'order', mind: 'executioner', instruction: 'Refund the swapped kit', resolvesPending: false })).toEqual({ ok: false, line: REFUSAL_LINE });
    expect(laneFor('Swap the kit onto the article and post it to instagram')).toEqual({ lane: 'held', reason: expect.any(String) });
  });
});

describe('Takeover on: the run applies the swap, with Done and the names', () => {
  it('the owner\u2019s swap runs as the oldest runnable order once Takeover is on', () => {
    const plan = planDayRun({ localDay: '2026-10-10', trigger: 'owner', takeover: true, killScope: 'none', waiting: [WAITING(SWAP)], orderId: null } as DayRunInput);
    expect(plan).toEqual({ kind: 'run_order', orderId: 'order-1', detail: 'Running your oldest waiting order.' });
  });

  it('the placement run applies the swap: the edit names the product and the article', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input(), ports);
    expect(out.status).toBe('applied');
    expect(ports.applyEdit).toHaveBeenCalledTimes(1);
    const edit = ports.applyEdit.mock.calls[0][0];
    expect(edit.productIds).toEqual(['p1']);
    expect(out.status === 'applied' && out.detail).toContain('Calm Skin Routine Guide');
    expect(out.status === 'applied' && out.detail).toContain('Easy Skincare Routine for Dry Skin');
  });

  it('the owner reads Done. with the product and article names, and nothing says it is only waiting', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input(), ports);
    const line = orderOutcomeLine(out.status, out.status === 'applied' ? out.detail : '');
    expect(line.startsWith('Done. ')).toBe(true);
    expect(line).toContain('Calm Skin Routine Guide');
    expect(line).toContain('Easy Skincare Routine for Dry Skin');
    expect(line).not.toMatch(/waiting/i);
  });

  it('the Done line is only for an applied change; a held or blocked order keeps its own words', () => {
    expect(orderOutcomeLine('held', 'Takeover is off. Nothing runs.')).toBe('Takeover is off. Nothing runs.');
    expect(orderOutcomeLine('blocked', 'Blocked. Nothing changed.')).toBe('Blocked. Nothing changed.');
  });
});

describe('Takeover off: a waiting line, and nothing changes', () => {
  it('the day run plans nothing and says Takeover is off', () => {
    const plan = planDayRun({ localDay: '2026-10-10', trigger: 'owner', takeover: false, killScope: 'none', waiting: [WAITING(SWAP)], orderId: 'order-1' } as DayRunInput);
    expect(plan).toEqual({ kind: 'none', detail: TAKEOVER_OFF_DETAIL });
  });

  it('the placement run with Takeover off thinks nothing, applies nothing, and the order stays waiting', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input({ takeover: false }), ports);
    expect(out.status).toBe('held');
    expect(ports.applyEdit).not.toHaveBeenCalled();
    expect(ports.think).not.toHaveBeenCalled();
  });

  it('the chat gives the waiting line with Takeover off', () => {
    expect(feedbackLine({ state: 'waiting', takeover: false, mind: 'Executioner' })).toBe('Saved for the Executioner. It is waiting. Takeover is off, so nothing has changed.');
  });
});

describe('the cap of three and digital-first still hold for a swap', () => {
  it('an article already at three products takes no fourth swap when there is no safe swap', async () => {
    const { ports, logs } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input({ articles: [FULL_ARTICLE] }), ports);
    expect(out.status).toBe('blocked');
    expect(ports.applyEdit).not.toHaveBeenCalled();
    expect(logs.some((entry) => entry.detail === CAP_BLOCK_DETAIL)).toBe(true);
  });
});

describe('the spec examples for filing (Phase D slice 2 and 5, by name)', () => {
  it('"put the sleep guide on the new article" is filed as product_line_apply', () => {
    expect(filingKindFor('put the sleep guide on the new article')).toBe('product_line_apply');
  });

  it('"refund the last customer" is refused by the closed-list gate for a model order, with the one refusal line', () => {
    expect(gateModelOrder('mind_work', 'refund the last customer')).toEqual({ ok: false, line: REFUSAL_LINE });
  });
});
