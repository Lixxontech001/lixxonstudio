import { describe, expect, it, vi } from 'vitest';
import { REFUSAL_LINE } from '../../supabase/functions/_shared/buddyOrderPolicy';
import {
  handleBuddyThink,
  parseBuddyAnswer,
  type BuddyThinkDeps,
  type GeminiResult,
} from '../../supabase/functions/_shared/buddyThink';

// Slice 2: a model-filed order is checked against the closed list. Only a named-mind "mind_work" order is filed.

const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';
const FAKE_KEY = 'FAKE-GEMINI-KEY-NOT-REAL-0001';

function chatDeps(answerText: string) {
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

const QUESTION = { action: 'ask' as const, chat_id: CHAT_ID, message: 'The spring kit plan needs work, and the Strategist is the one for it.' };

describe('Buddy model orders: the closed list', () => {
  it('a named-mind order with kind mind_work is filed as waiting', async () => {
    const { deps, saveOrder, saved } = chatDeps('{"reply":"Got it.","order":{"mind":"strategist","kind":"mind_work","instruction":"Look at the spring kit plan"}}');
    const result = await handleBuddyThink(QUESTION, deps);
    expect(result.body).toMatchObject({ ok: true, filed: 'strategist' });
    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Look at the spring kit plan', 'strategist');
    expect(saved.at(-1)?.content).not.toBe(REFUSAL_LINE);
  });

  it('an order with no kind is not filed, and the owner is told plainly', async () => {
    const { deps, saveOrder, saved } = chatDeps('{"reply":"Okay.","order":{"mind":"strategist","instruction":"Look at the spring kit plan"}}');
    const result = await handleBuddyThink(QUESTION, deps);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ ok: true, route: 'chat' });
    expect(result.body).not.toHaveProperty('filed');
    expect(saved.at(-1)?.content).toBe(REFUSAL_LINE);
  });

  it('an order with a kind only the owner can start is not filed, even with no mind', async () => {
    const { deps, saveOrder, saved } = chatDeps('{"reply":"Okay.","order":{"mind":null,"kind":"pause_resume_free_door","instruction":"Pause the RSS door"}}');
    await handleBuddyThink(QUESTION, deps);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe(REFUSAL_LINE);
  });

  it('a kind that is not on the list is not filed', async () => {
    const { deps, saveOrder, saved } = chatDeps('{"reply":"Okay.","order":{"mind":"ceo","kind":"buy_ads","instruction":"Buy ads for the kit"}}');
    await handleBuddyThink(QUESTION, deps);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe(REFUSAL_LINE);
  });

  it('a refused request is still refused first, whatever kind the model gives', async () => {
    const { deps, saveOrder, saved } = chatDeps('{"reply":"Done.","order":{"mind":"ceo","kind":"mind_work","instruction":"Refund order 1042 to Jane"}}');
    await handleBuddyThink({ ...QUESTION, message: 'The Jane order needs sorting out, and the refund is the hard part.' }, deps);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe(REFUSAL_LINE);
  });

  it('the parser keeps only a kind from the closed list and gives null for anything else', () => {
    expect(parseBuddyAnswer('{"reply":"A","order":{"mind":"ceo","kind":"mind_work","instruction":"Check it"}}')?.order).toEqual({ mind: 'ceo', kind: 'mind_work', instruction: 'Check it' });
    expect(parseBuddyAnswer('{"reply":"A","order":{"mind":"ceo","kind":"run_today","instruction":"Check it"}}')?.order?.kind).toBe('run_today');
    expect(parseBuddyAnswer('{"reply":"A","order":{"mind":"ceo","kind":"delete_everything","instruction":"Check it"}}')?.order?.kind).toBeNull();
    expect(parseBuddyAnswer('{"reply":"A","order":{"mind":"ceo","kind":42,"instruction":"Check it"}}')?.order?.kind).toBeNull();
  });
});
