import { describe, expect, it, vi } from 'vitest';
import {
  BUDDY_GEMINI_MODEL,
  BUDDY_SYSTEM_INSTRUCTION,
  BUDDY_TEST_PROMPT,
  callGemini,
  cleanMessage,
  extractReplyText,
  handleBuddyThink,
  NO_KEY_MESSAGE,
  type BuddyThinkDeps,
  type GeminiResult,
} from '../../supabase/functions/_shared/buddyThink';

const FAKE_KEY = 'FAKE-GEMINI-KEY-NOT-REAL-0001';

function deps(overrides: Partial<BuddyThinkDeps> = {}) {
  const recordProbe = vi.fn(async () => {});
  const askGemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: 'Yes, Buddy can think.' }));
  const base: BuddyThinkDeps = {
    keyConfigured: async () => true,
    readKey: async () => FAKE_KEY,
    allowCall: async () => true,
    askGemini,
    recordProbe,
    ...overrides,
  };
  return { deps: base, askGemini, recordProbe };
}

describe('Buddy think: missing key is honest and makes no model call', () => {
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
});

describe('Buddy think: a real call returns model text, never a template', () => {
  it('sends the fixed test prompt and the Buddy instruction, then returns the model reply', async () => {
    const { deps: d, askGemini, recordProbe } = deps();
    const result = await handleBuddyThink({ action: 'probe' }, d);
    expect(askGemini).toHaveBeenCalledWith(FAKE_KEY, { system: BUDDY_SYSTEM_INSTRUCTION, text: BUDDY_TEST_PROMPT });
    expect(result.body).toEqual({
      ok: true,
      action: 'probe',
      model: BUDDY_GEMINI_MODEL,
      reply: 'Yes, Buddy can think.',
      can_think: true,
    });
    expect(recordProbe).toHaveBeenCalledWith('ok');
  });

  it('passes the owner message through for ask, with control characters removed', async () => {
    const { deps: d, askGemini, recordProbe } = deps();
    const result = await handleBuddyThink({ action: 'ask', message: '  What is on the shop?\u0007  ' }, d);
    expect(askGemini).toHaveBeenCalledWith(FAKE_KEY, { system: BUDDY_SYSTEM_INSTRUCTION, text: 'What is on the shop?' });
    expect(result.body).toMatchObject({ ok: true, action: 'ask', reply: 'Yes, Buddy can think.' });
    expect(result.body).not.toHaveProperty('can_think');
    expect(recordProbe).not.toHaveBeenCalled();
  });

  it('never echoes the key back in any answer', async () => {
    const { deps: d } = deps();
    const answers = [
      await handleBuddyThink({ action: 'status' }, d),
      await handleBuddyThink({ action: 'probe' }, d),
      await handleBuddyThink({ action: 'ask', message: 'hello' }, d),
    ];
    for (const answer of answers) expect(JSON.stringify(answer)).not.toContain(FAKE_KEY);
  });
});

describe('Buddy think: failures are honest and never invent a reply', () => {
  it('reports a rejected key and records invalid on the existing key status', async () => {
    const { deps: d, recordProbe } = deps({ askGemini: async () => ({ ok: false, outcome: 'rejected' }) });
    const result = await handleBuddyThink({ action: 'probe' }, d);
    expect(result.body).toMatchObject({ ok: false, reason: 'rejected', can_think: false });
    expect(result.body).not.toHaveProperty('reply');
    expect(recordProbe).toHaveBeenCalledWith('invalid');
  });

  it('maps rate limits and empty answers to plain messages with no reply text', async () => {
    const limited = await handleBuddyThink({ action: 'probe' }, deps({ askGemini: async () => ({ ok: false, outcome: 'rate_limited' }) }).deps);
    expect(limited.body).toMatchObject({ ok: false, reason: 'rate_limited' });
    const empty = await handleBuddyThink({ action: 'ask', message: 'hi' }, deps({ askGemini: async () => ({ ok: false, outcome: 'empty' }) }).deps);
    expect(empty.body).toMatchObject({ ok: false, reason: 'empty' });
    expect(empty.body).not.toHaveProperty('reply');
  });

  it('refuses when the rate limit cannot be checked (fails closed) and when the owner is over the limit', async () => {
    const askGemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: 'x' }));
    const broken = await handleBuddyThink({ action: 'ask', message: 'hi' }, deps({ allowCall: async () => null, askGemini }).deps);
    expect(broken.body).toMatchObject({ ok: false, reason: 'unavailable' });
    const over = await handleBuddyThink({ action: 'ask', message: 'hi' }, deps({ allowCall: async () => false, askGemini }).deps);
    expect(over.body).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(askGemini).not.toHaveBeenCalled();
  });
});

describe('Buddy think: request rules', () => {
  it('refuses unknown fields, unknown actions, empty or over-long messages', async () => {
    const { deps: d } = deps();
    expect((await handleBuddyThink({ action: 'status', extra: 1 }, d)).status).toBe(400);
    expect((await handleBuddyThink({ action: 'publish' }, d)).status).toBe(400);
    expect((await handleBuddyThink({ action: 'ask', message: '   ' }, d)).status).toBe(400);
    expect((await handleBuddyThink({ action: 'ask', message: 'x'.repeat(1001) }, d)).status).toBe(400);
    expect((await handleBuddyThink(null, d)).status).toBe(400);
  });

  it('cleanMessage strips control characters and enforces the length cap', () => {
    expect(cleanMessage('  hi\u0000 there  ')).toBe('hi there');
    expect(cleanMessage('x'.repeat(1000))).toHaveLength(1000);
    expect(cleanMessage('x'.repeat(1001))).toBeNull();
    expect(cleanMessage(42)).toBeNull();
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

  it('sends the key only in the request header, uses the current model, and never redirects', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Yes.' }] } }],
    }), { status: 200 }));
    const result = await callGemini(FAKE_KEY, { system: 'sys', text: 'hi' }, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, text: 'Yes.' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${BUDDY_GEMINI_MODEL}:generateContent`);
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(FAKE_KEY);
    expect(url).not.toContain(FAKE_KEY);
    expect(String(init.body)).not.toContain(FAKE_KEY);
  });

  it('maps HTTP outcomes without reading or returning the provider body', async () => {
    const make = (status: number) => vi.fn(async () => new Response(`{"error":"${FAKE_KEY}"}`, { status }));
    expect(await callGemini(FAKE_KEY, { system: 's', text: 't' }, make(403) as unknown as typeof fetch)).toEqual({ ok: false, outcome: 'rejected' });
    expect(await callGemini(FAKE_KEY, { system: 's', text: 't' }, make(429) as unknown as typeof fetch)).toEqual({ ok: false, outcome: 'rate_limited' });
    expect(await callGemini(FAKE_KEY, { system: 's', text: 't' }, make(503) as unknown as typeof fetch)).toEqual({ ok: false, outcome: 'unavailable' });
    const network = vi.fn(async () => { throw new Error('offline'); });
    expect(await callGemini(FAKE_KEY, { system: 's', text: 't' }, network as unknown as typeof fetch)).toEqual({ ok: false, outcome: 'unavailable' });
  });
});
