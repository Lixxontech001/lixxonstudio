import { describe, expect, it, vi } from 'vitest';
import { ALL_FAILED_LINE } from '../../supabase/functions/_shared/brainChain';
import { NEVER_LIST_LINES } from '../../supabase/functions/_shared/buddyRouter';
import { REFUSAL_LINE } from '../../supabase/functions/_shared/buddyOrderPolicy';
import type { BuddyStateFacts } from '../../supabase/functions/_shared/buddyStateFacts';
import {
  BUDDY_GEMINI_MODEL,
  BUDDY_SYSTEM_INSTRUCTION,
  BUDDY_TEST_PROMPT,
  BUDDY_ANSWER_RULES,
  BUDDY_FACT_ANSWER_RULES,
  BUDDY_ROUTED_ORDER_RULES,
  parseBuddyAnswer,
  callGemini,
  cleanMessage,
  extractReplyText,
  handleBuddyThink,
  HISTORY_TURNS,
  NO_KEY_MESSAGE,
  RUN_DAY_OFF_LINE,
  RUN_DAY_ON_LINE,
  RUN_DAY_UNREADABLE_LINE,
  ORDER_OFF_LINE,
  ORDER_STARTING_LINE,
  ORDER_UNREADABLE_LINE,
  titleFromMessage,
  type BuddyThinkDeps,
  type GeminiResult,
  type GeminiTurn,
} from '../../supabase/functions/_shared/buddyThink';

const FAKE_KEY = 'FAKE-GEMINI-KEY-NOT-REAL-0001';
const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';
const ORDER_ID = '66666666-6666-4666-8666-666666666666';

type Saved = { chatId: string; role: string; kind: string; content: string };

/** Every Gemini call in these tests is an answer to the owner in chat. */
function chatCalls(askGemini: { mock: { calls: unknown[][] } }) {
  return askGemini.mock.calls;
}

function deps(overrides: Partial<BuddyThinkDeps> = {}) {
  const saved: Saved[] = [];
  const recordProbe = vi.fn(async () => {});
  const touchChat = vi.fn(async () => {});
  const askGemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: 'Yes, Buddy can think.' }));
  const base: BuddyThinkDeps = {
    keyConfigured: async () => true,
    readKey: async () => FAKE_KEY,
    readSecret: async () => null,
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
    loadPendingOrder: async () => ({ ok: true as const, instruction: null }),
    saveOrder: async () => ORDER_ID,
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
      articles: { ok: true, total: 0, items: [] },
      products: { ok: true, total: 0, items: [] },
    }),
    ...overrides,
  };
  // Brain keys follow the Google key unless a test sets its own readSecret, so dropping the key drops it everywhere.
  if (!overrides.readSecret) base.readSecret = async (name: string) => (name === 'gemini_api_key' ? base.readKey() : null);
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
    expect(result.body).toEqual({ ok: true, action: 'probe', brain: 'gemini', model: BUDDY_GEMINI_MODEL, reply: 'Yes, Buddy can think.', can_think: true });
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
      json: true,
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
    const turns = (chatCalls(askGemini).at(-1) as unknown as [string, { turns: GeminiTurn[] }])[1].turns;
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
    expect(chatCalls(askGemini)).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it('does not answer when the question cannot be saved', async () => {
    const { deps: d, askGemini } = deps({ saveMessage: async () => false });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Hi' }, d);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, reason: 'not_saved' });
    expect(chatCalls(askGemini)).toHaveLength(0);
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

describe('Buddy think: Gemini writes the reply and says whether the owner asked for work', () => {
  it('reads a clear JSON answer, a plain sentence, and a fenced JSON answer', () => {
    expect(parseBuddyAnswer('{"reply":"Saved.","order":{"mind":"analyst","instruction":"Check the article"}}')).toEqual({
      reply: 'Saved.',
      order: { mind: 'analyst', kind: null, instruction: 'Check the article' },
    });
    expect(parseBuddyAnswer('Yes, Buddy can think.')).toEqual({ reply: 'Yes, Buddy can think.', order: null });
    expect(parseBuddyAnswer('```json\n{"reply":"Hi","order":null}\n```')).toEqual({ reply: 'Hi', order: null });
  });

  it('an unknown mind is kept as no mind, and an order with no words is dropped', () => {
    expect(parseBuddyAnswer('{"reply":"Ok","order":{"mind":"bossman","kind":"mind_work","instruction":"Check it"}}')?.order).toEqual({ mind: null, kind: 'mind_work', instruction: 'Check it' });
    expect(parseBuddyAnswer('{"reply":"Ok","order":{"mind":"ceo","instruction":"  "}}')?.order).toBeNull();
  });

  it('nothing usable gives null: broken JSON, an empty reply, or no text', () => {
    expect(parseBuddyAnswer('{not json}')).toBeNull();
    expect(parseBuddyAnswer('{"reply":"  ","order":null}')).toBeNull();
    expect(parseBuddyAnswer('   ')).toBeNull();
  });

  it('the answer rules ask for JSON only, in the agreed shape, and never mention readers as the owner', () => {
    expect(BUDDY_ANSWER_RULES).toContain('{"reply": "your answer to the owner", "order": null}');
    expect(BUDDY_ANSWER_RULES).toContain('Never reply to readers as the owner.');
    expect(BUDDY_ANSWER_RULES).toContain('Never say a helper was chosen');
    expect(BUDDY_FACT_ANSWER_RULES).toContain('THE SITE RIGHT NOW, THE OPERATIONS RIGHT NOW');
    expect(BUDDY_FACT_ANSWER_RULES).toContain('Always set "order" to null.');
  });

  it('a single Hey gets one fresh brain reply instead of a helpdesk greeting', async () => {
    const livingLine = 'Views slipped while nothing went out; the new guide, “Easy routine for dry skin,” gives us one real place to start.';
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: JSON.stringify({ reply: livingLine, order: null }),
    }));
    const site = {
      articles: { ok: true, total: 1, items: [{ title: 'Easy routine for dry skin', slug: 'easy-routine-dry-skin', publishedAt: '2026-10-08T09:00:00Z', excerpt: null }] },
      products: { ok: true, total: 0, items: [] },
    };
    const { deps: d, saved } = deps({ askGemini, readSiteFacts: async () => site });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Hey' }, d);
    expect(result.body).toMatchObject({ ok: true, reply: livingLine });
    expect(askGemini).toHaveBeenCalledTimes(1);
    expect(askGemini.mock.calls[0][1].turns.at(-1)).toEqual({ role: 'user', text: 'Hey' });
    expect(askGemini.mock.calls[0][1].system).toContain('"Easy routine for dry skin"');
    expect(saved.filter((row) => row.role === 'buddy' && row.kind === 'reply').map((row) => row.content)).toEqual([livingLine]);
    expect(livingLine).not.toMatch(/how can i help|what are we working on today/i);
  });

  it('a mind-log question uses the brain with the current mind log, site facts, operations and chat history', async () => {
    const reply = 'The Analyst checked article views and was blocked because the count was missing.';
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: JSON.stringify({ reply, order: null }),
    }));
    const history: GeminiTurn[] = [{ role: 'user', text: 'We were checking the new guide.' }];
    const readMindLog = vi.fn(async () => [
      {
        happened_at: '2026-10-09T10:30:00Z', day: '2026-10-09', mind: 'analyst',
        action: 'Checked article views', outcome: 'blocked', detail: 'The count was missing, so no claim was made.',
      },
      {
        happened_at: '2026-10-09T10:00:00Z', day: '2026-10-09', mind: 'strategist',
        action: 'Reviewed the plan', outcome: 'done', detail: 'This belongs to another mind.',
      },
    ]);
    const site = {
      articles: { ok: true, total: 1, items: [{ title: 'The live guide', slug: 'live-guide', publishedAt: '2026-10-08T09:00:00Z', excerpt: null }] },
      products: { ok: true, total: 0, items: [] },
    };
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    const { deps: d, saved } = deps({
      askGemini,
      loadHistory: async () => history,
      readMindLog,
      readSiteFacts: async () => site,
      readStateFacts: async () => ({
        takeover: false,
        killScope: 'none',
        orders: { ok: true, total: 0, items: [] },
        log: { ok: true, rows: [] },
        notable: { ok: true, rows: [] },
        doors: { ok: true, rows: [] },
      }),
    });
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'What did the Analyst do?' },
      { ...d, saveOrder },
    );

    expect(result.body).toMatchObject({ ok: true, route: 'mind_log', brain: 'gemini', reply });
    expect(readMindLog).toHaveBeenCalledWith('analyst');
    expect(askGemini).toHaveBeenCalledTimes(1);
    const input = askGemini.mock.calls[0][1];
    expect(input.json).toBe(true);
    expect(input.system).toContain(BUDDY_FACT_ANSWER_RULES);
    expect(input.system).toContain('"Checked article views"');
    expect(input.system).toContain('"The live guide"');
    expect(input.system).toContain('Takeover: off.');
    expect(input.system).not.toContain('This belongs to another mind.');
    expect(input.turns).toEqual([...history, { role: 'user', text: 'What did the Analyst do?' }]);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe(reply);
  });

  it('a connection how-to is brain-written from the approved steps and live facts, without creating an order', async () => {
    const reply = 'Open Connections, find Telegram, and save the bot details there. The test checks the account but posts nothing.';
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: JSON.stringify({ reply, order: null }),
    }));
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    const { deps: d, saved } = deps({ askGemini });
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'How do I connect Telegram?' },
      { ...d, saveOrder },
    );

    expect(result.body).toMatchObject({ ok: true, route: 'how_to', brain: 'gemini', reply });
    expect(askGemini).toHaveBeenCalledTimes(1);
    const input = askGemini.mock.calls[0][1];
    expect(input.system).toContain('APPROVED CONNECTION STEPS');
    expect(input.system).toContain('channel or chat ID');
    expect(input.system).toContain('THE SITE RIGHT NOW');
    expect(input.system).toContain('THE OPERATIONS RIGHT NOW');
    expect(input.system).not.toContain(FAKE_KEY);
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe(reply);
  });

  it('a brain-key how-to is also written by a brain from the approved setup facts', async () => {
    const reply = 'Make a key in Groq Console, then save it on the Brains page. Keep it out of this chat.';
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: JSON.stringify({ reply, order: null }),
    }));
    const { deps: d } = deps({ askGemini });
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'How do I get a Groq key?' },
      d,
    );
    expect(result.body).toMatchObject({ ok: true, route: 'brain_how_to', brain: 'gemini', reply });
    const system = askGemini.mock.calls[0][1].system;
    expect(system).toContain('APPROVED BRAIN-SETUP STEPS');
    expect(system).toContain('console.groq.com');
    expect(system).toContain('Never ask the owner to paste a password, token, or key into this chat.');
    expect(system).not.toContain(FAKE_KEY);
  });

  it('a failed live read is made explicit in the brain context instead of aborting or guessing', async () => {
    const reply = 'I could not check the current shop status, but the saved Telegram setup steps are clear.';
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: JSON.stringify({ reply, order: null }),
    }));
    const { deps: d } = deps({
      askGemini,
      readSiteFacts: async () => { throw new Error('private database detail'); },
      readStateFacts: async () => { throw new Error('private database detail'); },
    });
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'How do I connect Telegram?' },
      d,
    );
    expect(result.body).toMatchObject({ ok: true, route: 'how_to', reply });
    const system = askGemini.mock.calls[0][1].system;
    expect(system).toContain('Published articles: could not be read just now.');
    expect(system).toContain('Takeover: could not be read just now.');
    expect(system).not.toContain('private database detail');
  });

  it('an unavailable mind log is passed as unavailable, so the brain cannot fill it with a guess', async () => {
    const reply = 'I could not read the Analyst log just now, so I cannot say what it did.';
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: JSON.stringify({ reply, order: null }),
    }));
    const { deps: d } = deps({ askGemini, readMindLog: async () => null });
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'What did the Analyst do?' },
      d,
    );
    expect(result.body).toMatchObject({ ok: true, route: 'mind_log', reply });
    expect(askGemini.mock.calls[0][1].system).toContain('Could not be read just now. Do not describe any action.');
  });

  it('a fact-question answer cannot file work even if a brain proposes an order', async () => {
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: JSON.stringify({
        reply: 'I started the run.',
        order: { mind: 'executioner', kind: 'mind_work', instruction: 'Run today' },
      }),
    }));
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    const { deps: d, saved } = deps({ askGemini });
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'What did the Analyst do?' },
      { ...d, saveOrder },
    );
    expect(result.body).toMatchObject({ ok: false, route: 'mind_log', reason: 'unreadable' });
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)).toMatchObject({ role: 'buddy', kind: 'notice' });
    expect(saved.at(-1)?.content).not.toContain('I started the run');
  });

  it('a fact question with no configured brain saves only an honest no-key notice', async () => {
    const { deps: d, askGemini, saved } = deps({ readKey: async () => null });
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'What did the Analyst do?' },
      d,
    );
    expect(result.body).toMatchObject({ ok: false, route: 'mind_log', reason: 'no_key', message: NO_KEY_MESSAGE });
    expect(askGemini).not.toHaveBeenCalled();
    expect(saved).toEqual([
      { chatId: CHAT_ID, role: 'owner', kind: 'reply', content: 'What did the Analyst do?' },
      { chatId: CHAT_ID, role: 'buddy', kind: 'notice', content: NO_KEY_MESSAGE },
    ]);
  });

  it('a routed order keeps its internal path but the brain writes the owner-facing thought from live facts', async () => {
    const livingLine = 'The newest guide is “Easy routine for dry skin,” and nothing went out today; I would start there.';
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: livingLine }));
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    const site = {
      articles: { ok: true, total: 1, items: [{ title: 'Easy routine for dry skin', slug: 'easy-routine-dry-skin', publishedAt: '2026-10-08T09:00:00Z', excerpt: null }] },
      products: { ok: true, total: 0, items: [] },
    };
    const state: BuddyStateFacts = {
      takeover: true,
      killScope: 'none',
      orders: { ok: true, total: 0, items: [] },
      log: { ok: true, rows: [] },
      notable: { ok: true, rows: [] },
      doors: { ok: true, rows: [] },
    };
    const { deps: d, saved } = deps({ askGemini, saveOrder, readSiteFacts: async () => site, readStateFacts: async () => state });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Do something (anything), do not ask me what' }, d);
    expect(result.body).toMatchObject({ ok: true, route: 'order', reply: livingLine });
    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Do something (anything), do not ask me what', 'executioner');
    expect(askGemini).toHaveBeenCalledTimes(1);
    const thoughtInput = askGemini.mock.calls[0][1];
    expect(thoughtInput.system).toContain(BUDDY_ROUTED_ORDER_RULES);
    expect(thoughtInput.system).toContain('Takeover: on.');
    expect(thoughtInput.system).toContain('"Easy routine for dry skin"');
    expect(thoughtInput.turns.at(-1)).toEqual({ role: 'user', text: 'Do something (anything), do not ask me what' });
    expect(saved.at(-1)?.content).toBe(livingLine);
    expect(livingLine).not.toMatch(/Executioner|No mind was named|Saved for|next run/i);
  });

  it('a named-mind order the model finds is saved internally while its own thought is shown', async () => {
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: '{"reply":"Got it.","order":{"mind":"strategist","kind":"mind_work","instruction":"Plan the spring push for the kit"}}',
    }));
    const { deps: d, saved } = deps({ askGemini });
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'The spring kit plan needs work, and the Strategist is the one for it.' }, { ...d, saveOrder });
    expect(result.body).toMatchObject({ ok: true, route: 'chat' });
    expect(result.body).not.toHaveProperty('filed');
    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Plan the spring push for the kit', 'strategist');
    expect(saved.at(-1)?.content).toBe('Got it.');
    expect(saved.at(-1)?.content).not.toMatch(/Strategist|Saved for|waiting|next run/i);
    expect(askGemini.mock.calls[0][1]).toMatchObject({ json: true });
  });

  it('an order the model sends with no mind is routed internally and no routing copy is added', async () => {
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: '{"reply":"Got it.","order":{"mind":null,"kind":"mind_work","instruction":"Plan the spring push for the kit"}}',
    }));
    const saveMessage = vi.fn(async () => true);
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    const { deps: d } = deps({ askGemini, saveMessage });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'The spring kit plan needs work soon.' }, { ...d, saveOrder });
    expect(result.body).toMatchObject({ ok: true });
    expect(result.body).not.toHaveProperty('filed');
    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Plan the spring push for the kit', 'strategist');
    // No routing details are concatenated to the reply.
    expect(saveMessage).toHaveBeenCalledWith(CHAT_ID, 'buddy', 'reply', 'Got it.');
  });

  it('an answer that cannot be read files nothing and says so in the chat', async () => {
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: '{"reply":' }));
    const { deps: d, saved } = deps({ askGemini });
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Something about the kit plan.' }, { ...d, saveOrder });
    expect(result.body).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)).toMatchObject({ role: 'buddy', kind: 'notice' });
  });

  it('a model order that asks to publish is refused, not filed, so no waiting order is left behind', async () => {
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: '{"reply":"Okay.","order":{"mind":"executioner","instruction":"Publish the new article now"}}',
    }));
    const { deps: d, saved } = deps({ askGemini });
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Thanks, the article looks good to me.' }, { ...d, saveOrder });
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe(REFUSAL_LINE);
  });

  it('the model is shown the live state: Takeover, kill switch, waiting orders and notable events', async () => {
    const state: BuddyStateFacts = {
      takeover: false,
      killScope: 'none',
      orders: { ok: true, total: 1, items: [{ instruction: 'Check the article', mind: 'analyst' }] },
      log: { ok: true, rows: [] },
      notable: { ok: true, rows: [] },
      doors: { ok: true, rows: [] },
    };
    const { deps: d, askGemini } = deps({ readStateFacts: async () => state });
    await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'How are things going?' }, d);
    const system = askGemini.mock.calls[0][1].system;
    expect(system).toContain('Takeover: off.');
    expect(system).toContain('Kill switch: none. Nothing is stopped.');
    expect(system).toContain('"Check the article" (for the Analyst)');
  });

  it('a request to reply to a reader is refused with no model call, even with a key', async () => {
    const { deps: d, askGemini, saved } = deps();
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Reply to the customer who asked about the bag' }, d);
    expect(result.body).toMatchObject({ ok: true, route: 'never_list', reply: NEVER_LIST_LINES.reader });
    expect(askGemini).not.toHaveBeenCalled();
    expect(saved.at(-1)).toEqual({ chatId: CHAT_ID, role: 'buddy', kind: 'reply', content: NEVER_LIST_LINES.reader });
  });

  it('a request to spend money is refused the same way', async () => {
    const { deps: d, askGemini } = deps();
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Spend 50 dollars on ads for the summer post' }, d);
    expect(result.body).toMatchObject({ route: 'never_list', reply: NEVER_LIST_LINES.spend });
    expect(askGemini).not.toHaveBeenCalled();
  });

  it('with no key, an order that names no mind is placed by the rules, with no model call', async () => {
    const { deps: d, askGemini, saved } = deps({ readKey: async () => null });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Do the new article' }, d);
    expect(result.body).toMatchObject({ route: 'order' });
    expect(saved.at(-1)?.content).toBe(NO_KEY_MESSAGE);
    expect(saved.at(-1)?.content).not.toMatch(/No mind was named|Executioner|Saved for|next run/i);
    expect(askGemini).not.toHaveBeenCalled();
  });
});

describe("Buddy think: asking for today's run", () => {
  it('takeover off: filed with no mind, Buddy says it waits, and nothing is started', async () => {
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    const { deps: d, askGemini } = deps({ saveOrder, readTakeover: async () => false });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Run the products' }, d);
    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Run the products', null);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, route: 'run_day', reply: RUN_DAY_OFF_LINE });
    expect(result.body).not.toHaveProperty('run_start');
    expect(askGemini).not.toHaveBeenCalled();
  });

  it('takeover on: the reply asks the browser to start the exact saved daily run', async () => {
    const { deps: d } = deps({ readTakeover: async () => true });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: "Make today's posts" }, d);
    expect(result.body).toMatchObject({
      ok: true,
      route: 'run_day',
      reply: RUN_DAY_ON_LINE,
      run_start: true,
      run_order_id: ORDER_ID,
    });
  });

  it('Takeover on starts an eligible product-line order by its saved id', async () => {
    const { deps: d } = deps({ readTakeover: async () => true });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Swap the kit onto the guide' }, d);
    expect(result.body).toMatchObject({ ok: true, route: 'order', run_start: true, run_order_id: ORDER_ID });
    expect(result.body.reply).toContain(ORDER_STARTING_LINE);
  });

  it('Takeover off leaves an eligible product-line order waiting and makes no run request', async () => {
    const saveOrder = vi.fn(async () => ORDER_ID);
    const { deps: d } = deps({ saveOrder, readTakeover: async () => false });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Swap the kit onto the guide' }, d);
    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Swap the kit onto the guide', 'executioner');
    expect(result.body).toMatchObject({ ok: true, route: 'order' });
    expect(result.body.reply).toContain(ORDER_OFF_LINE);
    expect(result.body).not.toHaveProperty('run_start');
    expect(result.body).not.toHaveProperty('run_order_id');
  });

  it('does not start a product-line request when its price rule holds it', async () => {
    const { deps: d } = deps({ readTakeover: async () => true });
    const result = await handleBuddyThink({
      action: 'ask',
      chat_id: CHAT_ID,
      message: 'Tell the Executioner to add the product to the article and change the price to 20 dollars',
    }, d);
    expect(result.body).toMatchObject({ ok: true, route: 'order' });
    expect(result.body).not.toHaveProperty('run_start');
    expect(result.body).not.toHaveProperty('run_order_id');
  });

  it('a Takeover read failure does not start an eligible order', async () => {
    const { deps: d } = deps({ readTakeover: async () => null });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Swap the kit onto the guide' }, d);
    expect(result.body.reply).toContain(ORDER_UNREADABLE_LINE);
    expect(result.body).not.toHaveProperty('run_start');
  });

  it('Takeover unreadable: the order waits and nothing is started', async () => {
    const { deps: d } = deps({ readTakeover: async () => null });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Daily run' }, d);
    expect(result.body).toMatchObject({ ok: true, reply: RUN_DAY_UNREADABLE_LINE });
    expect(result.body).not.toHaveProperty('run_start');
  });

  it('an order that cannot be saved is refused, and nothing is said as if it was filed', async () => {
    const { deps: d } = deps({ saveOrder: async () => null, readTakeover: async () => true });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Run the products' }, d);
    expect(result.status).toBe(503);
    expect(result.body).not.toHaveProperty('run_start');
  });
});

describe('Buddy think: a messy question about the shop reaches Gemini with real names', () => {
  it('sends the real product name and price with the question, and keeps the model reply as written', async () => {
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: 'The Linen Bath Sheet is a good fit for that.' }));
    const { deps: d, saved } = deps({
      askGemini,
      readSiteFacts: async () => ({
        articles: { ok: true, total: 0, items: [] },
        products: { ok: true, total: 1, items: [{ name: 'Linen Bath Sheet', priceUsd: 34 }] },
      }),
    });
    const message = 'my sister is always cold after her shower, what in your shop would help her?';
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message }, d);
    expect(result.body).toMatchObject({ ok: true, route: 'chat', reply: 'The Linen Bath Sheet is a good fit for that.' });
    expect(askGemini).toHaveBeenCalledTimes(1);
    expect(askGemini.mock.calls[0][1].system).toContain('Linen Bath Sheet');
    expect(askGemini.mock.calls[0][1].turns.at(-1)).toEqual({ role: 'user', text: message });
    expect(saved.at(-1)?.content).toBe('The Linen Bath Sheet is a good fit for that.');
  });
});

describe('Buddy think: the brain chain answers the owner', () => {
  const GROQ_KEY = 'FAKE-GROQ-KEY-PHASE-A';
  const GROQ_ANSWER = '{"reply":"Groq says hello.","order":null}';
  const QUESTION = 'Tell me how the shop is doing this week.';

  /** A saved-key map for the fake Vault. Only the names given are saved. */
  function vaultWith(saved: Record<string, string>) {
    return async (name: string) => (Object.prototype.hasOwnProperty.call(saved, name) ? saved[name] : null);
  }

  /** A fake chat-completions fetch. Each call gets the reply text for that brain. */
  function fakeChat(content: string | null, status = 200) {
    return vi.fn(async () => {
      if (content === null) return new Response('', { status });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
    });
  }

  it('Gemini rate limited, Groq saved: Groq answers, the body names Groq, and the log says so', async () => {
    const fetchImpl = fakeChat(GROQ_ANSWER);
    const logBrain = vi.fn(async () => {});
    const gemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: false, outcome: 'rate_limited' }));
    const { deps: d, saved } = deps({
      askGemini: gemini,
      readSecret: vaultWith({ gemini_api_key: FAKE_KEY, groq_api_key: GROQ_KEY }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logBrain,
    });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: QUESTION }, d);
    expect(result.body).toMatchObject({ ok: true, brain: 'groq', model: 'openai/gpt-oss-120b', reply: 'Groq says hello.' });
    expect(gemini).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(saved.at(-1)?.content).toBe('Groq says hello.');
    expect(logBrain).toHaveBeenCalledWith('Groq answered after Google Gemini did not.');
  });

  it('Gemini sends text that is not the JSON answer: the next saved brain is asked and answers', async () => {
    const fetchImpl = fakeChat(GROQ_ANSWER);
    const { deps: d } = deps({
      askGemini: vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: '{"reply":' })),
      readSecret: vaultWith({ gemini_api_key: FAKE_KEY, groq_api_key: GROQ_KEY }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: QUESTION }, d);
    expect(result.body).toMatchObject({ ok: true, brain: 'groq', reply: 'Groq says hello.' });
  });

  it('only one brain saved and it is rate limited: the one honest line, a notice, and nothing crashes', async () => {
    const { deps: d, saved } = deps({
      readSecret: vaultWith({ groq_api_key: GROQ_KEY }),
      fetchImpl: fakeChat(null, 429) as unknown as typeof fetch,
    });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: QUESTION }, d);
    expect(result.body).toMatchObject({ ok: false, reason: 'rate_limited', message: ALL_FAILED_LINE });
    expect(saved.at(-1)).toEqual({ chatId: CHAT_ID, role: 'buddy', kind: 'notice', content: ALL_FAILED_LINE });
  });

  it('every saved brain fails: one honest line in the chat, and no key or stack trace in it', async () => {
    const { deps: d, saved } = deps({
      askGemini: vi.fn(async (): Promise<GeminiResult> => ({ ok: false, outcome: 'rate_limited' })),
      readSecret: vaultWith({ gemini_api_key: FAKE_KEY, groq_api_key: GROQ_KEY }),
      fetchImpl: fakeChat(null, 500) as unknown as typeof fetch,
    });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: QUESTION }, d);
    expect(result.body).toMatchObject({ ok: false, message: ALL_FAILED_LINE });
    const everything = `${JSON.stringify(result.body)} ${saved.map((row) => row.content).join(' ')}`;
    expect(everything).not.toContain(FAKE_KEY);
    expect(everything).not.toContain(GROQ_KEY);
    expect(everything).not.toMatch(/\bat\b.*\.ts:\d+/);
  });

  it('a log line that cannot be saved does not stop the answer', async () => {
    const { deps: d } = deps({
      readSecret: vaultWith({ gemini_api_key: FAKE_KEY, groq_api_key: GROQ_KEY }),
      askGemini: vi.fn(async (): Promise<GeminiResult> => ({ ok: false, outcome: 'unavailable' })),
      fetchImpl: fakeChat(GROQ_ANSWER) as unknown as typeof fetch,
      logBrain: async () => {
        throw new Error('insert failed');
      },
    });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: QUESTION }, d);
    expect(result.body).toMatchObject({ ok: true, brain: 'groq' });
  });

  it('Gemini alone, answering: the model is still Gemini and the brain is named gemini', async () => {
    const { deps: d } = deps({ askGemini: vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: '{"reply":"Hi.","order":null}' })) });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: QUESTION }, d);
    expect(result.body).toMatchObject({ ok: true, brain: 'gemini', model: BUDDY_GEMINI_MODEL });
  });
});

describe('Buddy think: the closed list of orders', () => {
  it('a refused owner request is not filed, and the reply is the one refusal line', async () => {
    const { deps: d, askGemini, saved } = deps();
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'Refund order 1042 to Jane' },
      { ...d, saveOrder },
    );
    expect(result.body).toMatchObject({ ok: true, route: 'refused' });
    expect(saveOrder).not.toHaveBeenCalled();
    expect(askGemini).not.toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe(REFUSAL_LINE);
  });

  it('a model order that asks for a refund is refused: nothing is filed and the model text is not kept', async () => {
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({
      ok: true,
      text: '{"reply":"Done, I refunded her.","order":{"mind":"ceo","instruction":"Refund order 1042 to Jane"}}',
    }));
    const { deps: d, saved } = deps({ askGemini });
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    const result = await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'The Jane order needs sorting out, and the refund is the hard part.' },
      { ...d, saveOrder },
    );
    expect(result.body).toMatchObject({ ok: true, route: 'chat' });
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe(REFUSAL_LINE);
    expect(saved.at(-1)?.content).not.toContain('refunded');
  });

  it('a routed order with Takeover on keeps the brain reply and does not mention a later run', async () => {
    const { deps: d, saved } = deps({ readTakeover: async () => true });
    const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
    await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'Plan the spring push for the kit with the Strategist.' },
      { ...d, saveOrder },
    );
    expect(saveOrder).toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe('Yes, Buddy can think.');
    expect(saved.at(-1)?.content).not.toMatch(/Strategist|Saved for|waiting|next run/i);
  });

  it('an unreadable Takeover does not produce a canned route statement', async () => {
    const { deps: d, saved } = deps({ readTakeover: async () => { throw new Error('down'); } });
    await handleBuddyThink(
      { action: 'ask', chat_id: CHAT_ID, message: 'Plan the spring push for the kit with the Strategist.' },
      { ...d, saveOrder: async () => '66666666-6666-4666-8666-666666666666' },
    );
    expect(saved.at(-1)?.content).toBe('Yes, Buddy can think.');
    expect(saved.at(-1)?.content).not.toMatch(/Strategist|Saved for|waiting|next run/i);
  });
});
