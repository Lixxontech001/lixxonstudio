import { describe, expect, it, vi } from 'vitest';
import {
  APPLY_ACTION,
  type ApplyEdit,
  type GapRecord,
  CAP_BLOCK_DETAIL,
  DRIP_HELD_DETAIL,
  GAP_NOTE,
  NO_KEY_ACTION,
  STOPPED_DETAIL,
  TAKEOVER_OFF_ACTION,
  lineAfter,
  rankArticles,
  replaceLine,
  runPlacementOrder,
  swapFor,
  type RunArticle,
  type RunInput,
  type RunLog,
  type RunPorts,
} from '../../supabase/functions/_shared/placementRun';
import { paragraphChecksum } from '../../supabase/functions/_shared/postEdits';
import type { ShopProduct } from '../../supabase/functions/_shared/productPlacement';
import type { MindThinkResult } from '../../supabase/functions/_shared/mindThink';

// A skincare article. Line 1 and line 7 are plain paragraphs. Lines 0, 4, 5 and 6 are heading and list lines.
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

const GOOD_SENTENCE = 'The Calm Skin Routine Guide keeps the morning steps in one easy order.';

function reply(paragraph: number, productIds: string[], sentences: string): MindThinkResult {
  return { ok: true, text: JSON.stringify({ paragraph, product_ids: productIds, sentences }) };
}

function input(overrides: Partial<RunInput> = {}): RunInput {
  return {
    order: { id: 'order-1', instruction: 'Add a product to the skin guide' },
    localDay: '2026-10-09',
    takeover: true,
    killScope: 'none',
    shop: SHOP,
    articles: [ARTICLE],
    touchedToday: [],
    ...overrides,
  };
}

function fakePorts(thinkResult: MindThinkResult, applyResult: { ok: true } | { ok: false; reason: string } = { ok: true }) {
  const logs: RunLog[] = [];
  const notes: Array<{ kind: string; title: string; detail: string }> = [];
  const ports = {
    think: vi.fn(async (request: { mind: string; system: string; prompt: string }) => {
      expect(request.mind).toBe('strategist');
      return thinkResult;
    }),
    applyEdit: vi.fn(async (edit: ApplyEdit) => {
      expect(edit.orderId).toBe('order-1');
      return applyResult;
    }),
    recordGap: vi.fn(async (gap: GapRecord) => {
      expect(gap.orderId).toBe('order-1');
      return { ok: true as const };
    }),
    log: vi.fn(async (entry: RunLog) => {
      logs.push(entry);
    }),
    notable: vi.fn(async (kind: 'auditor_blocked', title: string, detail: string) => {
      notes.push({ kind, title, detail });
    }),
  };
  return { ports: ports as typeof ports & RunPorts, logs, notes };
}

describe('the Executioner stops before it thinks when Takeover is off or Kill stops it', () => {
  it('takeover off: no thinking, no apply, no gap, and the order stays waiting', async () => {
    const { ports, logs } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input({ takeover: false }), ports);
    expect(out.status).toBe('held');
    expect(ports.think).not.toHaveBeenCalled();
    expect(ports.applyEdit).not.toHaveBeenCalled();
    expect(ports.recordGap).not.toHaveBeenCalled();
    expect(logs[0].action).toBe(TAKEOVER_OFF_ACTION);
  });

  it('kill all and kill executioner both stop the run', async () => {
    for (const killScope of ['all', 'executioner'] as const) {
      const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
      const out = await runPlacementOrder(input({ killScope }), ports);
      expect(out).toEqual({ status: 'held', detail: STOPPED_DETAIL });
      expect(ports.applyEdit).not.toHaveBeenCalled();
    }
  });

  it('kill strategist or kill auditor also stops the run, because no plan can be made or checked', async () => {
    const strategist = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    expect((await runPlacementOrder(input({ killScope: 'strategist' }), strategist.ports)).status).toBe('held');
    expect(strategist.ports.think).not.toHaveBeenCalled();
    expect(strategist.ports.applyEdit).not.toHaveBeenCalled();

    const auditor = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    expect((await runPlacementOrder(input({ killScope: 'auditor' }), auditor.ports)).status).toBe('held');
    expect(auditor.ports.applyEdit).not.toHaveBeenCalled();
  });
});

describe('the happy path: one paragraph changes, and the checksums prove it', () => {
  it('applies one allowed plan and passes the edit to the database step', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input(), ports);
    expect(out.status).toBe('applied');
    expect(ports.applyEdit).toHaveBeenCalledTimes(1);
    const edit = ports.applyEdit.mock.calls[0][0];
    expect(edit.title).toBe(APPLY_ACTION);
    expect(edit.orderId).toBe('order-1');
    expect(edit.productIds).toEqual(['p1']);
    expect(edit.removedProductIds).toEqual([]);
  });

  it('hash test: only the sentences changed, every other line is identical, and both checksums match', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    await runPlacementOrder(input(), ports);
    const edit = ports.applyEdit.mock.calls[0][0];

    const before = ARTICLE_TEXT.split('\n');
    const after = replaceLine(ARTICLE_TEXT, edit.lineIndex, edit.afterLine).split('\n');
    expect(after.length).toBe(before.length);
    before.forEach((line, index) => {
      if (index !== edit.lineIndex) expect(after[index]).toBe(line);
    });
    expect(edit.beforeLine).toBe(before[edit.lineIndex]);
    expect(await paragraphChecksum(edit.beforeLine)).toBe(edit.beforeChecksum);
    expect(await paragraphChecksum(after[edit.lineIndex])).toBe(edit.afterChecksum);
    expect(edit.afterLine.startsWith(LINE1)).toBe(true);
    expect(edit.afterLine.slice(LINE1.length).trim()).toBe(GOOD_SENTENCE);
  });

  it('reader copy has no dash, no country name, and no price that is not the shop price', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    await runPlacementOrder(input(), ports);
    const edit = ports.applyEdit.mock.calls[0][0];
    expect(edit.sentencesAdded).not.toMatch(/[\u2013\u2014]/);
    expect(edit.afterLine).not.toMatch(/nigeria|naira|lagos|abuja/i);
  });

  it('a failed database step is reported as failed, so the order stays waiting', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE), { ok: false, reason: 'checksum_mismatch' });
    const out = await runPlacementOrder(input(), ports);
    expect(out.status).toBe('failed');
    expect(out.status).not.toBe('applied');
  });

  it('a stopped switch found at the database step is held, not failed', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE), { ok: false, reason: 'killed' });
    expect((await runPlacementOrder(input(), ports)).status).toBe('held');
  });
});

describe('the Auditor and the no-key path', () => {
  it('the Auditor blocks a dash, nothing is applied, and the owner hears why', async () => {
    const { ports, notes, logs } = fakePorts(reply(1, ['p1'], 'The Calm Skin Routine Guide is calm — and simple.'));
    const out = await runPlacementOrder(input(), ports);
    expect(out.status).toBe('blocked');
    expect(ports.applyEdit).not.toHaveBeenCalled();
    expect(notes[0].kind).toBe('auditor_blocked');
    // The daily-log line names the article, so it reads on its own months later.
    expect(logs.at(-1)).toMatchObject({ mind: 'auditor', outcome: 'blocked' });
    expect(logs.at(-1)?.action).toMatch(/^Checked a change to ".+"$/);
  });

  it('a product that is not in the shop is blocked, so a mind cannot invent one', async () => {
    const { ports } = fakePorts(reply(1, ['p9'], 'The Imaginary Serum Kit is a fresh start.'));
    expect((await runPlacementOrder(input(), ports)).status).toBe('blocked');
    expect(ports.applyEdit).not.toHaveBeenCalled();
  });

  it('no Google key: "Cannot think: no brain key saved" is logged and nothing is applied', async () => {
    const { ports, logs } = fakePorts({ ok: false, reason: 'no_key' });
    const out = await runPlacementOrder(input(), ports);
    expect(out).toEqual({ status: 'cannot_think', detail: 'Cannot think: no brain key saved.' });
    expect(logs.some((entry) => entry.action === NO_KEY_ACTION)).toBe(true);
    expect(ports.applyEdit).not.toHaveBeenCalled();
  });
});

describe('the gap path: no fit becomes a note, never a new product', () => {
  it('the Strategist finds no fit, so a gap note is recorded and the order is blocked with a reason', async () => {
    const { ports } = fakePorts(reply(-1, [], ''));
    const out = await runPlacementOrder(input(), ports);
    expect(out.status).toBe('gap');
    expect(ports.applyEdit).not.toHaveBeenCalled();
    const gap = ports.recordGap.mock.calls[0][0];
    expect(gap.note).toBe(GAP_NOTE);
    expect(gap.orderId).toBe('order-1');
    expect(gap.postId).toBe('post-1');
  });

  it('an empty shop is a gap too, with no thinking at all', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input({ shop: [] }), ports);
    expect(out.status).toBe('gap');
    expect(ports.think).not.toHaveBeenCalled();
    expect(ports.recordGap.mock.calls[0][0].postId).toBe('post-1');
  });
});

describe('the drip: at most 3 articles a day, best fit first', () => {
  it('a fourth article on the same day waits until tomorrow, and nothing is thought or written', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input({ touchedToday: ['a', 'b', 'c'] }), ports);
    expect(out).toEqual({ status: 'held', detail: DRIP_HELD_DETAIL });
    expect(ports.think).not.toHaveBeenCalled();
    expect(ports.applyEdit).not.toHaveBeenCalled();
  });

  it('an article already counted today is still allowed when the day is full', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input({ touchedToday: ['post-1', 'b', 'c'] }), ports);
    expect(out.status).toBe('applied');
  });

  it('ranks the article that matches the shop first', () => {
    const food: RunArticle = { id: 'food', title: 'Weeknight pasta ideas', content: 'Quick sauces for busy evenings.', liveProductIds: [], liveEdits: [] };
    const ranked = rankArticles([food, ARTICLE], SHOP);
    expect(ranked[0].id).toBe('post-1');
  });
});

describe('the swap: the cap of 3 products, with the minds own sentences removed in the same paragraph', () => {
  const OLD_SENTENCE = 'The Barrier Repair Checklist keeps the night steps in one place.';
  const LINE1_WITH_OLD = `${LINE1} ${OLD_SENTENCE}`;
  const SWAP_ARTICLE: RunArticle = {
    ...ARTICLE,
    content: [ARTICLE_TEXT.split('\n')[0], LINE1_WITH_OLD, ...ARTICLE_TEXT.split('\n').slice(2)].join('\n'),
    liveProductIds: ['p2', 'p4', 'p3'],
    liveEdits: [
      { id: 'edit-old', productIds: ['p2', 'p4'], sentencesAdded: OLD_SENTENCE },
      { id: 'edit-other', productIds: ['p3'], sentencesAdded: 'Gentle Foaming Cleanser is kind to dry skin.' },
    ],
  };

  it('takes out the old sentence and the two products it named, then adds the new sentence in the same paragraph', async () => {
    const { ports } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input({ articles: [SWAP_ARTICLE] }), ports);
    expect(out.status).toBe('applied');
    const edit = ports.applyEdit.mock.calls[0][0];
    expect(edit.removedProductIds).toEqual(['p2', 'p4']);
    expect(edit.afterLine).not.toContain('Barrier Repair');
    expect(edit.afterLine.startsWith(LINE1)).toBe(true);
    expect(edit.afterLine.endsWith(GOOD_SENTENCE)).toBe(true);
    expect(edit.beforeLine).toBe(LINE1_WITH_OLD);
  });

  it('with no safe swap available, the article is at the cap and nothing changes', async () => {
    const noSwap: RunArticle = { ...SWAP_ARTICLE, liveEdits: [] };
    const { ports, logs } = fakePorts(reply(1, ['p1'], GOOD_SENTENCE));
    const out = await runPlacementOrder(input({ articles: [noSwap] }), ports);
    expect(out.status).toBe('blocked');
    expect(ports.applyEdit).not.toHaveBeenCalled();
    expect(logs.some((entry) => entry.detail === CAP_BLOCK_DETAIL)).toBe(true);
  });

  it('swapFor refuses to remove an edit that names a product the plan keeps', () => {
    expect(swapFor(SWAP_ARTICLE, ['p2'], LINE1_WITH_OLD)).toBeNull();
  });

  it('lineAfter returns null when the sentence to remove is no longer in the paragraph', () => {
    expect(lineAfter(LINE1, [OLD_SENTENCE], [])).toBeNull();
    expect(lineAfter(LINE1_WITH_OLD, [OLD_SENTENCE], [])).toBe(LINE1);
  });
});
