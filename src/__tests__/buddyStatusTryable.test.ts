import { describe, expect, it } from 'vitest';
import { anyTryableBrainConfigured, brainSecretNames, tryableBrains } from '../../supabase/functions/_shared/brains';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Phase D slice 3: Buddy's "configured" is true when ANY tryable brain has its Vault entries saved.
// It reads the saved flags only, never a key value. Gemini stays first in the chain.

const names = (...saved: string[]) => new Set(saved);

describe('Buddy status: any tryable brain', () => {
  it('the tryable chain is Gemini first, and Cerebras and DeepSeek are left out', () => {
    expect(tryableBrains().map((slot) => slot.id)).toEqual(['gemini', 'groq', 'nvidia', 'cloudflare', 'openrouter', 'huggingface']);
    expect(brainSecretNames()).toContain('cloudflare_account_id');
  });

  it('Gemini alone is enough', () => {
    expect(anyTryableBrainConfigured(names('gemini_api_key'))).toBe(true);
  });

  it('a later tryable brain alone is enough, so Gemini is not required', () => {
    for (const id of ['groq', 'nvidia', 'openrouter', 'huggingface']) {
      const slot = tryableBrains().find((item) => item.id === id)!;
      expect(anyTryableBrainConfigured(names(slot.secretName))).toBe(true);
    }
  });

  it('Cloudflare needs its account ID as well as the token, the same as the chain', () => {
    const token = tryableBrains().find((slot) => slot.id === 'cloudflare')!.secretName;
    expect(anyTryableBrainConfigured(names(token))).toBe(false);
    expect(anyTryableBrainConfigured(names(token, 'cloudflare_account_id'))).toBe(true);
  });

  it('Cerebras and DeepSeek keys alone do not count, because they are skipped', () => {
    const cerebras = brainSecretNames().filter((name) => /cerebras/i.test(name));
    const deepseek = brainSecretNames().filter((name) => /deepseek/i.test(name));
    expect(cerebras.length + deepseek.length).toBeGreaterThan(0);
    expect(anyTryableBrainConfigured(names(...cerebras, ...deepseek))).toBe(false);
  });

  it('nothing saved means not configured', () => {
    expect(anyTryableBrainConfigured(names())).toBe(false);
  });

  it('the status path reads the flags of every catalogue name, not only the Google key', () => {
    const source = readFileSync(resolve(__dirname, '../../supabase/functions/buddy-think/index.ts'), 'utf8');
    expect(source).toContain('anyTryableBrainConfigured(savedNames)');
    expect(source).not.toMatch(/find\(\(entry\) => entry\?\.name === KEY_NAME\)/);
    expect(source).toContain('const GOOGLE_KEY_NAME = "gemini_api_key";');
  });
});
