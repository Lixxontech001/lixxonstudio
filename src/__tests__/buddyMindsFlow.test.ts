import { describe, expect, it, vi } from 'vitest';
import {
  BUDDY_SYSTEM_INSTRUCTION,
  handleBuddyThink,
  type BuddyThinkDeps,
  type GeminiResult,
} from '../../supabase/functions/_shared/buddyThink';
import { buildBriefing, type BriefingFacts } from '../../supabase/functions/_shared/buddyBriefing';
import { ASK_WHICH_MIND_LINE, RESTRICTED_LINE, type MindLogLine } from '../../supabase/functions/_shared/buddyRouter';

const FAKE_KEY = 'FAKE-GEMINI-KEY-NOT-REAL-0002';
const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';
const PENDING_FLUSH_LINE = 'Saved your earlier order as waiting. No mind was picked, so it waits for you.';

type Saved = { chatId: string; role: string; kind: string; content: string; payload: Record<string, unknown> | null };

/** Fake dependencies for the chat path. Nothing here touches a database or Google. */
function setup(options: { key?: string | null; pending?: string | null; pendingOk?: boolean; saveOrderOk?: boolean; logRows?: MindLogLine[] | null } = {}) {
  const saved: Saved[] = [];
  const askGemini = vi.fn<(key: string, input: { system: string; turns: unknown[] }) => Promise<GeminiResult>>(async () => ({ ok: true, text: 'Buddy reply.' }));
  const readKey = vi.fn(async () => (options.key === undefined ? FAKE_KEY : options.key));
  const saveOrder = vi.fn(async () => options.saveOrderOk ?? true);
  const readMindLog = vi.fn(async () => (options.logRows === undefined ? [] : options.logRows));
  const loadPendingOrder = vi.fn(async () =>
    options.pendingOk === false ? { ok: false as const } : { ok: true as const, instruction: options.pending ?? null },
  );
  const loadChat = vi.fn(async (id: string) => (id === CHAT_ID ? { id, title: null } : null));
  const d: BuddyThinkDeps = {
    keyConfigured: async () => options.key !== null,
    readKey,
    readSecret: async (name: string) => (name === 'gemini_api_key' ? readKey() : null),
    allowCall: async () => true,
    askGemini,
    recordProbe: async () => {},
    loadChat,
    loadHistory: async () => [],
    saveMessage: async (chatId, role, kind, content, payload) => {
      saved.push({ chatId, role, kind, content, payload: payload ?? null });
      return true;
    },
    touchChat: async () => {},
    now: () => new Date('2026-10-09T12:00:00Z'),
    getSeenAt: async () => ({ ok: true, seenAt: null }),
    markSeen: async () => true,
    readBriefingFacts: async () => ({
      articles: { ok: true, count: 0, titles: [] },
      orders: { ok: true, paidCount: 0, usdTotal: 0 },
      views: { ok: true, count: 0 },
      failures: { ok: true, count: 0, codes: [] },
    }),
    findOrCreateBriefing: async () => ({ id: CHAT_ID, created: true }),
    loadPendingOrder,
    saveOrder,
    readMindLog,
    readStateFacts: async () => ({
      takeover: false,
      killScope: 'none',
      orders: { ok: true, total: 0, items: [] },
      log: { ok: true, rows: [] },
      notable: { ok: true, rows: [] },
      doors: { ok: true, rows: [] },
    }),
    readSiteFacts: async () => ({
      articles: { ok: true, total: 0, items: [] },
      products: { ok: true, total: 0, items: [] },
    }),
  };
  return { deps: d, saved, askGemini, readKey, saveOrder, readMindLog, loadChat };
}

const lastSaved = (saved: Saved[]): Saved | undefined => saved[saved.length - 1];
const ask = (message: string) => ({ action: 'ask', chat_id: CHAT_ID, message });

describe('orders from ordinary language', () => {
  it('files an order for the named mind as waiting, with no key and no Gemini call', async () => {
    const t = setup({ key: null });
    const result = await handleBuddyThink(ask('Tell the Analyst to check the spring guide'), t.deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, route: 'order' });
    expect(t.saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Tell the Analyst to check the spring guide', 'analyst');
    expect(lastSaved(t.saved)?.content).toBe('Saved for the Analyst. It is waiting.');
    expect(t.askGemini).not.toHaveBeenCalled();
    expect(t.readKey).not.toHaveBeenCalled();
  });

  it('says a restricted part waits for the owner, and still files it as waiting', async () => {
    const t = setup();
    await handleBuddyThink(ask('Tell the Executioner to publish the guide'), t.deps);
    expect(t.saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Tell the Executioner to publish the guide', 'executioner');
    expect(lastSaved(t.saved)?.content).toContain(RESTRICTED_LINE);
    expect(t.askGemini).not.toHaveBeenCalled();
  });

  it('asks which mind once when the order names none, and keeps the words for the next message', async () => {
    // Rules only, so no key is saved here. The Gemini judgement has its own tests in buddyThink.test.ts.
    const t = setup({ key: null });
    const result = await handleBuddyThink(ask('Check the new article'), t.deps);
    expect(result.body).toMatchObject({ route: 'ask_which_mind', reply: ASK_WHICH_MIND_LINE });
    expect(t.saveOrder).not.toHaveBeenCalled();
    expect(lastSaved(t.saved)).toMatchObject({ role: 'buddy', content: ASK_WHICH_MIND_LINE, payload: { pending_order: 'Check the new article' } });
    expect(t.askGemini).not.toHaveBeenCalled();
  });

  it('files the waiting order once the owner names a mind', async () => {
    const t = setup({ key: null, pending: 'Check the new article' });
    await handleBuddyThink(ask('the analyst'), t.deps);
    expect(t.saveOrder).toHaveBeenCalledTimes(1);
    expect(t.saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Check the new article', 'analyst');
    expect(lastSaved(t.saved)?.content).toBe('Saved for the Analyst. It is waiting.');
    expect(t.askGemini).not.toHaveBeenCalled();
  });

  it('files a waiting order with no mind when the owner moves on, then answers the new message as chat', async () => {
    const t = setup({ pending: 'Check the new article' });
    const result = await handleBuddyThink(ask('Thanks, that helps'), t.deps);
    expect(t.saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Check the new article', null);
    expect(t.saved.some((row) => row.kind === 'notice' && row.content === PENDING_FLUSH_LINE)).toBe(true);
    expect(result.body).toMatchObject({ ok: true, model: 'gemini-3.8-flash' });
    // One ordinary chat call: Gemini writes the reply, with the answer rules in its instructions.
    expect(t.askGemini).toHaveBeenCalledTimes(1);
    expect(t.askGemini.mock.calls[0][1].system.startsWith(BUDDY_SYSTEM_INSTRUCTION)).toBe(true);
  });

  it('never loses a waiting order when a question about a mind comes next', async () => {
    const t = setup({ key: null, pending: 'Check the new article', logRows: [] });
    const result = await handleBuddyThink(ask('What did the Auditor do?'), t.deps);
    expect(t.saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Check the new article', null);
    expect(result.body).toMatchObject({ route: 'mind_log' });
    expect(lastSaved(t.saved)?.content).toBe('The Auditor has not logged any action yet.');
    expect(t.askGemini).not.toHaveBeenCalled();
  });

  it('refuses honestly when the order cannot be saved, and saves no owner message', async () => {
    const t = setup({ saveOrderOk: false });
    const result = await handleBuddyThink(ask('Tell the CEO to plan the summer list'), t.deps);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, reason: 'not_saved' });
    expect(t.saved).toHaveLength(0);
    expect(t.askGemini).not.toHaveBeenCalled();
  });

  it('does nothing when the waiting order cannot be read', async () => {
    const t = setup({ pendingOk: false });
    const result = await handleBuddyThink(ask('the analyst'), t.deps);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ reason: 'history_unavailable' });
    expect(t.saved).toHaveLength(0);
    expect(t.saveOrder).not.toHaveBeenCalled();
  });
});

describe('ordinary words are orders, not questions', () => {
  it('"Do the new article" is an order that needs a mind, so Buddy asks which one', async () => {
    const t = setup({ key: null });
    const result = await handleBuddyThink(ask('Do the new article'), t.deps);
    expect(result.body).toMatchObject({ route: 'ask_which_mind' });
    expect(t.saveOrder).not.toHaveBeenCalled();
    expect(lastSaved(t.saved)?.payload).toEqual({ pending_order: 'Do the new article' });
  });

  it('the answer to that question files the order once a mind is named', async () => {
    const t = setup({ key: null, pending: 'Do the new article' });
    await handleBuddyThink(ask('the strategist'), t.deps);
    expect(t.saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Do the new article', 'strategist');
  });

  it('a polite order that names a mind is filed, with no key', async () => {
    const t = setup({ key: null });
    await handleBuddyThink(ask('Could you tell the Analyst to check the spring guide'), t.deps);
    expect(t.saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Could you tell the Analyst to check the spring guide', 'analyst');
  });

  it('a real question about a mind is still answered from the log, and not filed', async () => {
    const t = setup({ key: null, logRows: [] });
    await handleBuddyThink(ask('Do you know what the Analyst did?'), t.deps);
    expect(t.saveOrder).not.toHaveBeenCalled();
    expect(lastSaved(t.saved)?.content).toBe('The Analyst has not logged any action yet.');
  });
});

describe('questions about a mind come from the real log', () => {
  const rows: MindLogLine[] = [
    { happened_at: '2026-10-09T08:05:00.000Z', day: '2026-10-09', mind: 'analyst', action: 'Read the site numbers', outcome: 'done', detail: '' },
    { happened_at: '2026-10-09T07:00:00.000Z', day: '2026-10-09', mind: 'analyst', action: 'Cannot think: no Google key', outcome: 'skipped', detail: '' },
  ];

  it('lists the Analyst rows and never calls Gemini', async () => {
    const t = setup({ key: null, logRows: rows });
    const result = await handleBuddyThink(ask('What did the Analyst do?'), t.deps);
    expect(result.body).toMatchObject({ ok: true, route: 'mind_log' });
    expect(t.readMindLog).toHaveBeenCalledWith('analyst');
    const reply = lastSaved(t.saved)?.content ?? '';
    expect(reply).toContain('What the Analyst did, newest first:');
    expect(reply).toContain('2026-10-09 09:05: Read the site numbers. Done.');
    expect(reply).toContain('2026-10-09 08:00: Cannot think: no Google key. Skipped.');
    expect(t.askGemini).not.toHaveBeenCalled();
  });

  it('says plainly when the log cannot be read', async () => {
    const t = setup({ logRows: null });
    await handleBuddyThink(ask('What did the Strategist do?'), t.deps);
    expect(lastSaved(t.saved)?.content).toBe('I could not read the log just now, so I cannot say what the Strategist did. Nothing was changed. Try again shortly.');
    expect(t.askGemini).not.toHaveBeenCalled();
  });

  it('every saved row belongs to the owner chat, so no mind gets a chat of its own', async () => {
    const t = setup({ logRows: rows });
    await handleBuddyThink(ask('What did the Analyst do?'), t.deps);
    await handleBuddyThink(ask('Tell the Analyst to check the spring guide'), t.deps);
    expect(t.saved.length).toBeGreaterThan(0);
    expect(t.saved.every((row) => row.chatId === CHAT_ID)).toBe(true);
    expect(t.loadChat.mock.calls.every(([id]) => id === CHAT_ID)).toBe(true);
  });
});

describe('the five minds section in the briefing', () => {
  function facts(overrides: Partial<BriefingFacts> = {}): BriefingFacts {
    return {
      articles: { ok: true, count: 0, titles: [] },
      orders: { ok: true, paidCount: 0, usdTotal: 0 },
      views: { ok: true, count: 0 },
      failures: { ok: true, count: 0, codes: [] },
      minds: { ok: true, rows: [] },
      waiting: { ok: true, count: 0 },
      ...overrides,
    };
  }
  const now = new Date('2026-10-09T12:00:00Z');
  const since = '2026-10-08T12:00:00Z';
  const section = (result: ReturnType<typeof buildBriefing>, id: string) =>
    result.sections.find((item) => item.id === id)?.lines ?? [];

  it('is titled "The five minds" and shows the newest action of each mind', () => {
    const result = buildBriefing(
      facts({
        minds: {
          ok: true,
          rows: [
            { happened_at: '2026-10-09T10:00:00Z', mind: 'analyst', action: 'Read the site numbers', outcome: 'done', detail: '' },
            { happened_at: '2026-10-09T09:00:00Z', mind: 'ceo', action: 'Put the list in order', outcome: 'skipped', detail: '' },
          ],
        },
      }),
      now,
      since,
      false,
    );
    expect(result.quiet).toBe(false);
    expect(result.sections.map((item) => item.title)).toContain('The five minds');
    expect(section(result, 'minds')).toEqual(['Analyst: Read the site numbers. Done.', 'CEO: Put the list in order. Skipped.']);
  });

  it('a day with only skipped steps is still quiet', () => {
    const result = buildBriefing(
      facts({ minds: { ok: true, rows: [{ happened_at: '2026-10-09T10:00:00Z', mind: 'ceo', action: 'Cannot think: no Google key', outcome: 'skipped', detail: '' }] } }),
      now,
      since,
      false,
    );
    expect(result).toMatchObject({ quiet: true, text: 'Quiet since you left.' });
  });

  it('says so plainly when no mind logged anything', () => {
    const result = buildBriefing(facts(), now, since, false);
    expect(result.quiet).toBe(true);
  });

  it('says it cannot read the minds log, and is not quiet about it', () => {
    const result = buildBriefing(facts({ minds: { ok: false, rows: [] } }), now, since, false);
    expect(result.quiet).toBe(false);
    expect(section(result, 'minds')).toEqual(["I cannot read the minds' log yet."]);
  });

  it('counts waiting orders, and says so plainly when there are none or none can be read', () => {
    const two = buildBriefing(facts({ waiting: { ok: true, count: 2 }, minds: { ok: true, rows: [] } }), now, since, false);
    expect(section(two, 'jobs')).toEqual(['2 orders waiting for you.']);
    const one = buildBriefing(facts({ waiting: { ok: true, count: 1 }, minds: { ok: true, rows: [] } }), now, since, false);
    expect(section(one, 'jobs')).toEqual(['1 order waiting for you.']);
    const none = buildBriefing(facts({ waiting: { ok: true, count: 0 }, minds: { ok: true, rows: [] } }), now, since, false);
    // Zero waiting and nothing else is a quiet day, so the jobs section is not shown.
    expect(none.quiet).toBe(true);
    const noneButActive = buildBriefing(facts({ waiting: { ok: true, count: 0 }, articles: { ok: true, count: 1, titles: ['Spring guide'] } }), now, since, false);
    expect(section(noneButActive, 'jobs')).toEqual(['No orders waiting.']);
    const unreadable = buildBriefing(facts({ waiting: { ok: false, count: 0 }, minds: { ok: true, rows: [] } }), now, since, false);
    expect(section(unreadable, 'jobs')).toEqual(['I cannot read your orders yet.']);
  });
});
