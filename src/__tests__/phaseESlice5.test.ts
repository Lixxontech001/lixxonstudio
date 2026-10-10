import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Phase E slice 5: the carts anonymous UPDATE fix (a new migration file, not applied), the dead costume (already gone
// in Phase C; checked here), and the pending push-note migration (added in slice 1; checked here).
// Source checks only. No database, no network.

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
const migrations = readdirSync(resolve(__dirname, '../../supabase/migrations'));

describe('the carts anonymous UPDATE fix is a new migration file, not applied', () => {
  const name = migrations.find((file) => file.endsWith('_abandoned_carts_no_anon_update.sql'));

  it('the file is new, timestamped after the Phase D migrations, and drops both old update policies', () => {
    expect(name).toBeTruthy();
    expect(name && name > '20261018000000').toBe(true);
    const sql = read(`supabase/migrations/${name}`);
    expect(sql).toMatch(/DROP POLICY IF EXISTS abandoned_carts_anon_update ON public\.abandoned_carts;/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "rl_ac_update" ON public\.abandoned_carts;/);
  });

  it('the file creates no policy on abandoned carts, so it never adds access', () => {
    const sql = read(`supabase/migrations/${name}`);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/GRANT/i);
  });

  it('the file says it is not applied to production', () => {
    expect(read(`supabase/migrations/${name}`)).toContain('NOT applied to production');
  });

  it('the storefront writes carts only through the definer function, not through an UPDATE on the table', () => {
    const platform = read('src/hooks/usePlatform.ts');
    expect(platform).toContain("rpc('upsert_abandoned_cart'");
    expect(platform).toContain("from('abandoned_carts').update({ recovered: true })");
    // That UPDATE is the owner's admin action; the admin policy covers it. The storefront does not update the table.
    expect(read('src/hooks/useCommerce.ts')).not.toMatch(/from\('abandoned_carts'\)\.update/);
  });

  it('no earlier migration was edited: the old policy names still appear only in their original files', () => {
    expect(read('supabase/migrations/20261003120000_security_hardening.sql')).toContain('CREATE POLICY abandoned_carts_anon_update');
    expect(read('supabase/migrations/20261004230000_security_hardening_v2.sql')).toContain('DROP POLICY IF EXISTS abandoned_carts_anon_update');
  });
});

describe('the dead costume is gone (checked, nothing to remove)', () => {
  it('the old Admin AI page and the retired Distribution page files are not in the source tree', () => {
    expect(existsSync(resolve(__dirname, '../admin/pages/AdminAI.tsx'))).toBe(false);
    expect(existsSync(resolve(__dirname, '../admin/pages/AutomationDistribution.tsx'))).toBe(false);
  });

  it('the old address still goes to Minds through the redirect, and no app screen opens the old page', () => {
    expect(read('src/admin/AdminApp.tsx')).toContain('RetiredDistributionRedirect');
    expect(read('src/admin/AdminApp.tsx')).not.toMatch(/import\('\.\/pages\/AutomationDistribution'\)/);
  });
});

describe('the pending push-note migration exists (added in slice 1, not applied)', () => {
  it('it adds the pending note and the claim time, and is not applied', () => {
    const name = migrations.find((file) => file.endsWith('_push_note_pending.sql'));
    expect(name).toBeTruthy();
    const sql = read(`supabase/migrations/${name}`);
    expect(sql).toContain("'pending'");
    expect(sql).toContain('push_claimed_at');
    expect(sql).toContain('NOT applied to production');
  });
});
