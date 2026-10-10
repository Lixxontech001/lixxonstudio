// @vitest-environment node
// Phase A freeze: the promises of the eight-brains phase, checked with the real functions and real source text.
// Fake HTTP and fake Vault only. No live provider is called.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BRAIN_SLOTS, tryableBrains } from '../../supabase/functions/_shared/brains';
import {
  ALL_FAILED_LINE,
  BRAIN_TIMEOUT_MS,
  NONE_SAVED_LINE,
  askBrains,
} from '../../supabase/functions/_shared/brainChain';
import { BUDDY_SYSTEM_INSTRUCTION } from '../../supabase/functions/_shared/buddyThink';
import { MINDS_CONTROLS_DEFAULTS } from '../buddy/minds/mindsControlsStore';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

const OK = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const ANSWER = '{"reply":"Answered by the next brain.","order":null}';
const INPUT = { system: 'system', turns: [{ role: 'user' as const, text: 'hello' }], json: true };

function vault(saved: Record<string, string>) {
  return async (name: string) => (Object.prototype.hasOwnProperty.call(saved, name) ? saved[name] : null);
}

describe('the brains: order, set, and what is left out', () => {
  it('the try order is Gemini, Groq, NVIDIA, Cloudflare, OpenRouter, Cerebras, Hugging Face, DeepSeek', () => {
    expect(BRAIN_SLOTS.map((slot) => slot.id)).toEqual(['gemini', 'groq', 'nvidia', 'cloudflare', 'openrouter', 'cerebras', 'huggingface', 'deepseek']);
  });

  it('Buddy tries only the free brains, in that order; Cerebras and DeepSeek are skipped', () => {
    expect(tryableBrains().map((slot) => slot.id)).toEqual(['gemini', 'groq', 'nvidia', 'cloudflare', 'openrouter', 'huggingface']);
  });

  it('GitHub Models, Bytez and Mistral are not brains: no slot, label, key name or base URL mentions them', () => {
    const text = JSON.stringify(BRAIN_SLOTS);
    expect(text).not.toMatch(/github|bytez|mistral/i);
  });

  it('the whole chain waits at most 15 seconds per brain (the cap is 20)', () => {
    expect(BRAIN_TIMEOUT_MS).toBe(15_000);
    expect(BRAIN_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});

describe('a rate-limited brain falls to the next one', () => {
  it('429 from Gemini: the next saved key (Groq) answers, and Gemini was tried once', async () => {
    const gemini = vi.fn(async () => ({ ok: false as const, outcome: 'rate_limited' as const }));
    const fetchImpl = vi.fn(async () => OK(ANSWER));
    const result = await askBrains(INPUT, {
      readSecret: vault({ gemini_api_key: 'FAKE-GOOGLE-PHASE-A-FREEZE', groq_api_key: 'FAKE-GROQ-PHASE-A-FREEZE' }),
      askGemini: gemini,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: true, brain: 'groq', tried: ['gemini', 'groq'] });
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it('a dead key is not retried: a 429 from Groq is called once and the chain moves to NVIDIA', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const host = new URL(String(url)).host;
      return host === 'api.groq.com' ? new Response('', { status: 429 }) : OK(ANSWER);
    });
    const result = await askBrains(INPUT, {
      readSecret: vault({ groq_api_key: 'FAKE-GROQ-PHASE-A-FREEZE', nvidia_api_key: 'FAKE-NVIDIA-PHASE-A-FREEZE' }),
      askGemini: vi.fn(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: true, brain: 'nvidia', tried: ['groq', 'nvidia'] });
    const groqCalls = fetchImpl.mock.calls.filter((call) => new URL(String(call[0])).host === 'api.groq.com');
    expect(groqCalls).toHaveLength(1);
  });
});

describe('the honest lines', () => {
  it('no brain saved: one plain line, nothing called', async () => {
    const fetchImpl = vi.fn();
    const askGemini = vi.fn();
    const result = await askBrains(INPUT, { readSecret: vault({}), askGemini, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, reason: 'none_saved', line: NONE_SAVED_LINE });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(askGemini).not.toHaveBeenCalled();
  });

  it('every saved brain fails: one plain line, no stack trace, no key in it', async () => {
    const keys = { gemini_api_key: 'FAKE-GOOGLE-PHASE-A-FREEZE', groq_api_key: 'FAKE-GROQ-PHASE-A-FREEZE' };
    const result = await askBrains(INPUT, {
      readSecret: vault(keys),
      askGemini: async () => ({ ok: false, outcome: 'unavailable' }),
      fetchImpl: (async () => new Response('', { status: 500 })) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: false, reason: 'all_failed', line: ALL_FAILED_LINE });
    const everything = JSON.stringify(result);
    expect(everything).not.toContain('FAKE-');
    expect(everything).not.toMatch(/at .*\.ts:\d+/);
    expect(ALL_FAILED_LINE).not.toMatch(/\n/);
  });
});

describe('the two lies stay gone, and Takeover stays off', () => {
  it('Buddy\'s system text does not say it can never change the site', () => {
    expect(BUDDY_SYSTEM_INSTRUCTION).not.toMatch(/can never change the site|cannot change it/i);
  });

  it('the Minds screen does not say "no change reaches the site yet"', () => {
    expect(read('src/admin/pages/AdminMinds.tsx')).not.toContain('no change reaches the site yet');
  });

  it('Takeover is off by default, in the app and in the database', () => {
    expect(MINDS_CONTROLS_DEFAULTS.takeover).toBe(false);
    expect(read('supabase/migrations/20261009140000_minds_controls.sql')).toMatch(/takeover boolean NOT NULL DEFAULT false/);
  });
});

describe('no merge, no deploy, no production migration', () => {
  it('the Phase A migration is additive: it creates or inserts only, and changes no existing table or key', () => {
    const phaseA = readdirSync(path.join(process.cwd(), 'supabase', 'migrations')).filter((name) => name.endsWith('20261017000000_buddy_brain_slots.sql'));
    expect(phaseA).toHaveLength(1);
    const sql = read(`supabase/migrations/${phaseA[0]}`);
    expect(sql).not.toMatch(/\bDROP\b|\bALTER TABLE\b|\bTRUNCATE\b|\bDELETE FROM\b/i);
    expect(sql).toMatch(/INSERT INTO public\.automation_secret_catalog|ON CONFLICT/i);
  });

  it('reader-facing folders (src/pages, src/components) have no Nigeria, Naira or Lagos', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const dir of ['src/pages', 'src/components']) {
      const full = path.join(process.cwd(), dir);
      let names: string[] = [];
      try {
        names = readdirSync(full, { recursive: true }) as string[];
      } catch {
        names = [];
      }
      for (const name of names) {
        if (!/\.(tsx|ts)$/.test(name) || name.includes('__tests__')) continue;
        scanned += 1;
        if (/nigeria|naira|lagos/i.test(readFileSync(path.join(full, name), 'utf8'))) offenders.push(`${dir}/${name}`);
      }
    }
    expect(scanned).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});
