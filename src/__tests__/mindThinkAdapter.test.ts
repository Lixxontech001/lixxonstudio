import { describe, expect, it, vi } from 'vitest';
import { makeMindThink } from '../../supabase/functions/_shared/mindThink';
import { BUDDY_GEMINI_MODEL } from '../../supabase/functions/_shared/buddyThink';

const KEY = 'test-key-not-real-0001';

function okResponse(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('the minds think through the existing key path', () => {
  it('makes no call at all without a key, and says so', async () => {
    const fetchSpy = vi.fn(async () => okResponse('should not happen'));
    const think = makeMindThink(async () => null, fetchSpy as unknown as typeof fetch);
    const result = await think({ mind: 'analyst', system: 'rules', prompt: 'facts' });
    expect(result).toEqual({ ok: false, reason: 'no_key' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('makes exactly one Gemini call, on the Buddy model, with the key only in the header', async () => {
    const fetchSpy = vi.fn(async () => okResponse('{"summary":"Steady.","proposals":[]}'));
    const think = makeMindThink(async (name) => (name === 'gemini_api_key' ? KEY : null), fetchSpy as unknown as typeof fetch);
    const result = await think({ mind: 'strategist', system: 'rules', prompt: 'facts' });
    expect(result).toEqual({ ok: true, text: '{"summary":"Steady.","proposals":[]}' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/models/${BUDDY_GEMINI_MODEL}:generateContent`);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(String(init.body)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('reports a rejected key as rejected, and a busy Google as rate_limited', async () => {
    const rejected = makeMindThink(async (name) => (name === 'gemini_api_key' ? KEY : null), (async () => new Response('', { status: 403 })) as unknown as typeof fetch);
    expect(await rejected({ mind: 'ceo', system: 's', prompt: 'p' })).toEqual({ ok: false, reason: 'rejected' });
    const busy = makeMindThink(async (name) => (name === 'gemini_api_key' ? KEY : null), (async () => new Response('', { status: 429 })) as unknown as typeof fetch);
    expect(await busy({ mind: 'ceo', system: 's', prompt: 'p' })).toEqual({ ok: false, reason: 'rate_limited' });
  });
});

describe('the minds walk the brain chain, like Buddy', () => {
  const GROQ_KEY = 'test-groq-key-not-real-0002';
  const groqOk = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Steady.","proposals":[]}' } }] }), { status: 200 });

  it('with only a Groq key saved, the mind is answered by Groq', async () => {
    const fetchSpy = vi.fn(async () => groqOk());
    const think = makeMindThink(async (name) => (name === 'groq_api_key' ? GROQ_KEY : null), fetchSpy as unknown as typeof fetch);
    const result = await think({ mind: 'analyst', system: 'rules', prompt: 'facts' });
    expect(result).toEqual({ ok: true, text: '{"summary":"Steady.","proposals":[]}' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown as [string])[0])).toContain('api.groq.com');
  });

  it('Gemini rate limited and Groq saved: the mind moves to Groq and gets its answer', async () => {
    const fetchSpy = vi.fn(async () => groqOk());
    const geminiLimited = vi.fn(async () => new Response('', { status: 429 }));
    const think = makeMindThink(
      async (name) => (name === 'gemini_api_key' ? KEY : name === 'groq_api_key' ? GROQ_KEY : null),
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        return url.includes('generativelanguage') ? geminiLimited(url, init) : fetchSpy(url, init);
      }) as unknown as typeof fetch,
    );
    const result = await think({ mind: 'strategist', system: 'rules', prompt: 'facts' });
    expect(result.ok).toBe(true);
    expect(geminiLimited).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('every saved brain failing gives the failure the minds can name, and no key text', async () => {
    const failing = vi.fn(async () => new Response('', { status: 503 }));
    const think = makeMindThink(
      async (name) => (name === 'gemini_api_key' ? KEY : name === 'groq_api_key' ? GROQ_KEY : null),
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        return url.includes('generativelanguage')
          ? new Response('', { status: 503 })
          : failing(url, init);
      }) as unknown as typeof fetch,
    );
    const result = await think({ mind: 'ceo', system: 'rules', prompt: 'facts' });
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(GROQ_KEY);
  });
});
