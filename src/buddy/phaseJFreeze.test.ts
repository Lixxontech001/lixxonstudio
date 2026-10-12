// @vitest-environment node
// Phase J freeze: Buddy's chat-to-work path, grounded answers and run reporting, with fake brains and storage ports only.
// No live LLM, site write, door, push, migration, deploy or Takeover change is used here.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { saveRunChatReport } from '../../supabase/functions/_shared/runChatReport';
import {
  BUDDY_FACT_ANSWER_RULES,
  BUDDY_ROUTED_ORDER_RULES,
  ORDER_OFF_LINE,
  ORDER_STARTING_LINE,
  ORDER_UNREADABLE_LINE,
  handleBuddyThink,
  type BuddyThinkDeps,
  type GeminiResult,
  type GeminiTurn,
} from '../../supabase/functions/_shared/buddyThink';
import { NEVER_LIST_LINES, neverListLine } from '../../supabase/functions/_shared/buddyRouter';

const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';
const ORDER_ID = '66666666-6666-4666-8666-666666666666';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const FAKE_KEY = 'PHASE-J-TEST-KEY-NOT-REAL';
const ROUTED_REPLY = 'I can prepare a useful next step for the shop.';
const FACT_REPLY = 'The briefing said the guide was ready yesterday, but that does not confirm it is ready now.';
type FakeGeminiInput = { system: string; turns: GeminiTurn[]; json?: boolean };

function fakeDeps(overrides: Partial<BuddyThinkDeps> = {}) {
  const saveOrder = vi.fn(async () => ORDER_ID);
  const brainInputs: FakeGeminiInput[] = [];
  const askGemini = vi.fn(async (_key: string, input: FakeGeminiInput): Promise<GeminiResult> => {
    brainInputs.push(input);
    return {
      ok: true,
      text: input.json ? JSON.stringify({ reply: FACT_REPLY, order: null }) : ROUTED_REPLY,
    };
  });
  const saved: Array<{ chatId: string; role: string; kind: string; content: string }> = [];
  const deps: BuddyThinkDeps = {
    keyConfigured: async () => true,
    readSecret: async (name) => name === 'gemini_api_key' ? FAKE_KEY : null,
    allowCall: async () => true,
    askGemini,
    recordProbe: async () => {},
    loadChat: async (id) => id === CHAT_ID ? { id, title: 'Owner chat', kind: 'chat' } : null,
    loadHistory: async () => [],
    loadBriefingContext: async () => ({ ok: true, text: null }),
    saveMessage: async (chatId, role, kind, content) => {
      saved.push({ chatId, role, kind, content });
      return true;
    },
    touchChat: async () => {},
    now: () => new Date('2026-10-12T09:00:00.000Z'),
    getSeenAt: async () => ({ ok: true, seenAt: null }),
    markSeen: async () => true,
    readBriefingFacts: async () => ({
      articles: { ok: true, count: 0, titles: [] },
      orders: { ok: true, paidCount: 0, usdTotal: 0 },
      views: { ok: true, count: 0 },
      failures: { ok: true, count: 0, codes: [] },
    }),
    findOrCreateBriefing: async () => ({ id: CHAT_ID, created: false }),
    loadPendingOrder: async () => ({ ok: true, instruction: null }),
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
    readSiteFacts: async () => ({
      articles: { ok: true, total: 1, items: [{ title: 'The live guide', slug: 'live-guide', publishedAt: '2026-10-11T09:00:00Z', excerpt: null }] },
      products: { ok: true, total: 1, items: [{ name: 'Linen Bath Sheet', priceUsd: 34 }] },
    }),
    applyControl: async () => true,
    ...overrides,
  };
  return { deps, askGemini, brainInputs, saveOrder, saved };
}

describe('Phase J freeze: the owner chat remains safe and grounded', () => {
  it('an eligible order starts only its own saved work when Takeover is on', async () => {
    const { deps, saveOrder, brainInputs } = fakeDeps({ readTakeover: async () => true });
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'Swap the kit onto the guide' },
      deps,
    );

    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Swap the kit onto the guide', 'executioner');
    expect(result.body).toMatchObject({ ok: true, route: 'order', run_start: true, run_order_id: ORDER_ID });
    expect(result.body.reply).toContain(ORDER_STARTING_LINE);
    expect(brainInputs[0].system).toContain(BUDDY_ROUTED_ORDER_RULES);
    expect(result.body.reply).not.toMatch(/executioner|routed to|no mind was named|next run/i);
  });

  it.each([
    [false, ORDER_OFF_LINE],
    [null, ORDER_UNREADABLE_LINE],
  ] as const)('does not start an eligible order when Takeover is %s', async (takeover, expectedLine) => {
    const { deps, saveOrder } = fakeDeps({ readTakeover: async () => takeover });
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'Swap the kit onto the guide' },
      deps,
    );

    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Swap the kit onto the guide', 'executioner');
    expect(result.body).toMatchObject({ ok: true, route: 'order' });
    expect(result.body.reply).toContain(expectedLine);
    expect(result.body).not.toHaveProperty('run_start');
    expect(result.body).not.toHaveProperty('run_order_id');
  });

  it('answers a briefing follow-up from the saved snapshot and current facts, with no order', async () => {
    const message = 'Why did the briefing say the new guide was ready?';
    const briefing = 'The live guide was ready yesterday. This is not a current status.';
    const reply = FACT_REPLY;
    const history: GeminiTurn[] = [{ role: 'user', text: 'Good morning' }];
    const loadBriefingContext = vi.fn(async () => ({ ok: true, text: briefing }));
    const { deps, brainInputs, saveOrder, saved } = fakeDeps({
      loadBriefingContext,
      loadChat: async (id) => id === CHAT_ID ? { id, title: 'Daily briefing', kind: 'briefing' } : null,
      loadHistory: async () => history,
      readStateFacts: async () => ({
        takeover: true,
        killScope: 'none',
        orders: { ok: true, total: 0, items: [] },
        log: { ok: true, rows: [] },
        notable: { ok: true, rows: [] },
        doors: { ok: true, rows: [] },
      }),
    });

    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message }, deps);

    expect(result.body).toMatchObject({ ok: true, route: 'briefing_followup', reply });
    expect(loadBriefingContext).toHaveBeenCalledWith(CHAT_ID);
    expect(brainInputs[0].system).toContain(BUDDY_FACT_ANSWER_RULES);
    expect(brainInputs[0].system).toContain(JSON.stringify(briefing));
    expect(brainInputs[0].system).toContain('Takeover: on.');
    expect(brainInputs[0].turns).toEqual([...history, { role: 'user', text: message }]);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved[saved.length - 1]).toMatchObject({ chatId: CHAT_ID, role: 'buddy', kind: 'reply', content: reply });
  });

  it('writes a non-empty run outcome only to the supplied originating chat and handles a failed save', async () => {
    const saveBuddyReply = vi.fn(async () => true);
    const touchChat = vi.fn(async () => {});
    const ports = { saveBuddyReply, touchChat };
    const detail = 'Four packs were saved. The report is for this run.';

    await expect(saveRunChatReport({ ownerId: OWNER_ID, chatId: CHAT_ID, detail }, ports)).resolves.toBe(true);
    expect(saveBuddyReply).toHaveBeenCalledWith({ ownerId: OWNER_ID, chatId: CHAT_ID, content: detail });
    expect(touchChat).toHaveBeenCalledWith({ ownerId: OWNER_ID, chatId: CHAT_ID });

    saveBuddyReply.mockResolvedValueOnce(false);
    await expect(saveRunChatReport({ ownerId: OWNER_ID, chatId: CHAT_ID, detail }, ports)).resolves.toBe(false);
  });

  it('keeps the hard refusals ahead of brain calls or order filing', async () => {
    const requests = [
      ['Reply to the customer who asked about the bag', NEVER_LIST_LINES.reader],
      ['Spend 50 dollars on ads for the summer post', NEVER_LIST_LINES.spend],
      ['Create a new shop product', NEVER_LIST_LINES.product],
      ['Rewrite the whole article', NEVER_LIST_LINES.rewrite],
    ] as const;
    for (const [message, line] of requests) {
      const { deps, askGemini, saveOrder } = fakeDeps();
      const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message }, deps);
      expect(result.body).toMatchObject({ ok: true, route: 'never_list', reply: line });
      expect(askGemini).not.toHaveBeenCalled();
      expect(saveOrder).not.toHaveBeenCalled();
      expect(neverListLine(message)).toBe(line);
    }
  });

  it('the saved-briefing database read is owner-session, scoped to this chat, and read-only', () => {
    const edge = readFileSync('supabase/functions/buddy-think/index.ts', 'utf8');
    const start = edge.indexOf('loadBriefingContext: async');
    const end = edge.indexOf('saveMessage:', start);
    const source = edge.slice(start, end);
    expect(source).toContain('userClient');
    expect(source).toContain('.eq("chat_id", chatId)');
    expect(source).toContain('.eq("kind", "briefing")');
    expect(source).toContain('.order("created_at", { ascending: false })');
    expect(source).toContain('.limit(1)');
    expect(source).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });
});
