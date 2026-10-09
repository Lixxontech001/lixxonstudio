// @vitest-environment node
// The door-post table and its two functions, in an in-process Postgres (PGlite).
// Runs the real Buddy migrations up to the packs, then the door-post migration. Stand-ins cover auth, admin helpers, posts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';

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
  '20261011100000_door_posts.sql',
  '20261011110000_door_posts_open_more.sql',
  '20261011120000_door_posts_open_all.sql',
  '20261011140000_door_posts_twelve.sql',
  '20261011150000_door_posts_three_open.sql',
  '20261011170000_door_posts_all_twelve_open.sql',
];

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const POST_A = 'bbbbbbbb-0000-4000-8000-00000000000a';
const POST_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const POST_C = 'bbbbbbbb-0000-4000-8000-00000000000c';
const URL_A = 'https://lixxonstudio.example/blog/a';

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
grant select on public.posts to anon, authenticated;
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price text
);
grant select on public.products to anon, authenticated;
insert into auth.users (id) values ('${OWNER}'), ('${OTHER}');
insert into public.app_admins (user_id, role) values ('${OWNER}', 'owner'), ('${OTHER}', 'owner');
`;

let db: PGlite;

async function asServer<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  await db.exec('set role service_role');
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function setSwitches(takeover: boolean, kill = 'none'): Promise<void> {
  await db.exec('reset role');
  await db.query('update public.minds_controls set takeover = $1, kill_scope = $2 where id = 1', [takeover, kill]);
}

async function reserve(door: string, postId: string, day: string) {
  return asServer<{ id: string }>('select public.minds_reserve_door_post($1::uuid, $2, $3::uuid, $4::date, $5) as id', [
    OWNER,
    door,
    postId,
    day,
    URL_A,
  ]);
}

async function attempt(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as Error).message;
  }
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
  await db.exec('delete from public.minds_door_posts; delete from public.posts;');
  await db.query(
    `insert into public.posts (id, title, content) values ($1, 'A', 'Body.'), ($2, 'B', 'Body.'), ($3, 'C', 'Body.')`,
    [POST_A, POST_B, POST_C],
  );
  await setSwitches(true, 'none');
});

afterAll(async () => {
  await db.close();
});

describe('reserving a post is refused when Takeover is off or Kill stops the run', () => {
  it('Takeover off: refused, and no row is written', async () => {
    await setSwitches(false, 'none');
    expect(await attempt(reserve('telegram', POST_A, '2026-10-10'))).toMatch(/takeover_off/);
    expect((await asServer('select id from public.minds_door_posts')).length).toBe(0);
  });

  it('Kill on all or the Executioner: refused, and no row is written', async () => {
    for (const kill of ['all', 'executioner']) {
      await setSwitches(true, kill);
      expect(await attempt(reserve('discord', POST_A, '2026-10-10')), kill).toMatch(/killed/);
    }
    expect((await asServer('select id from public.minds_door_posts')).length).toBe(0);
  });

  it('Kill on analyst or the CEO does not stop it', async () => {
    await setSwitches(true, 'ceo');
    expect(await attempt(reserve('telegram', POST_A, '2026-10-10'))).toBeNull();
  });
});

describe('a post is reserved once, per door, per local day', () => {
  it('a door that is not open is refused', async () => {
    expect(await attempt(reserve('instagram', POST_A, '2026-10-10'))).toMatch(/door_not_open/);
    expect(await attempt(reserve('tiktok', POST_A, '2026-10-10'))).toMatch(/door_not_open/);
    expect(await attempt(reserve('whatsapp', POST_A, '2026-10-10'))).toMatch(/door_not_open/);
    // The gated Facebook Page and Pinterest stay manual, so they are refused too.
    expect(await attempt(reserve('facebook', POST_A, '2026-10-10'))).toMatch(/door_not_open/);
    expect(await attempt(reserve('pinterest', POST_A, '2026-10-10'))).toMatch(/door_not_open/);
  });

  it('all twelve auto doors are accepted: the six from Phase 5, then Medium, Pixelfed, WordPress.com, YouTube, Vimeo and Podcast', async () => {
    const open = ['telegram', 'discord', 'bluesky', 'mastodon', 'tumblr', 'blogger', 'medium', 'pixelfed', 'wordpress_com', 'youtube', 'vimeo', 'podcast'];
    for (const [index, door] of open.entries()) {
      const postId = [POST_A, POST_B, POST_C][index % 3];
      expect(await attempt(reserve(door, postId, '2026-10-10')), door).toBeNull();
    }
    const rows = await asServer<{ door: string }>('select door from public.minds_door_posts order by door');
    expect(rows.map((row) => row.door)).toEqual(['blogger', 'bluesky', 'discord', 'mastodon', 'medium', 'pixelfed', 'podcast', 'telegram', 'tumblr', 'vimeo', 'wordpress_com', 'youtube']);
  });

  it('the list of open doors in the database is the same as OPEN_DOORS in the code', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261011170000_door_posts_all_twelve_open.sql'), 'utf8');
    const match = /p_door NOT IN \(([^)]*)\)/.exec(sql);
    expect(match).not.toBeNull();
    const listed = (match?.[1] ?? '').split(',').map((item) => item.trim().replace(/'/g, ''));
    expect([...listed].sort()).toEqual([...OPEN_DOORS].sort());
  });

  it('the first reservation is a queued row', async () => {
    const [row] = await reserve('telegram', POST_A, '2026-10-10');
    expect(row.id).toBeTruthy();
    const [stored] = await asServer<{ status: string; article_url: string }>('select status, article_url from public.minds_door_posts where id = $1', [row.id]);
    expect(stored).toEqual({ status: 'queued', article_url: URL_A });
  });

  it('the same article is never reserved again for that door, on any day', async () => {
    await reserve('telegram', POST_A, '2026-10-10');
    expect(await attempt(reserve('telegram', POST_A, '2026-10-11'))).toMatch(/already_posted/);
  });

  it('a second article the same day is refused by the daily cap', async () => {
    await reserve('telegram', POST_A, '2026-10-10');
    expect(await attempt(reserve('telegram', POST_B, '2026-10-10'))).toMatch(/door_day_cap/);
  });

  it('the cap is per door: the other door can still post that day', async () => {
    await reserve('telegram', POST_A, '2026-10-10');
    expect(await attempt(reserve('discord', POST_B, '2026-10-10'))).toBeNull();
  });

  it('the next day, a new article can be reserved', async () => {
    await reserve('telegram', POST_A, '2026-10-10');
    expect(await attempt(reserve('telegram', POST_B, '2026-10-11'))).toBeNull();
  });
});

describe('finishing a reserved post', () => {
  it('posted: the row is posted, with the reference and a time', async () => {
    const [row] = await reserve('telegram', POST_A, '2026-10-10');
    const [done] = await asServer<{ f: boolean }>("select public.minds_finish_door_post($1::uuid, 'posted', '77', null) as f", [row.id]);
    expect(done.f).toBe(true);
    const [stored] = await asServer<{ status: string; external_ref: string; posted_at: string | null }>(
      'select status, external_ref, posted_at from public.minds_door_posts where id = $1',
      [row.id],
    );
    expect(stored.status).toBe('posted');
    expect(stored.external_ref).toBe('77');
    expect(stored.posted_at).not.toBeNull();
  });

  it('failed: the row is failed, with a plain note and no time', async () => {
    const [row] = await reserve('discord', POST_A, '2026-10-10');
    await asServer("select public.minds_finish_door_post($1::uuid, 'failed', null, 'Discord did not find that webhook.')", [row.id]);
    const [stored] = await asServer<{ status: string; error_note: string; posted_at: string | null }>(
      'select status, error_note, posted_at from public.minds_door_posts where id = $1',
      [row.id],
    );
    expect(stored).toEqual({ status: 'failed', error_note: 'Discord did not find that webhook.', posted_at: null });
  });

  it('only a queued row can be finished, so a second finish does nothing', async () => {
    const [row] = await reserve('telegram', POST_A, '2026-10-10');
    await asServer("select public.minds_finish_door_post($1::uuid, 'posted', '1', null)", [row.id]);
    const [again] = await asServer<{ f: boolean }>("select public.minds_finish_door_post($1::uuid, 'failed', null, 'late') as f", [row.id]);
    expect(again.f).toBe(false);
    const [stored] = await asServer<{ status: string }>('select status from public.minds_door_posts where id = $1', [row.id]);
    expect(stored.status).toBe('posted');
  });

  it('an unknown status is refused', async () => {
    const [row] = await reserve('telegram', POST_A, '2026-10-10');
    expect(await attempt(asServer("select public.minds_finish_door_post($1::uuid, 'sent', null, null)", [row.id]))).toMatch(/bad_status/);
  });
});

describe('who can read and write the door posts', () => {
  it('the owner reads his own rows, and never another owner\'s', async () => {
    await reserve('telegram', POST_A, '2026-10-10');
    await db.query(
      `insert into public.minds_door_posts (owner_id, door, post_id, local_day, article_url, status) values ($1, 'telegram', $2, '2026-10-10', $3, 'queued')`,
      [OTHER, POST_B, URL_A],
    );
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [OWNER]);
    const mine = (await db.query<{ owner_id: string }>('select owner_id from public.minds_door_posts')).rows;
    await db.exec('reset role');
    expect(mine.map((row) => row.owner_id)).toEqual([OWNER]);
  });

  it('a signed-in user cannot write a row directly', async () => {
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [OWNER]);
    const error = await attempt(db.query(`insert into public.minds_door_posts (owner_id, door, post_id, local_day, article_url, status) values ($1, 'telegram', $2, '2026-10-10', $3, 'queued')`, [OWNER, POST_A, URL_A]));
    await db.exec('reset role');
    expect(error).not.toBeNull();
  });

  it('the two functions are for the service role only', async () => {
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [OWNER]);
    const reserveError = await attempt(db.query('select public.minds_reserve_door_post($1::uuid, $2, $3::uuid, $4::date, $5)', [OWNER, 'telegram', POST_A, '2026-10-10', URL_A]));
    const finishError = await attempt(db.query("select public.minds_finish_door_post(gen_random_uuid(), 'posted', null, null)"));
    await db.exec('reset role');
    expect(reserveError).toMatch(/permission denied/);
    expect(finishError).toMatch(/permission denied/);
  });

  it('the table keeps no secret or copy column: only the link, the day and the reference', async () => {
    const columns = (await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'minds_door_posts'",
    )).rows.map((row) => row.column_name);
    expect(columns.sort()).toEqual(
      ['article_url', 'created_at', 'door', 'error_note', 'external_ref', 'id', 'local_day', 'owner_id', 'post_id', 'posted_at', 'status'].sort(),
    );
  });
});

describe('the door-post table accepts all twelve auto doors, and no gated channel', () => {
  it('the table check lists exactly the twelve doors, and every one of them is accepted', async () => {
    const result = await db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'minds_door_posts_door_check'",
    );
    const def = result.rows[0].def;
    for (const id of ['telegram', 'bluesky', 'mastodon', 'tumblr', 'discord', 'blogger', 'medium', 'youtube', 'pixelfed', 'wordpress_com', 'podcast', 'vimeo']) {
      expect(def, id).toContain(`'${id}'`);
    }
    for (const channel of ['instagram', 'tiktok', 'facebook', 'pinterest', 'whatsapp']) {
      expect(def, channel).not.toContain(channel);
    }
  });

  it('the reservation function accepts exactly the twelve auto doors, and no gated channel', () => {
    expect(OPEN_DOORS).toEqual(['telegram', 'discord', 'bluesky', 'mastodon', 'tumblr', 'blogger', 'medium', 'pixelfed', 'wordpress_com', 'youtube', 'vimeo', 'podcast']);
    expect([...OPEN_DOORS].sort()).toEqual([...DOOR_IDS].sort());
  });
});
