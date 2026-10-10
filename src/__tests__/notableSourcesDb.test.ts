// @vitest-environment node
// The source-key migration on the notable events table, in an in-process Postgres (PGlite).
// Runs the real migrations in order, with the same small stand-ins for auth and the admin helpers that the door tests use.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS = [
  '20261009140000_minds_controls.sql',
  '20261009170000_minds_notable_events.sql',
  '20261011210000_notable_push.sql',
  '20261012000000_notable_sources.sql',
];

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const STAND_INS = `
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.app_admins (user_id uuid primary key, role text not null);
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid())
$$;
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' from public.app_admins where user_id = auth.uid()), false)
$$;
create or replace function public.is_founder() returns boolean language sql stable as $$ select false $$;
grant execute on function public.is_admin(), public.is_owner(), public.is_founder() to anon, authenticated;
insert into auth.users (id) values ('${OWNER}'), ('${OTHER}');
insert into public.app_admins (user_id, role) values ('${OWNER}', 'owner'), ('${OTHER}', 'owner');
`;

let db: PGlite;

async function insertEvent(owner: string, sourceKey: string | null, title = 'Paid order: USD 29.00.') {
  await db.query(
    `insert into public.minds_notable_events (owner_id, mind, kind, title, source_key) values ($1, 'buddy', 'sale', $2, $3)`,
    [owner, title, sourceKey],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STAND_INS);
  for (const file of MIGRATIONS) {
    await db.exec(readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8'));
  }
});

afterAll(async () => {
  await db.close();
});

describe('the source key: one row per owner per key', () => {
  it('a second row with the same key for the same owner is refused', async () => {
    await insertEvent(OWNER, 'sale:ord-1');
    await expect(insertEvent(OWNER, 'sale:ord-1')).rejects.toThrow(/duplicate key|unique/i);
    const rows = await db.query<{ n: number }>(`select count(*)::int as n from public.minds_notable_events where source_key = 'sale:ord-1'`);
    expect(rows.rows[0].n).toBe(1);
  });

  it('the same key is allowed for a different owner, because the key is per owner', async () => {
    await insertEvent(OTHER, 'sale:ord-1');
    const rows = await db.query<{ n: number }>(`select count(*)::int as n from public.minds_notable_events where source_key = 'sale:ord-1'`);
    expect(rows.rows[0].n).toBe(2);
  });

  it('rows with no key are not limited, so the existing events keep working', async () => {
    await insertEvent(OWNER, null, 'Takeover was turned on.');
    await insertEvent(OWNER, null, 'Takeover was turned on.');
    const rows = await db.query<{ n: number }>(`select count(*)::int as n from public.minds_notable_events where owner_id = '${OWNER}' and source_key is null`);
    expect(rows.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('a key longer than 200 characters is refused, and a blank key is refused', async () => {
    await expect(insertEvent(OWNER, 'x'.repeat(201))).rejects.toThrow(/check|constraint/i);
    await expect(insertEvent(OWNER, '')).rejects.toThrow(/check|constraint/i);
  });
});
