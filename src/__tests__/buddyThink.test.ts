import { describe, expect, it, vi } from 'vitest';
import {
  BUDDY_GEMINI_MODEL,
  BUDDY_SYSTEM_INSTRUCTION,
  BUDDY_TEST_PROMPT,
  callGemini,
  cleanMessage,
  extractReplyText,
  handleBuddyThink,
  HISTORY_TURNS,
  NO_KEY_MESSAGE,
  titleFromMessage,
  type BuddyThinkDeps,
  type GeminiResult,
  type GeminiTurn,
} from '../../supabase/functions/_shared/buddyThink';

const FAKE_KEY = 'FAKE-GEMINI-KEY-NOT-REAL-0001';
const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';

type Saved = { chatId: string; role: string; kind: string; content: string };

function deps(overrides: Partial<BuddyThinkDeps> = {}) {
  const saved: Saved[] = [];
  const recordProbe = vi.fn(async () => {});
  const touchChat = vi.fn(async () => {});
  const askGemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: 'Yes, Buddy can think.' }));
  const base: BuddyThinkDeps = {
    keyConfigured: async () => true,
    readKey: async () => FAKE_KEY,
    allowCall: async () => true,
    askGemini,
    recordProbe,
    loadChat: async (id) => (id === CHAT_ID ? { id, title: null } : null),
    loadHistory: async () => [],
    saveMessage: async (chatId, role, kind, content) => {
      saved.push({ chatId, role, kind, content });
      return true;
    },
    touchChat,
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
    readSiteFacts: async () => ({
      articles: { ok: true, total: 0, items: [] },
      products: { ok: true, total: 0, items: [] },
    }),
    ...overrides,
  };
  return { deps: base, askGemini, recordProbe, saved, touchChat };
}

describe('Buddy think: status and proof call', () => {
  it('reports configured=false for status without reading the key', async () => {
    const readKey = vi.fn(async () => FAKE_KEY);
    const { deps: d, askGemini } = deps({ keyConfigured: async () => false, readKey });
    const result = await handleBuddyThink({ action: 'status' }, d);
    expect(result).toEqual({ status: 200, body: { ok: true, action: 'status', configured: false } });
    expect(readKey).not.toHaveBeenCalled();
    expect(askGemini).not.toHaveBeenCalled();
  });

  it('answers probe with one plain sentence and can_think false when no key is saved', async () => {
    const { deps: d, askGemini, recordProbe } = deps({ readKey: async () => null });
    const result = await handleBuddyThink({ action: 'probe' }, d);
    expect(result.body).toMatchObject({ ok: false, reason: 'no_key', message: NO_KEY_MESSAGE, can_think: false });
    expect(askGemini).not.toHaveBeenCalled();
    expect(recordProbe).not.toHaveBeenCalled();
  });

  it('sends the fixed test prompt with the Buddy instruction and returns the model reply', async () => {
    const { deps: d, askGemini, recordProbe } = deps();
    const result = await handleBuddyThink({ action: 'probe' }, d);
    expect(askGemini).toHaveBeenCalledWith(FAKE_KEY, {
      system: BUDDY_SYSTEM_INSTRUCTION,
      turns: [{ role: 'user', text: BUDDY_TEST_PROMPT }],
    });
    expect(result.body).toEqual({ ok: true, action: 'probe', model: BUDDY_GEMINI_MODEL, reply: 'Yes, Buddy can think.', can_think: true });
    expect(recordProbe).toHaveBeenCalledWith('ok');
  });
});

describe('Buddy think: chat replies', () => {
  it('saves the question, answers with the chat so far, and saves the reply', async () => {
    const history: GeminiTurn[] = [
      { role: 'user', text: 'Hello Buddy' },
      { role: 'model', text: 'Hello. What do you need?' },
    ];
    const { deps: d, askGemini, saved, touchChat } = deps({ loadHistory: async () => history });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: '  What is on the shop?\u0007 ' }, d);
    expect(askGemini).toHaveBeenCalledWith(FAKE_KEY, {
      system: expect.stringContaining(BUDDY_SYSTEM_INSTRUCTION),
      turns: [...history, { role: 'user', text: 'What is on the shop?' }],
    });
    expect(saved).toEqual([
      { chatId: CHAT_ID, role: 'owner', kind: 'reply', content: 'What is on the shop?' },
      { chatId: CHAT_ID, role: 'buddy', kind: 'reply', content: 'Yes, Buddy can think.' },
    ]);
    expect(touchChat).toHaveBeenCalledWith(CHAT_ID, 'What is on the shop?');
    expect(result.body).toMatchObject({ ok: true, action: 'ask', reply: 'Yes, Buddy can think.', saved: true });
    expect(result.body).not.toHaveProperty('can_think');
  });

  it('keeps only the most recent turns when a chat is long', async () => {
    const long: GeminiTurn[] = Array.from({ length: HISTORY_TURNS + 5 }, (_, i) => ({ role: 'user' as const, text: `turn ${i}` }));
    const { deps: d, askGemini } = deps({ loadHistory: async () => long });
    await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'latest' }, d);
    const turns = (askGemini.mock.calls[0] as unknown as [string, { turns: GeminiTurn[] }])[1].turns;
    expect(turns).toHaveLength(HISTORY_TURNS + 1);
    expect(turns[turns.length - 1]).toEqual({ role: 'user', text: 'latest' });
  });

  it('saves the question and an honest notice in the chat when no key is saved, with no model call', async () => {
    const { deps: d, askGemini, saved } = deps({ readKey: async () => null });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Hello' }, d);
    expect(result.body).toMatchObject({ ok: false, reason: 'no_key', message: NO_KEY_MESSAGE });
    expect(askGemini).not.toHaveBeenCalled();
    expect(saved).toEqual([
      { chatId: CHAT_ID, role: 'owner', kind: 'reply', content: 'Hello' },
      { chatId: CHAT_ID, role: 'buddy', kind: 'notice', content: NO_KEY_MESSAGE },
    ]);
  });

  it('saves a notice, not a reply, when Google fails', async () => {
    const { deps: d, saved } = deps({ askGemini: async () => ({ ok: false, outcome: 'rejected' }) });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Hi' }, d);
    expect(result.body).toMatchObject({ ok: false, reason: 'rejected' });
    expect(result.body).not.toHaveProperty('reply');
    expect(saved.map((row) => [row.role, row.kind])).toEqual([['owner', 'reply'], ['buddy', 'notice']]);
  });

  it('refuses a chat that does not exist or is not the owner’s, and saves nothing', async () => {
    const other = '11111111-2222-4333-8444-555555555555';
    const { deps: d, askGemini, saved } = deps();
    const result = await handleBuddyThink({ action: 'ask', chat_id: other, message: 'Hi' }, d);
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ ok: false, reason: 'chat_not_found' });
    expect(askGemini).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('does not answer when the earlier chat cannot be read, and sends nothing', async () => {
    const { deps: d, askGemini, saved } = deps({ loadHistory: async () => null });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Hi' }, d);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, reason: 'history_unavailable' });
    expect(askGemini).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('does not answer when the question cannot be saved', async () => {
    const { deps: d, askGemini } = deps({ saveMessage: async () => false });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Hi' }, d);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, reason: 'not_saved' });
    expect(askGemini).not.toHaveBeenCalled();
  });

  it('refuses to answer when the rate limit cannot be checked or is used up, and saves nothing', async () => {
    const { deps: d, askGemini, saved } = deps({ allowCall: async () => null });
    const broken = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Hi' }, d);
    expect(broken.body).toMatchObject({ ok: false, reason: 'unavailable' });
    const { deps: over, askGemini: askOver, saved: savedOver } = deps({ allowCall: async () => false });
    const limited = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Hi' }, over);
    expect(limited.body).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(askGemini).not.toHaveBeenCalled();
    expect(askOver).not.toHaveBeenCalled();
    expect(saved.length + savedOver.length).toBe(0);
  });

  it('never echoes the key back in any answer', async () => {
    const { deps: d } = deps();
    const answers = [
      await handleBuddyThink({ action: 'status' }, d),
      await handleBuddyThink({ action: 'probe' }, d),
      await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'hello' }, d),
    ];
    for (const answer of answers) expect(JSON.stringify(answer)).not.toContain(FAKE_KEY);
  });
});

describe('Buddy think: request rules', () => {
  it('refuses unknown fields, unknown actions, empty or over-long messages, and bad chat ids', async () => {
    const { deps: d } = deps();
    expect((await handleBuddyThink({ action: 'status', extra: 1 }, d)).status).toBe(400);
    expect((await handleBuddyThink({ action: 'publish' }, d)).status).toBe(400);
    expect((await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: '   ' }, d)).status).toBe(400);
    expect((await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'x'.repeat(1001) }, d)).status).toBe(400);
    expect((await handleBuddyThink({ action: 'ask', message: 'hi' }, d)).status).toBe(400);
    expect((await handleBuddyThink({ action: 'ask', chat_id: 'not-a-uuid', message: 'hi' }, d)).status).toBe(400);
    expect((await handleBuddyThink(null, d)).status).toBe(400);
  });

  it('cleanMessage strips control characters and enforces the length cap', () => {
    expect(cleanMessage('  hi\u0000 there  ')).toBe('hi there');
    expect(cleanMessage('x'.repeat(1000))).toHaveLength(1000);
    expect(cleanMessage('x'.repeat(1001))).toBeNull();
    expect(cleanMessage(42)).toBeNull();
  });

  it('titleFromMessage takes the first line and shortens long titles', () => {
    expect(titleFromMessage('What is new?\nSecond line')).toBe('What is new?');
    expect(titleFromMessage('x'.repeat(100))).toHaveLength(60);
  });
});

describe('Gemini call and reply parsing', () => {
  it('extracts only answer text and skips thought parts', () => {
    expect(extractReplyText({
      candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'Hello ' }, { text: 'there.' }] } }],
    })).toBe('Hello there.');
    expect(extractReplyText({ candidates: [] })).toBe('');
    expect(extractReplyText({ candidates: [{ finishReason: 'SAFETY' }] })).toBe('');
  });

  it('sends the key only in the request header, sends the chat as turns, and never redirects', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Yes.' }] } }],
    }), { status: 200 }));
    const result = await callGemini(FAKE_KEY, {
      system: 'sys',
      turns: [{ role: 'user', text: 'hi' }, { role: 'model', text: 'hello' }, { role: 'user', text: 'again' }],
    }, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, text: 'Yes.' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${BUDDY_GEMINI_MODEL}:generateContent`);
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(FAKE_KEY);
    expect(url).not.toContain(FAKE_KEY);
    expect(String(init.body)).not.toContain(FAKE_KEY);
    const body = JSON.parse(String(init.body)) as { contents: Array<{ role: string }> };
    expect(body.contents.map((turn) => turn.role)).toEqual(['user', 'model', 'user']);
  });

  it('maps HTTP outcomes without reading or returning the provider body', async () => {
    const make = (status: number) => vi.fn(async () => new Response(`{"error":"${FAKE_KEY}"}`, { status }));
    expect(await callGemini(FAKE_KEY, { system: 's', turns: [] }, make(403) as unknown as typeof fetch)).toEqual({ ok: false, outcome: 'rejected' });
    expect(await callGemini(FAKE_KEY, { system: 's', turns: [] }, make(429) as unknown as typeof fetch)).toEqual({ ok: false, outcome: 'rate_limited' });
    expect(await callGemini(FAKE_KEY, { system: 's', turns: [] }, make(503) as unknown as typeof fetch)).toEqual({ ok: false, outcome: 'unavailable' });
    const network = vi.fn(async () => { throw new Error('offline'); });
    expect(await callGemini(FAKE_KEY, { system: 's', turns: [] }, network as unknown as typeof fetch)).toEqual({ ok: false, outcome: 'unavailable' });
  });
});
