import { describe, expect, it, vi } from 'vitest';
import { ALL_FAILED_LINE } from '../../supabase/functions/_shared/brainChain';
import {
  BUDDY_GEMINI_MODEL,
  NO_KEY_MESSAGE,
  handleBuddyThink,
  type BuddyThinkDeps,
  type GeminiResult,
} from '../../supabase/functions/_shared/buddyThink';

// The probe walks the same brain chain as a chat answer. These tests use fake Vault reads and fake fetch only.

const GEMINI_KEY = 'FAKE-GEMINI-KEY-NOT-REAL-0001';
const GROQ_KEY = 'FAKE-GROQ-KEY-NOT-REAL-0002';
const GROQ_MODEL = 'openai/gpt-oss-120b';

function vaultWith(saved: Record<string, string>) {
  return async (name: string) => (Object.prototype.hasOwnProperty.call(saved, name) ? saved[name] : null);
}

/** A fake chat-completions fetch. `content` is the reply text, or null for an HTTP error with `status`. */
function fakeChat(content: string | null, status = 200) {
  return vi.fn(async () => {
    if (content === null) return new Response('', { status });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
  });
}

function probeDeps(overrides: Partial<BuddyThinkDeps> = {}) {
  const recordProbe = vi.fn(async () => {});
  const askGemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: 'Yes, Buddy can think.' }));
  const base: BuddyThinkDeps = {
    keyConfigured: async () => true,
    readKey: async () => GEMINI_KEY,
    readSecret: async () => null,
    allowCall: async () => true,
    askGemini,
    recordProbe,
    loadChat: async () => null,
    loadHistory: async () => [],
    saveMessage: async () => true,
    touchChat: async () => {},
    now: () => new Date('2026-10-10T12:00:00Z'),
    getSeenAt: async () => ({ ok: true, seenAt: null }),
    markSeen: async () => true,
    readBriefingFacts: async () => ({
      articles: { ok: true, count: 0, titles: [] },
      orders: { ok: true, paidCount: 0, usdTotal: 0 },
      views: { ok: true, count: 0 },
      failures: { ok: true, count: 0, codes: [] },
    }),
    findOrCreateBriefing: async () => null,
    loadPendingOrder: async () => ({ ok: true as const, instruction: null }),
    saveOrder: async () => true,
    readMindLog: async () => [],
    readTakeover: async () => false,
    readStateFacts: async () => ({
      takeover: false,
      killScope: 'none',
      orders: { ok: true, total: 0, items: [] },
      log: { ok: true, rows: [] },
      notable: { ok: true, rows: [] },
    }),
    readSiteFacts: async () => ({ articles: { ok: true, titles: [] }, products: { ok: true, items: [] } }),
    applyControl: async () => true,
    logBrain: async () => {},
  } as unknown as BuddyThinkDeps;
  const deps = { ...base, ...overrides } as BuddyThinkDeps;
  // Return the Gemini mock that is actually wired in, so a test can check it was or was not called.
  return { deps, recordProbe, askGemini: deps.askGemini as unknown as typeof askGemini };
}

describe('Buddy probe walks the brain chain', () => {
  it('only Groq saved: the probe answers from Groq and says so', async () => {
    const fetchImpl = fakeChat('Yes, Buddy can think.');
    const { deps, recordProbe, askGemini } = probeDeps({
      readKey: async () => null,
      readSecret: vaultWith({ groq_api_key: GROQ_KEY }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await handleBuddyThink({ action: 'probe' }, deps);
    expect(result.body).toMatchObject({ ok: true, action: 'probe', brain: 'groq', model: GROQ_MODEL, can_think: true });
    expect(askGemini).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // The stored probe status belongs to the Google key. A Groq answer must not write it.
    expect(recordProbe).not.toHaveBeenCalled();
  });

  it('Gemini rate limited, Groq saved: the probe moves to Groq and answers', async () => {
    const fetchImpl = fakeChat('Yes, Buddy can think.');
    const { deps, askGemini, recordProbe } = probeDeps({
      askGemini: vi.fn(async (): Promise<GeminiResult> => ({ ok: false, outcome: 'rate_limited' })),
      readSecret: vaultWith({ gemini_api_key: GEMINI_KEY, groq_api_key: GROQ_KEY }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await handleBuddyThink({ action: 'probe' }, deps);
    expect(askGemini).toHaveBeenCalledTimes(1);
    expect(result.body).toMatchObject({ ok: true, brain: 'groq', model: GROQ_MODEL, can_think: true });
    // Gemini was not the answering brain, so its stored status is not written by this probe.
    expect(recordProbe).not.toHaveBeenCalled();
  });

  it('Gemini alone and answering: the stored Google status is written as ok', async () => {
    const { deps, recordProbe } = probeDeps({ readSecret: vaultWith({ gemini_api_key: GEMINI_KEY }) });
    const result = await handleBuddyThink({ action: 'probe' }, deps);
    expect(result.body).toEqual({ ok: true, action: 'probe', brain: 'gemini', model: BUDDY_GEMINI_MODEL, reply: 'Yes, Buddy can think.', can_think: true });
    expect(recordProbe).toHaveBeenCalledWith('ok');
  });

  it('no brain saved: the probe says no key and calls no brain', async () => {
    const fetchImpl = fakeChat('unused');
    const { deps, askGemini, recordProbe } = probeDeps({
      readKey: async () => null,
      readSecret: vaultWith({}),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await handleBuddyThink({ action: 'probe' }, deps);
    expect(result.body).toMatchObject({ ok: false, reason: 'no_key', message: NO_KEY_MESSAGE, can_think: false });
    expect(askGemini).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recordProbe).not.toHaveBeenCalled();
  });

  it('every saved brain fails: the probe gives the honest line and names no single provider', async () => {
    const fetchImpl = fakeChat(null, 503);
    const { deps, recordProbe } = probeDeps({
      askGemini: vi.fn(async (): Promise<GeminiResult> => ({ ok: false, outcome: 'rate_limited' })),
      readSecret: vaultWith({ gemini_api_key: GEMINI_KEY, groq_api_key: GROQ_KEY }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await handleBuddyThink({ action: 'probe' }, deps);
    expect(result.body).toMatchObject({ ok: false, action: 'probe', reason: 'unavailable', message: ALL_FAILED_LINE, can_think: false });
    expect(JSON.stringify(result)).not.toContain(GEMINI_KEY);
    expect(JSON.stringify(result)).not.toContain(GROQ_KEY);
    // Two brains were tried, so the stored Google status is left alone.
    expect(recordProbe).not.toHaveBeenCalled();
  });

  it('Gemini alone fails: the stored Google status is written with the mapped failure', async () => {
    const { deps, recordProbe } = probeDeps({
      askGemini: vi.fn(async (): Promise<GeminiResult> => ({ ok: false, outcome: 'rejected' })),
      readSecret: vaultWith({ gemini_api_key: GEMINI_KEY }),
    });
    const result = await handleBuddyThink({ action: 'probe' }, deps);
    expect(result.body).toMatchObject({ ok: false, reason: 'rejected', can_think: false });
    expect(recordProbe).toHaveBeenCalledWith('invalid');
  });
});
