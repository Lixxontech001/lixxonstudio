// @vitest-environment node
// Runs the real Buddy migrations, the packs migration and the "I posted this" migration in an in-process Postgres (PGlite),
// with the same small stand-ins for auth, admin helpers, posts and products as the packs database test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS = [
  '20261009140000_minds_controls.sql',
  '20261009150000_buddy_orders.sql',
  '20261009160000_minds_daily_log.sql',
  '20261009170000_minds_notable_events.sql',
  '20261009190000_post_product_slots.sql',
  '20261009200000_post_product_edits.sql',
  '20261009210000_post_drip_days.sql',
  '20261009220000_minds_gap_notes.sql',
  '20261009230000_minds_apply_placement.sql',
  '20261010100000_minds_packs.sql',
  '20261010110000_minds_pack_posted.sql',
];

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const POST = 'bbbbbbbb-0000-4000-8000-000000000001';
const PRODUCT = 'cccccccc-0000-4000-8000-000000000001';

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

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text,
  status text not null default 'published'
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price text
);
grant select on public.posts, public.products to anon, authenticated;
insert into auth.users (id) values ('${OWNER}'), ('${STRANGER}');
insert into public.app_admins (user_id, role) values ('${OWNER}', 'owner');
`;

let db: PGlite;

/** Runs as the server (service role). Used for fixtures and for the one door that saves a pack. */
async function asServer<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  await db.exec('set role service_role');
  try {
    const result = await db.query<T>(sql, params);
    return result.rows;
  } finally {
    await db.exec('reset role');
  }
}

/** Runs as a signed-in user, the way the browser does. */
async function asUser(user: string): Promise<void> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.exec('set role authenticated');
}

async function asAnon(): Promise<void> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', '', false)", []);
  await db.exec('set role anon');
}

async function setSwitches(takeover: boolean, kill = 'none'): Promise<void> {
  await db.exec('reset role');
  await db.query('update public.minds_controls set takeover = $1, kill_scope = $2 where id = 1', [takeover, kill]);
}

/** A ready or blocked pack, written as the server would. Ready needs copy and an Auditor allow. */
async function insertPack(owner = OWNER, status: 'ready' | 'blocked' = 'ready', channel = 'instagram'): Promise<string> {
  const rows = await asServer<{ id: string }>(
    `insert into public.minds_packs
       (owner_id, channel, local_day, post_id, suggested_at_utc, suggested_label, caption, article_url, product_ids, status, blocked_reason, auditor_verdict)
     values ($1, $2, '2026-10-10', $3, '2026-10-10T13:00:00Z', 'Morning, US Eastern',
             $4, '/magazine/easy-skincare-routine-dry-skin', '{}', $5, $6, 'allow')
     returning id`,
    [
      owner,
      channel,
      POST,
      status === 'ready' ? 'A calm routine for dry skin, with the guide that keeps the steps in order.' : null,
      status,
      status === 'blocked' ? 'video not made yet' : null,
    ],
  );
  return rows[0].id;
}

async function packRow(id: string): Promise<{ status: string; posted_at: string | null }> {
  const rows = await asServer<{ status: string; posted_at: string | null }>(
    'select status, posted_at from public.minds_packs where id = $1',
    [id],
  );
  return rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STAND_INS);
  for (const file of MIGRATIONS) {
    try {
      await db.exec(readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8'));
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`);
    }
  }
  await db.exec('grant all on all tables in schema public to service_role');
});

beforeEach(async () => {
  await db.exec('reset role');
  await db.exec(`
    delete from public.minds_packs;
    delete from public.post_product_slots;
    delete from public.posts;
    delete from public.products;
    delete from public.app_admins;
    insert into public.app_admins (user_id, role) values ('${OWNER}', 'owner');
  `);
  await setSwitches(true, 'none');
  await db.query(`insert into public.posts (id, title, content) values ($1, 'Easy Skincare Routine for Dry Skin', 'Body text.')`, [POST]);
  await db.query(`insert into public.products (id, name) values ($1, 'Calm Skin Routine Guide')`, [PRODUCT]);
});

afterAll(async () => {
  await db.close();
});

describe('"I posted this": the owner marks his own ready pack, and nothing else', () => {
  it('the owner marks a ready pack posted: true, the status and the time are set', async () => {
    const id = await insertPack();
    await asUser(OWNER);
    const rows = await db.query<{ ok: boolean }>('select public.minds_mark_pack_posted($1::uuid) as ok', [id]);
    expect(rows.rows[0].ok).toBe(true);
    const after = await packRow(id);
    expect(after.status).toBe('posted_by_owner');
    expect(after.posted_at).not.toBeNull();
  });

  it('marking the same pack again does nothing and says false', async () => {
    const id = await insertPack();
    await asUser(OWNER);
    await db.query('select public.minds_mark_pack_posted($1::uuid)', [id]);
    const again = await db.query<{ ok: boolean }>('select public.minds_mark_pack_posted($1::uuid) as ok', [id]);
    expect(again.rows[0].ok).toBe(false);
    expect((await packRow(id)).status).toBe('posted_by_owner');
  });

  it('a blocked pack cannot be marked posted', async () => {
    const id = await insertPack(OWNER, 'blocked');
    await asUser(OWNER);
    const result = await db.query<{ ok: boolean }>('select public.minds_mark_pack_posted($1::uuid) as ok', [id]);
    expect(result.rows[0].ok).toBe(false);
    const after = await packRow(id);
    expect(after.status).toBe('blocked');
    expect(after.posted_at).toBeNull();
  });

  it("another owner's pack cannot be marked by this owner, and nothing changes", async () => {
    const id = await insertPack(STRANGER);
    await asUser(OWNER);
    const result = await db.query<{ ok: boolean }>('select public.minds_mark_pack_posted($1::uuid) as ok', [id]);
    expect(result.rows[0].ok).toBe(false);
    expect((await packRow(id)).status).toBe('ready');
  });

  it('an admin who is not the owner is refused', async () => {
    await db.exec(`insert into public.app_admins (user_id, role) values ('${STRANGER}', 'editor')`);
    const id = await insertPack(STRANGER);
    await asUser(STRANGER);
    await expect(db.query('select public.minds_mark_pack_posted($1::uuid)', [id])).rejects.toThrow(/not_owner/);
    expect((await packRow(id)).status).toBe('ready');
  });

  it('a signed-out visitor cannot call the mark at all', async () => {
    const id = await insertPack();
    await asAnon();
    await expect(db.query('select public.minds_mark_pack_posted($1::uuid)', [id])).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    expect((await packRow(id)).status).toBe('ready');
  });

  it('marking posted is not gated by Takeover: it is the owner\'s own record, not a mind\'s write', async () => {
    const id = await insertPack();
    await setSwitches(false, 'all');
    await asUser(OWNER);
    const result = await db.query<{ ok: boolean }>('select public.minds_mark_pack_posted($1::uuid) as ok', [id]);
    expect(result.rows[0].ok).toBe(true);
  });

  it('a posted pack is never replaced by a new save for the same channel, day and article', async () => {
    const id = await insertPack();
    await asUser(OWNER);
    await db.query('select public.minds_mark_pack_posted($1::uuid)', [id]);
    // The same save door the server uses. A pack with no products needs no slot.
    await expect(
      asServer(
        `select public.minds_save_pack($1::uuid, 'instagram', '2026-10-10'::date, $2::uuid, '2026-10-10T14:00:00Z'::timestamptz, 'Afternoon, US Eastern',
           'A new calm caption for dry skin, with the same guide.', null, null, '/magazine/easy-skincare-routine-dry-skin', null, null,
           '{}'::uuid[], 'ready', null, 'allow', null)`,
        [OWNER, POST],
      ),
    ).rejects.toThrow(/already_posted/);
    expect((await packRow(id)).status).toBe('posted_by_owner');
  });
});

describe('"I posted this": what the owner can read and write directly', () => {
  it("the owner can read his own packs", async () => {
    const id = await insertPack();
    await asUser(OWNER);
    const rows = await db.query<{ id: string }>('select id from public.minds_packs');
    expect(rows.rows.map((row) => row.id)).toEqual([id]);
  });

  it('the owner cannot write a pack row directly, not even to mark it posted', async () => {
    const id = await insertPack();
    await asUser(OWNER);
    await expect(
      db.query("update public.minds_packs set status = 'posted_by_owner', posted_at = now() where id = $1", [id]),
    ).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    expect((await packRow(id)).status).toBe('ready');
  });

  it('a stranger sees none of the owner\'s packs', async () => {
    await insertPack();
    await asUser(STRANGER);
    const rows = await db.query<{ id: string }>('select id from public.minds_packs');
    expect(rows.rows).toEqual([]);
  });
});
