// @vitest-environment node
// Phase A slice 1: the eight brains are catalogued in order, with Vault names, and nothing is applied.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAIN_IDS, BRAIN_SLOTS, brainSecretNames, tryableBrains } from '../../supabase/functions/_shared/brains';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const MIGRATION = 'supabase/migrations/20261017000000_buddy_brain_slots.sql';
const SECRET_NAME = /^[a-z][a-z0-9_]{1,63}$/;
// Owner-facing copy must avoid these words.
const FORBIDDEN = /autonomy|control tower|orchestration|\bRPC\b|payload|dispatch|daily kit|adapter|failover|\brouter\b/i;

describe('the eight brains, in try order', () => {
  it('lists exactly the eight brains, Gemini first', () => {
    expect(BRAIN_IDS).toEqual(['gemini', 'groq', 'nvidia', 'cloudflare', 'openrouter', 'cerebras', 'huggingface', 'deepseek']);
    expect(BRAIN_IDS[0]).toBe('gemini');
    expect(BRAIN_SLOTS.map((slot) => slot.id)).toEqual([...BRAIN_IDS]);
  });

  it('the order numbers run 1 to 8 with no gaps', () => {
    expect(BRAIN_SLOTS.map((slot) => slot.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('GitHub Models, Bytez and Mistral are not brains', () => {
    const everything = JSON.stringify(BRAIN_SLOTS).toLowerCase();
    expect(everything).not.toContain('github');
    expect(everything).not.toContain('bytez');
    expect(everything).not.toContain('mistral');
  });

  it('Cerebras and DeepSeek keep their slots but are marked skip, and the rest may be tried', () => {
    const skipped = BRAIN_SLOTS.filter((slot) => slot.access === 'skip').map((slot) => slot.id);
    expect(skipped).toEqual(['cerebras', 'deepseek']);
    expect(tryableBrains().map((slot) => slot.id)).toEqual(['gemini', 'groq', 'nvidia', 'cloudflare', 'openrouter', 'huggingface']);
  });

  it('every brain other than Gemini has an OpenAI-style https base URL; Gemini keeps its own path', () => {
    for (const slot of BRAIN_SLOTS) {
      if (slot.id === 'gemini') {
        expect(slot.baseUrl).toBeNull();
      } else {
        expect(slot.baseUrl, slot.id).toMatch(/^https:\/\//);
      }
    }
  });
});

describe('the Vault names for the brains', () => {
  it('every name is a valid catalogue name, and no name is used twice', () => {
    const names = brainSecretNames();
    for (const name of names) expect(name).toMatch(SECRET_NAME);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every name except Gemini (already in the catalogue) is added by the new migration', () => {
    const sql = read(MIGRATION);
    for (const name of brainSecretNames()) {
      if (name === 'gemini_api_key') continue;
      expect(sql, name).toContain(`'${name}'`);
    }
  });

  it('Gemini keeps its existing catalogue row and is not added again', () => {
    expect(read(MIGRATION)).not.toContain("'gemini_api_key'");
    expect(read('supabase/migrations/20261005090000_automation_foundation.sql')).toContain("'gemini_api_key'");
  });
});

describe('the migration is additive, holds no secret values, and is not applied', () => {
  it('says it is not applied to production', () => {
    expect(read(MIGRATION)).toMatch(/NOT applied to production/);
  });

  it('only adds catalogue rows, with an upsert, and never touches the secret table', () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/INSERT INTO public\.automation_secret_catalog/);
    expect(sql).toMatch(/ON CONFLICT \(secret_name\) DO UPDATE/);
    expect(sql).not.toMatch(/automation_secrets\b/);
    expect(sql).not.toMatch(/vault\./);
  });

  it('contains no key-shaped value', () => {
    const sql = read(MIGRATION);
    expect(sql).not.toMatch(/\bgsk_[A-Za-z0-9]/);
    expect(sql).not.toMatch(/\bnvapi-[A-Za-z0-9]/);
    expect(sql).not.toMatch(/\bsk-[A-Za-z0-9]/);
    expect(sql).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
  });
});

describe('owner copy on the brains is plain', () => {
  it('no forbidden owner word and no Nigeria, Naira or Lagos in any label, purpose or access note', () => {
    for (const slot of BRAIN_SLOTS) {
      const copy = `${slot.label} ${slot.purpose} ${slot.accessNote}`;
      expect(copy, slot.id).not.toMatch(FORBIDDEN);
      expect(copy, slot.id).not.toMatch(/Nigeria|Naira|Lagos/i);
      expect(copy, slot.id).not.toMatch(/—/);
    }
  });

  it('the migration copy has no forbidden owner word and no city', () => {
    expect(read(MIGRATION)).not.toMatch(/Nigeria|Naira|Lagos/i);
    expect(read(MIGRATION)).not.toMatch(FORBIDDEN);
  });
});
