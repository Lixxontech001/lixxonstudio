import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTE_PERMISSIONS, canAccess } from '../admin/permissions';
import type { AdminAccess } from '../context/AuthContext';

/**
 * The DB is the source of truth: `admin_permissions` in the M5 migration defines every
 * capability. These tests fail when the client invents a permission the database does not
 * know about (which would lock everybody out of that screen) or forgets to gate an
 * admin route.
 */
const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter(f => /^2026\d{10}_.*\.sql$/.test(f))
    .map(f => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');
}

function catalogueKeys(sql: string): Set<string> {
  const keys = new Set<string>();
  // ('content.read', 'View editorial content', …) rows inside the admin_permissions INSERT
  for (const m of sql.matchAll(/\('([a-z_]+(?:\.[a-z_]+)+)'/g)) keys.add(m[1]);
  return keys;
}

describe('admin RBAC map vs the database catalogue', () => {
  const sql = migrationSql();
  const known = catalogueKeys(sql);

  it('reads the capability catalogue out of the migration', () => {
    expect(known.size).toBeGreaterThanOrEqual(30);
    expect(known.has('data.sql')).toBe(true);
    expect(known.has('audit.revert')).toBe(true);
  });

  it('only gating with permissions the database defines', () => {
    const unknown = Object.entries(ROUTE_PERMISSIONS).filter(([, perm]) => !known.has(perm));
    expect(unknown).toEqual([]);
  });

  it('maps every admin screen to a capability (except login/2FA)', () => {
    const ungated = Object.keys(ROUTE_PERMISSIONS).filter(r => !r.startsWith('admin'));
    expect(ungated).toEqual([]);
    expect(ROUTE_PERMISSIONS['admin-team']).toBe('team.read');
    expect(ROUTE_PERMISSIONS['admin-access']).toBe('team.read');
    expect(ROUTE_PERMISSIONS['admin-data']).toBe('data.explore');
    expect(ROUTE_PERMISSIONS['admin-frontend']).toBe('settings.frontend');
    expect(ROUTE_PERMISSIONS['admin-health']).toBe('ops.health');
    expect(ROUTE_PERMISSIONS['admin-activity-log']).toBe('audit.read');
    expect(ROUTE_PERMISSIONS['admin-automation-keys']).toBe('automation.keys');
  });

  it('refuses a route when the permission is absent, and allows it when present', () => {
    const access = (permissions: string[], over: Partial<AdminAccess> = {}): AdminAccess => ({
      user_id: 'u', email: 'a@b.c', role: 'custom', role_label: 'Custom', display_name: null,
      status: 'active', is_founder: false, is_owner: false, mfa_enrolled: false, permissions, ...over,
    });
    expect(canAccess(access(['ops.health']), 'admin-health')).toBe(true);
    expect(canAccess(access(['ops.health']), 'admin-data')).toBe(false);
    expect(canAccess(access(['content.read']), 'admin-advisor')).toBe(false);
    expect(canAccess(access(['automation.keys']), 'admin-automation-keys')).toBe(false);
    expect(canAccess(access([], { is_owner: true }), 'admin-data')).toBe(true);
    expect(canAccess(access([], { is_founder: true }), 'admin-automation-keys')).toBe(true);
  });
});
