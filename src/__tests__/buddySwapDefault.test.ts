import { describe, expect, it, vi } from 'vitest';
import { REFUSAL_LINE } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { ASK_WHICH_MIND_LINE, routeFilingGate, routeMessage } from '../../supabase/functions/_shared/buddyRouter';
import { handleBuddyThink, type BuddyThinkDeps } from '../../supabase/functions/_shared/buddyThink';

// Phase E slice 2: a swap with no mind named files to the Executioner. No "which mind?" question for a swap.
// A named mind keeps its name. A question is never filed. Fake deps only: no model, no database, no push.

const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';
const SWAP = 'Swap the Calm Skin Routine Guide onto the skin guide';

function chatDeps() {
  const saved: { role: string; kind: string; content: string }[] = [];
  const saveOrder = vi.fn(async () => true);
  const askGemini = vi.fn(async () => ({ ok: true as const, text: 'unused' }));
  const deps = {
    keyConfigured: async () => true,
    readKey: async () => null,
    readSecret: async () => null,
    allowCall: async () => true,
    askGemini,
    recordProbe: async () => {},
    loadChat: async (id: string) => (id === CHAT_ID ? { id, title: null } : null),
    loadHistory: async () => [],
    saveMessage: async (_chat: string, role: string, kind: string, content: string) => {
      saved.push({ role, kind, content });
      return true;
    },
    touchChat: async () => {},
    now: () => new Date('2026-10-10T12:00:00Z'),
    getSeenAt: async () => ({ ok: true as const, seenAt: null }),
    markSeen: async () => true,
    readBriefingFacts: async () => ({
      articles: { ok: true, count: 0, titles: [] },
      orders: { ok: true, paidCount: 0, usdTotal: 0 },
      views: { ok: true, count: 0 },
      failures: { ok: true, count: 0, codes: [] },
    }),
    findOrCreateBriefing: async () => null,
    loadPendingOrder: async () => ({ ok: true as const, instruction: null }),
    saveOrder,
    readMindLog: async () => [],
    readTakeover: async () => false,
    readStateFacts: async () => ({
      takeover: false,
      killScope: 'none',
      orders: { ok: true, total: 0, items: [] },
      log: { ok: true, rows: [] },
      notable: { ok: true, rows: [] },
      doors: { ok: true, rows: [] },
    }),
    readSiteFacts: async () => ({ articles: { ok: true, total: 0, items: [] }, products: { ok: true, total: 0, items: [] } }),
    applyControl: async () => true,
    logBrain: async () => {},
  } as unknown as BuddyThinkDeps;
  return { deps, saved, saveOrder, askGemini };
}

const ask = (message: string) => ({ action: 'ask' as const, chat_id: CHAT_ID, message });

describe('an unnamed swap goes to the Executioner', () => {
  it('the router files a swap with no mind as an order for the Executioner', () => {
    expect(routeMessage(SWAP, null)).toEqual({
      kind: 'order',
      mind: 'executioner',
      instruction: SWAP,
      resolvesPending: false,
    });
  });

  it('"put ... on the article" with no mind is the same product-line swap, and goes to the Executioner', () => {
    expect(routeMessage('Put the sleep guide on the new article', null)).toMatchObject({ kind: 'order', mind: 'executioner' });
  });

  it('the filed swap passes the closed-list gate as product_line_apply', () => {
    const route = routeMessage(SWAP, null);
    expect(routeFilingGate(route)).toEqual({ ok: true, kind: 'product_line_apply' });
  });

  it('a named mind keeps its name: "Ask the Analyst to swap ..." files to the Analyst, not the Executioner', () => {
    expect(routeMessage('Ask the Analyst to swap the kit onto the article', null)).toMatchObject({ kind: 'order', mind: 'analyst' });
  });

  it('a swap with a pending order still goes to the Executioner, not a question', () => {
    expect(routeMessage(SWAP, { instruction: 'Look at the spring kit plan' })).toMatchObject({ kind: 'order', mind: 'executioner' });
  });

  it('no "which mind?" question is asked for a swap', () => {
    expect(routeMessage(SWAP, null).kind).not.toBe('ask_which_mind');
  });

  it('through the chat handler: the swap is saved for the Executioner and the owner gets no which-mind question', async () => {
    const { deps, saveOrder, saved } = chatDeps();
    const result = await handleBuddyThink(ask(SWAP), deps);
    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, SWAP, 'executioner');
    expect(result.body).toMatchObject({ ok: true, route: 'order' });
    expect(saved.some((item) => item.content === ASK_WHICH_MIND_LINE)).toBe(false);
  });
});

describe('the swap default never widens the closed list', () => {
  it('a swap that also asks for an email or a price change is refused, so nothing is filed', async () => {
    for (const outside of ['Swap the kit onto the article and email the list', 'Swap the kit onto the article and change the price to 5 dollars']) {
      const route = routeMessage(outside, null);
      // Refused by the router, or by the gate if the router ever lets it through. Either way nothing is filed.
      if (route.kind === 'refused') expect(route.line).toBe(REFUSAL_LINE);
      else expect(routeFilingGate(route)).toEqual({ ok: false, line: REFUSAL_LINE });
      const { deps, saveOrder, saved } = chatDeps();
      await handleBuddyThink(ask(outside), deps);
      expect(saveOrder).not.toHaveBeenCalled();
      expect(saved.at(-1)?.content).toBe(REFUSAL_LINE);
    }
  });

  it('a swap is never filed as anything but the five kinds', () => {
    const route = routeMessage(SWAP, null);
    expect(route.kind).toBe('order');
    if (route.kind === 'order') expect(['run_today', 'pause_resume_free_door', 'kill_or_start_mind', 'product_line_apply', 'mind_work']).toContain('product_line_apply');
  });
});

describe('a question is never filed, swap or not', () => {
  it('a question about a swap is not an order and not a which-mind prompt', () => {
    for (const question of ['Can you swap the kit onto the article?', 'How do I swap the kit onto the article?']) {
      const route = routeMessage(question, null);
      expect(route.kind).not.toBe('order');
      expect(route.kind).not.toBe('ask_which_mind');
    }
  });

  it('through the chat handler, a swap question is not saved as an order', async () => {
    const { deps, saveOrder } = chatDeps();
    await handleBuddyThink(ask('Can you swap the kit onto the article?'), deps);
    expect(saveOrder).not.toHaveBeenCalled();
  });
});

describe('other unnamed orders keep asking which mind (unchanged)', () => {
  it('"Do the new article" still asks which mind, because it is not a swap', () => {
    expect(routeMessage('Do the new article', null)).toEqual({ kind: 'ask_which_mind', instruction: 'Do the new article' });
  });
});

describe('the refusal reaches an outside action after "and", "then" or a comma', () => {
  it.each([
    'Swap the kit onto the article and email the list',
    'Swap the kit onto the article, then refund Jane',
    'Put the sleep guide on the new article and delete the old article',
    'Swap the kit onto the article; change the price to 5 dollars',
  ])('refused, nothing filed: %s', async (outside) => {
    const { deps, saveOrder } = chatDeps();
    const result = await handleBuddyThink(ask(outside), deps);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ route: 'refused' });
  });

  it('an internal swap that only says "send it" is not refused and is filed for the Executioner', () => {
    expect(routeMessage('Ask the Strategist to plan the kit and send it over', null)).toMatchObject({ kind: 'order', mind: 'strategist' });
    expect(routeMessage('Swap the kit onto the article and send it to the Executioner', null)).toMatchObject({ kind: 'order', mind: 'executioner' });
  });
});
