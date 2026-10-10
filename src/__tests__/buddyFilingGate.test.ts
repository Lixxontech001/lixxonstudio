import { describe, expect, it, vi } from 'vitest';
import { REFUSAL_LINE, gateModelOrder, gateOrder } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { routeFilingGate, routeMessage } from '../../supabase/functions/_shared/buddyRouter';
import {
  BUDDY_ANSWER_RULES,
  handleBuddyThink,
  type BuddyThinkDeps,
  type GeminiResult,
} from '../../supabase/functions/_shared/buddyThink';

// Phase D slice 2: every filed order passes the closed-list gate, from the router or from a model answer.
// Questions are never filed. Only the five kinds become orders.

const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';
const FAKE_KEY = 'FAKE-GEMINI-KEY-NOT-REAL-0002';

function chatDeps(answerText: string, pendingInstruction: string | null = null) {
  const saved: { role: string; kind: string; content: string }[] = [];
  const askGemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: answerText }));
  const saveOrder = vi.fn(async () => true);
  const deps = {
    keyConfigured: async () => true,
    readKey: async () => FAKE_KEY,
    readSecret: async (name: string) => (name === 'gemini_api_key' ? FAKE_KEY : null),
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
    loadPendingOrder: async () => ({ ok: true as const, instruction: pendingInstruction }),
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

const MESSAGE = { action: 'ask' as const, chat_id: CHAT_ID, message: 'The spring kit plan needs work, and the Strategist is the one for it.' };

describe('the closed-list gate (pure)', () => {
  it('files only the five kinds, and only when the text is not an outside request', () => {
    for (const kind of ['run_today', 'pause_resume_free_door', 'kill_or_start_mind', 'product_line_apply', 'mind_work']) {
      expect(gateOrder(kind, 'Look at the spring kit plan')).toEqual({ ok: true, kind });
    }
    expect(gateOrder('control_everything', 'Look at the plan')).toEqual({ ok: false, line: REFUSAL_LINE });
    expect(gateOrder(null, 'Look at the plan')).toEqual({ ok: false, line: REFUSAL_LINE });
    expect(gateOrder('mind_work', 'Refund order 1042 to Jane')).toEqual({ ok: false, line: REFUSAL_LINE });
  });

  it('a question is never filed, and gets no refusal line', () => {
    expect(gateOrder('mind_work', 'What should the Strategist check?')).toEqual({ ok: false, line: null });
    expect(gateOrder('mind_work', 'Did the analyst run today?')).toEqual({ ok: false, line: null });
  });

  it('a model may file only mind_work; the other kinds come from the owner, never from a model reply', () => {
    expect(gateModelOrder('mind_work', 'Look at the plan')).toEqual({ ok: true, kind: 'mind_work' });
    expect(gateModelOrder('run_today', 'Run the products')).toEqual({ ok: false, line: REFUSAL_LINE });
    expect(gateModelOrder('kill_or_start_mind', 'Stop the CEO')).toEqual({ ok: false, line: REFUSAL_LINE });
  });

  it('the router gate maps each routed order to its kind, and files nothing for other routes', () => {
    expect(routeFilingGate({ kind: 'order', mind: 'ceo', instruction: 'Sort the kit plan', resolvesPending: false })).toEqual({ ok: true, kind: 'mind_work' });
    expect(routeFilingGate({ kind: 'order', mind: 'ceo', instruction: 'Refund order 1042', resolvesPending: false })).toEqual({ ok: false, line: REFUSAL_LINE });
    expect(routeFilingGate({ kind: 'run_day', instruction: 'Run the products' })).toEqual({ ok: true, kind: 'run_today' });
    expect(routeFilingGate({ kind: 'control', action: { kind: 'pause_door', door: 'rss' } as never, instruction: 'Pause the RSS door' })).toEqual({ ok: true, kind: 'pause_resume_free_door' });
    expect(routeFilingGate({ kind: 'control', action: { kind: 'kill_all' }, instruction: 'Stop everything' })).toEqual({ ok: true, kind: 'kill_or_start_mind' });
    expect(routeFilingGate({ kind: 'chat' })).toBeNull();
    expect(routeFilingGate({ kind: 'refused', line: REFUSAL_LINE })).toBeNull();
  });

  it('the router itself still files a plain named-mind order and refuses an outside request', () => {
    expect(routeMessage('Ask the CEO to sort the kit plan', null)).toMatchObject({ kind: 'order', mind: 'ceo' });
    expect(routeMessage('Refund order 1042 to Jane', null)).toEqual({ kind: 'refused', line: REFUSAL_LINE });
  });

  it('the answer rules name the five kinds and say that only those become orders', () => {
    for (const kind of ['run_today', 'pause_resume_free_door', 'kill_or_start_mind', 'product_line_apply', 'mind_work']) {
      expect(BUDDY_ANSWER_RULES).toContain(kind);
    }
    expect(BUDDY_ANSWER_RULES).toMatch(/Only those five kinds become orders/);
  });
});

describe('the closed-list gate on the chat paths', () => {
  it('a model order with an outside request is not saved, and the owner gets REFUSAL_LINE', async () => {
    const { deps, saveOrder, saved } = chatDeps('{"reply":"Done.","order":{"mind":"ceo","kind":"mind_work","instruction":"Refund order 1042 to Jane"}}');
    await handleBuddyThink(MESSAGE, deps);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe(REFUSAL_LINE);
  });

  it('a model question wrapped as an order is answered and not filed', async () => {
    const { deps, saveOrder, saved } = chatDeps('{"reply":"The Strategist would check the spring prices.","order":{"mind":"strategist","kind":"mind_work","instruction":"What should the Strategist check?"}}');
    const result = await handleBuddyThink(MESSAGE, deps);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(result.body).not.toHaveProperty('filed');
    expect(saved.at(-1)?.content).toBe('The Strategist would check the spring prices.');
  });

  it('answerRouted: a pending order that is an outside request is refused, even when the owner only names a mind', async () => {
    // The owner's earlier words were held as waiting. Now only the mind's name arrives, so the router resolves the pending order.
    const { deps, saveOrder, saved } = chatDeps('unused', 'Refund order 1042 to Jane');
    const result = await handleBuddyThink({ ...MESSAGE, message: 'Analyst' }, deps);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ ok: true, route: 'refused' });
    expect(saved.at(-1)?.content).toBe(REFUSAL_LINE);
  });

  it('answerRouted: a pending order with a plain request is still filed for the named mind', async () => {
    const { deps, saveOrder } = chatDeps('unused', 'Look at the spring kit plan');
    await handleBuddyThink({ ...MESSAGE, message: 'Analyst' }, deps);
    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Look at the spring kit plan', 'analyst');
  });
});
