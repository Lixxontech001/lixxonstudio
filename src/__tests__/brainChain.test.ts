// @vitest-environment node
// Phase A slice 2: askBrains walks the brains in order. Fake fetch and fake Vault only. No live provider is called.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_FAILED_LINE,
  BRAIN_MAX_REPLY_CHARS,
  BRAIN_TIMEOUT_MS,
  NONE_SAVED_LINE,
  anyBrainSaved,
  askBrains,
  brainAnswerLine,
  type BrainInput,
  type BrainPorts,
} from '../../supabase/functions/_shared/brainChain';
import { BRAIN_SLOTS } from '../../supabase/functions/_shared/brains';
import { BUDDY_GEMINI_MODEL } from '../../supabase/functions/_shared/buddyThink';

const INPUT: BrainInput = {
  system: 'You are Buddy. Plain English.',
  turns: [
    { role: 'user', text: 'What is on the site today?' },
    { role: 'model', text: 'Two articles are live.' },
    { role: 'user', text: 'Which one first?' },
  ],
};

// Fake keys, for tests only. They are not real and are never written anywhere else.
const FAKE = {
  gemini: 'FAKE-GEMINI-KEY-PHASE-A',
  groq: 'FAKE-GROQ-KEY-PHASE-A',
  nvidia: 'FAKE-NVIDIA-KEY-PHASE-A',
  cloudflare: 'FAKE-CLOUDFLARE-TOKEN-PHASE-A',
  openrouter: 'FAKE-OPENROUTER-KEY-PHASE-A',
  cerebras: 'FAKE-CEREBRAS-KEY-PHASE-A',
  huggingface: 'FAKE-HF-TOKEN-PHASE-A',
  deepseek: 'FAKE-DEEPSEEK-KEY-PHASE-A',
};
const ACCOUNT = 'fake-account-id-phase-a';

type Behaviour = 'hang' | 'throw' | { status: number; body?: unknown; raw?: string };

const HOST = {
  groq: 'api.groq.com',
  nvidia: 'integrate.api.nvidia.com',
  cloudflare: 'api.cloudflare.com',
  openrouter: 'openrouter.ai',
  cerebras: 'api.cerebras.ai',
  huggingface: 'router.huggingface.co',
  deepseek: 'api.deepseek.com',
} as const;

const OK_BODY = (text: string) => ({ choices: [{ message: { content: text } }] });

/** A fake fetch. Each host gets one behaviour. A host with no entry answers 200 "ok from <host>". */
function fakeFetch(behaviours: Partial<Record<string, Behaviour>>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url));
    const behaviour = behaviours[target.host];
    if (behaviour === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (behaviour === 'throw') throw new Error('network down');
    if (behaviour) {
      const raw = behaviour.raw ?? (behaviour.body === undefined ? '' : JSON.stringify(behaviour.body));
      return new Response(raw, { status: behaviour.status });
    }
    return new Response(JSON.stringify(OK_BODY(`ok from ${target.host}`)), { status: 200 });
  });
}

/** A fake Vault. Only the names given are "saved". */
function vault(saved: Record<string, string>): BrainPorts['readSecret'] {
  return async (name: string) => (Object.prototype.hasOwnProperty.call(saved, name) ? saved[name] : null);
}

function ports(options: {
  saved?: Record<string, string>;
  fetch?: ReturnType<typeof fakeFetch>;
  gemini?: BrainPorts['askGemini'];
  readSecret?: BrainPorts['readSecret'];
} = {}) {
  const fetchMock = options.fetch ?? fakeFetch({});
  const gemini = options.gemini ?? (async () => ({ ok: true as const, text: 'ok from Google' }));
  const askGemini = vi.fn(gemini);
  return {
    fetchMock,
    askGemini,
    ports: {
      readSecret: options.readSecret ?? vault(options.saved ?? {}),
      askGemini,
      fetchImpl: fetchMock as unknown as typeof fetch,
    } satisfies BrainPorts,
  };
}

const EVERY_KEY = {
  gemini_api_key: FAKE.gemini,
  groq_api_key: FAKE.groq,
  nvidia_api_key: FAKE.nvidia,
  cloudflare_api_token: FAKE.cloudflare,
  cloudflare_account_id: ACCOUNT,
  openrouter_api_key: FAKE.openrouter,
  cerebras_api_key: FAKE.cerebras,
  huggingface_token: FAKE.huggingface,
  deepseek_api_key: FAKE.deepseek,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('no key saved: skip everything, one honest line', () => {
  it('with no brain saved, nothing is called and the line says no thinking key is saved', async () => {
    const { ports: p, fetchMock, askGemini } = ports();
    const result = await askBrains(INPUT, p);
    expect(result).toEqual({ ok: false, reason: 'none_saved', line: NONE_SAVED_LINE, tried: [], lastOutcome: 'none_saved' });
    expect(askGemini).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blank keys count as not saved', async () => {
    const { ports: p, fetchMock } = ports({ saved: { groq_api_key: '   ', nvidia_api_key: '' } });
    const result = await askBrains(INPUT, p);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a Vault read that throws counts as not saved, and nothing is thrown out', async () => {
    const readSecret = vi.fn(async (name: string) => {
      if (name === 'groq_api_key') throw new Error('vault down');
      return null;
    });
    const { ports: p, fetchMock } = ports({ readSecret });
    const result = await askBrains(INPUT, p);
    expect(result).toMatchObject({ ok: false, reason: 'none_saved', tried: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a saved Cloudflare token without its account ID is skipped', async () => {
    const { ports: p, fetchMock } = ports({ saved: { cloudflare_api_token: FAKE.cloudflare } });
    const result = await askBrains(INPUT, p);
    expect(result).toMatchObject({ ok: false, reason: 'none_saved' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the first brain that answers wins', () => {
  it('Gemini rate limited, then Groq answers: Groq replies, and Gemini was tried first', async () => {
    const fetchMock = fakeFetch({});
    const { ports: p, askGemini } = ports({
      saved: { gemini_api_key: FAKE.gemini, groq_api_key: FAKE.groq },
      fetch: fetchMock,
      gemini: async () => ({ ok: false, outcome: 'rate_limited' }),
    });
    const result = await askBrains(INPUT, p);
    expect(result).toEqual({ ok: true, brain: 'groq', label: 'Groq', model: 'openai/gpt-oss-120b', text: `ok from ${HOST.groq}`, tried: ['gemini', 'groq'] });
    expect(askGemini).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Gemini answers: no other brain is called', async () => {
    const fetchMock = fakeFetch({});
    const { ports: p } = ports({ saved: { gemini_api_key: FAKE.gemini, groq_api_key: FAKE.groq }, fetch: fetchMock });
    const result = await askBrains(INPUT, p);
    expect(result).toMatchObject({ ok: true, brain: 'gemini', tried: ['gemini'] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Groq rate limited (429), then NVIDIA answers: NVIDIA replies', async () => {
    const fetchMock = fakeFetch({ [HOST.groq]: { status: 429 } });
    const { ports: p } = ports({ saved: { groq_api_key: FAKE.groq, nvidia_api_key: FAKE.nvidia }, fetch: fetchMock });
    const result = await askBrains(INPUT, p);
    expect(result).toMatchObject({ ok: true, brain: 'nvidia', tried: ['groq', 'nvidia'] });
  });

  it('a blank Groq key is skipped, and NVIDIA is the first brain called', async () => {
    const fetchMock = fakeFetch({});
    const { ports: p } = ports({ saved: { groq_api_key: ' ', nvidia_api_key: FAKE.nvidia }, fetch: fetchMock });
    const result = await askBrains(INPUT, p);
    expect(result).toMatchObject({ ok: true, brain: 'nvidia', tried: ['nvidia'] });
    expect(fetchMock.mock.calls.map((call) => new URL(String(call[0])).host)).toEqual([HOST.nvidia]);
  });

  it('the Cloudflare brain uses its account ID in the address, and answers', async () => {
    const fetchMock = fakeFetch({});
    const { ports: p } = ports({ saved: { cloudflare_api_token: FAKE.cloudflare, cloudflare_account_id: ACCOUNT }, fetch: fetchMock });
    const result = await askBrains(INPUT, p);
    expect(result).toMatchObject({ ok: true, brain: 'cloudflare' });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`https://${HOST.cloudflare}/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`);
  });
});

describe('each failure moves to the next brain, and no brain is retried', () => {
  it('a 401 (rejected key), a 500 and a network error each move on', async () => {
    const fetchMock = fakeFetch({
      [HOST.groq]: { status: 401 },
      [HOST.nvidia]: { status: 500 },
      [HOST.cloudflare]: 'throw',
    });
    const { ports: p } = ports({ saved: { ...EVERY_KEY }, fetch: fetchMock, gemini: async () => ({ ok: false, outcome: 'unavailable' }) });
    const result = await askBrains(INPUT, p);
    expect(result).toMatchObject({ ok: true, brain: 'openrouter' });
    const hosts = fetchMock.mock.calls.map((call) => new URL(String(call[0])).host);
    expect(hosts).toEqual([HOST.groq, HOST.nvidia, 'api.cloudflare.com', HOST.openrouter]);
  });

  it('a reply with no text is an empty outcome, and the next brain answers', async () => {
    const fetchMock = fakeFetch({ [HOST.groq]: { status: 200, body: { choices: [{ message: { content: '' } }] } } });
    const { ports: p } = ports({ saved: { groq_api_key: FAKE.groq, nvidia_api_key: FAKE.nvidia }, fetch: fetchMock });
    const result = await askBrains(INPUT, p);
    expect(result).toMatchObject({ ok: true, brain: 'nvidia', tried: ['groq', 'nvidia'] });
  });

  it('a reply that is not JSON is unavailable, and the next brain answers', async () => {
    const fetchMock = fakeFetch({ [HOST.groq]: { status: 200, raw: 'not json at all' } });
    const { ports: p } = ports({ saved: { groq_api_key: FAKE.groq, nvidia_api_key: FAKE.nvidia }, fetch: fetchMock });
    const result = await askBrains(INPUT, p);
    expect(result).toMatchObject({ ok: true, brain: 'nvidia' });
  });

  it('a brain that hangs past the 15 second limit is abandoned, and the next brain answers', async () => {
    vi.useFakeTimers();
    const fetchMock = fakeFetch({ [HOST.groq]: 'hang' });
    const { ports: p } = ports({ saved: { groq_api_key: FAKE.groq, nvidia_api_key: FAKE.nvidia }, fetch: fetchMock });
    const pending = askBrains(INPUT, p);
    await vi.advanceTimersByTimeAsync(BRAIN_TIMEOUT_MS + 10);
    const result = await pending;
    expect(BRAIN_TIMEOUT_MS).toBe(15_000);
    expect(result).toMatchObject({ ok: true, brain: 'nvidia', tried: ['groq', 'nvidia'] });
  });

  it('the same brain is called at most once, even when every brain fails', async () => {
    const fetchMock = fakeFetch({
      [HOST.groq]: { status: 500 },
      [HOST.nvidia]: { status: 429 },
      [HOST.cloudflare]: { status: 503 },
      [HOST.openrouter]: { status: 404 },
      [HOST.huggingface]: { status: 200, raw: '' },
    });
    const { ports: p } = ports({ saved: { ...EVERY_KEY }, fetch: fetchMock, gemini: async () => ({ ok: false, outcome: 'rate_limited' }) });
    await askBrains(INPUT, p);
    const hosts = fetchMock.mock.calls.map((call) => new URL(String(call[0])).host);
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(hosts).toEqual([HOST.groq, HOST.nvidia, 'api.cloudflare.com', HOST.openrouter, HOST.huggingface]);
  });
});

describe('every brain fails: one honest line, no crash, no key in it', () => {
  it('all saved brains fail: all_failed, the six free brains tried in order, and the line is plain', async () => {
    const fetchMock = fakeFetch({
      [HOST.groq]: { status: 500 },
      [HOST.nvidia]: 'throw',
      [HOST.cloudflare]: { status: 429 },
      [HOST.openrouter]: { status: 401 },
      [HOST.huggingface]: { status: 200, raw: '' },
    });
    const { ports: p } = ports({ saved: { ...EVERY_KEY }, fetch: fetchMock, gemini: async () => ({ ok: false, outcome: 'rate_limited' }) });
    const result = await askBrains(INPUT, p);
    expect(result).toEqual({
      ok: false,
      reason: 'all_failed',
      line: ALL_FAILED_LINE,
      tried: ['gemini', 'groq', 'nvidia', 'cloudflare', 'openrouter', 'huggingface'],
      lastOutcome: 'unavailable',
    });
    expect(ALL_FAILED_LINE).toBe('Buddy could not reach any of its brains just now. Nothing was changed. Try again in a few minutes.');
  });

  it('the skipped brains (Cerebras and DeepSeek) are never called, even with a key saved', async () => {
    const fetchMock = fakeFetch({});
    const { ports: p } = ports({ saved: { ...EVERY_KEY }, fetch: fetchMock, gemini: async () => ({ ok: false, outcome: 'unavailable' }) });
    await askBrains(INPUT, p);
    const hosts = fetchMock.mock.calls.map((call) => new URL(String(call[0])).host);
    expect(hosts).not.toContain(HOST.cerebras);
    expect(hosts).not.toContain(HOST.deepseek);
  });

  it('no key value appears in the answer, in the line, or in what the fake provider was sent back', async () => {
    const fetchMock = fakeFetch({ [HOST.groq]: { status: 500, raw: 'provider says no' } });
    const { ports: p } = ports({ saved: { groq_api_key: FAKE.groq }, fetch: fetchMock });
    const result = await askBrains(INPUT, p);
    const text = JSON.stringify(result);
    for (const key of Object.values(FAKE)) expect(text).not.toContain(key);
    expect(text).not.toContain(ACCOUNT);
  });
});

describe('what the brains are sent', () => {
  it('a Bearer header carries the key, the model is the catalogue model, and roles map to user and assistant', async () => {
    const fetchMock = fakeFetch({});
    const { ports: p } = ports({ saved: { groq_api_key: FAKE.groq }, fetch: fetchMock });
    await askBrains(INPUT, p);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://${HOST.groq}/openai/v1/chat/completions`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE.groq}`);
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(BRAIN_SLOTS.find((slot) => slot.id === 'groq')!.model);
    expect(body.messages[0]).toEqual({ role: 'system', content: INPUT.system });
    expect(body.messages.slice(1).map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(init.redirect).toBe('error');
  });

  it('the reply is capped to the reply limit', async () => {
    const long = 'a'.repeat(BRAIN_MAX_REPLY_CHARS + 500);
    const fetchMock = fakeFetch({ [HOST.groq]: { status: 200, body: OK_BODY(long) } });
    const { ports: p } = ports({ saved: { groq_api_key: FAKE.groq }, fetch: fetchMock });
    const result = await askBrains(INPUT, p);
    expect(result.ok && result.text.length).toBe(BRAIN_MAX_REPLY_CHARS);
  });

  it('the Gemini slot model is the one Buddy already uses', () => {
    expect(BRAIN_SLOTS[0].model).toBe(BUDDY_GEMINI_MODEL);
  });
});

describe('accept option: a reply that is not the shape asked for moves on', () => {
  it('an unreadable Gemini reply is skipped and the next saved brain answers', async () => {
    const fetchMock = fakeFetch({ [HOST.groq]: { status: 200, body: OK_BODY('{"reply":"ok"}') } });
    const { ports: p, askGemini } = ports({ saved: { gemini_api_key: 'FAKE-GOOGLE-KEY-PHASE-A', groq_api_key: 'FAKE-GROQ-KEY-PHASE-A' }, fetch: fetchMock, gemini: async () => ({ ok: true, text: '{"reply":' }) });
    const accept = (text: string) => text.endsWith('}');
    const result = await askBrains(INPUT, p, { accept });
    expect(askGemini).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, brain: 'groq', tried: ['gemini', 'groq'] });
  });

  it('when every reply is unreadable, lastOutcome says so', async () => {
    const { ports: p } = ports({ saved: { gemini_api_key: 'FAKE-GOOGLE-KEY-PHASE-A' }, gemini: async () => ({ ok: true, text: 'not json' }) });
    const result = await askBrains(INPUT, p, { accept: () => false });
    expect(result).toMatchObject({ ok: false, reason: 'all_failed', lastOutcome: 'unreadable', tried: ['gemini'] });
  });
});

describe('anyBrainSaved and the log line', () => {
  it('anyBrainSaved is false with no key, true with any one key, and never calls a brain', async () => {
    const fetchMock = fakeFetch({});
    expect(await anyBrainSaved(ports({ saved: {}, fetch: fetchMock }).ports)).toBe(false);
    expect(await anyBrainSaved(ports({ saved: { groq_api_key: 'FAKE-GROQ-KEY-PHASE-A' }, fetch: fetchMock }).ports)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the log line names the brain that answered and the brains that failed first, never a key', async () => {
    const fetchMock = fakeFetch({ [HOST.groq]: { status: 200, body: OK_BODY('ok') } });
    const { ports: p } = ports({ saved: { gemini_api_key: 'FAKE-GOOGLE-KEY-PHASE-A', groq_api_key: 'FAKE-GROQ-KEY-PHASE-A' }, fetch: fetchMock, gemini: async () => ({ ok: false, outcome: 'rate_limited' }) });
    const result = await askBrains(INPUT, p);
    if (!result.ok) throw new Error('expected an answer');
    const line = brainAnswerLine(result);
    expect(line).toBe('Groq answered after Google Gemini did not.');
    expect(line).not.toContain('FAKE-');
    expect(brainAnswerLine({ ok: true, brain: 'gemini', label: 'Google Gemini', model: 'gemini-3.8-flash', text: 'x', tried: ['gemini'] })).toBe('Google Gemini answered.');
  });
});
