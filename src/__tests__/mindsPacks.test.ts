import { describe, expect, it } from 'vitest';
import packsSql from '../../supabase/migrations/20261010100000_minds_packs.sql?raw';
import {
  CAPTION_MAX,
  PACK_CHANNELS,
  PACK_PRODUCT_CAP,
  PIN_DESCRIPTION_MAX,
  PIN_TITLE_MAX,
  copyProblem,
  isPackChannel,
  productProblem,
} from '../../supabase/functions/_shared/packRules';

describe('packs: exactly the four gated channels', () => {
  it('lists instagram, tiktok, facebook and pinterest, and nothing else', () => {
    expect([...PACK_CHANNELS]).toEqual(['instagram', 'tiktok', 'facebook', 'pinterest']);
  });

  it('rejects YouTube, WhatsApp and any other name', () => {
    for (const name of ['youtube', 'whatsapp', 'x', 'email', '']) expect(isPackChannel(name)).toBe(false);
    expect(isPackChannel('pinterest')).toBe(true);
  });

  it('the database allows the same four channels', () => {
    const match = packsSql.match(/channel IN \(([^)]*)\)/);
    expect(match).not.toBeNull();
    const listed = match![1].split(',').map((item) => item.trim().replace(/'/g, ''));
    expect(listed).toEqual([...PACK_CHANNELS]);
    expect(packsSql).toMatch(/p_channel NOT IN \('instagram', 'tiktok', 'facebook', 'pinterest'\)/);
  });
});

describe('packs: at most 3 products', () => {
  it('the cap is 3, and the database enforces the same number', () => {
    expect(PACK_PRODUCT_CAP).toBe(3);
    expect(packsSql).toContain('cardinality(product_ids) <= 3');
    expect(packsSql).toContain('COALESCE(cardinality(p_product_ids), 0) > 3');
  });

  it('three distinct products are fine; a fourth or a repeat is refused', () => {
    expect(productProblem(['a', 'b', 'c'])).toBeNull();
    expect(productProblem(['a', 'b', 'c', 'd'])).toBe('at most 3 products on a pack');
    expect(productProblem(['a', 'a'])).toBe('repeated_product');
    expect(productProblem([])).toBeNull();
  });
});

describe('packs: copy limits and the copy rule', () => {
  it('the length limits match the database', () => {
    expect(packsSql).toContain(`char_length(caption) BETWEEN 1 AND ${CAPTION_MAX}`);
    expect(packsSql).toContain(`char_length(pin_title) BETWEEN 1 AND ${PIN_TITLE_MAX}`);
    expect(packsSql).toContain(`char_length(pin_description) BETWEEN 1 AND ${PIN_DESCRIPTION_MAX}`);
  });

  it('a clean caption passes', () => {
    expect(copyProblem('A calm routine for dry skin, with the guide that keeps the steps in order.')).toBeNull();
    expect(copyProblem(null)).toBeNull();
  });

  it('country names, the local clock, non-USD money and dashes are refused', () => {
    for (const bad of [
      'Made in Nigeria',
      'Lagos morning routine',
      'Naira prices',
      'Abuja event',
      'Posted at 9 WAT',
      'Costs 9 GBP',
      'Costs 9 EUR',
      'A calm routine \u2014 for you',
      'A calm routine \u2013 for you',
      'It costs \u00a39',
      'It costs \u20ac9',
      'It costs \u20a68000',
    ]) {
      expect(copyProblem(bad), bad).toBe('copy_not_clean');
    }
  });

  it('the database uses the same copy rule', () => {
    expect(packsSql).toContain('minds_copy_is_clean');
    expect(packsSql).toMatch(/nigeria\|nigerian\|lagos\|abuja\|naira/);
    expect(packsSql).toContain('chr(8212) || chr(8211)');
  });

  it('the migration file itself is plain ASCII', () => {
    expect([...packsSql].every((character) => character.charCodeAt(0) < 128)).toBe(true);
  });
});

describe('packs: owner-only and unapplied', () => {
  it('reads are owner-only; nothing is open to anon or the public', () => {
    expect(packsSql).toContain('USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()))');
    expect(packsSql).toMatch(/REVOKE ALL ON public\.minds_packs FROM PUBLIC, anon;/);
    expect(packsSql).not.toMatch(/GRANT [^;]*\bTO (anon|public)\b/i);
    expect(packsSql).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/i);
  });

  it('the one write door is service role only', () => {
    expect(packsSql).toContain('GRANT EXECUTE ON FUNCTION public.minds_save_pack');
    expect(packsSql).toMatch(/FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE[^;]*TO service_role/);
  });

  it('a posted pack is never overwritten by a new save', () => {
    expect(packsSql).toContain("WHERE public.minds_packs.status <> 'posted_by_owner'");
    expect(packsSql).toContain("p_status NOT IN ('ready', 'blocked')");
  });
});
