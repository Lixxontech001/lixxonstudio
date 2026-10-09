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
    const think = makeMindThink(async () => KEY, fetchSpy as unknown as typeof fetch);
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
    const rejected = makeMindThink(async () => KEY, (async () => new Response('', { status: 403 })) as unknown as typeof fetch);
    expect(await rejected({ mind: 'ceo', system: 's', prompt: 'p' })).toEqual({ ok: false, reason: 'rejected' });
    const busy = makeMindThink(async () => KEY, (async () => new Response('', { status: 429 })) as unknown as typeof fetch);
    expect(await busy({ mind: 'ceo', system: 's', prompt: 'p' })).toEqual({ ok: false, reason: 'rate_limited' });
  });
});
