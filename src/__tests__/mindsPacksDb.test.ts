// @vitest-environment node
// Runs the real Buddy migrations and the unapplied packs migration in an in-process Postgres (PGlite), with small
// stand-ins for the auth schema, the admin helpers, articles and products. Tests the one door that writes a pack.
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
];

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const POST = 'bbbbbbbb-0000-4000-8000-000000000001';
const P = [
  'cccccccc-0000-4000-8000-000000000001',
  'cccccccc-0000-4000-8000-000000000002',
  'cccccccc-0000-4000-8000-000000000003',
  'cccccccc-0000-4000-8000-000000000004',
];

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

/** Runs one statement as the server (service role), the only role that may save a pack. */
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

const SAVE_SQL = `select public.minds_save_pack($1::uuid, $2, $3::date, $4::uuid, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12, $13::uuid[], $14, $15, $16, $17) as id`;

interface PackInput {
  channel?: string;
  day?: string;
  post?: string;
  suggestedAt?: string | null;
  label?: string | null;
  caption?: string | null;
  pinTitle?: string | null;
  pinDescription?: string | null;
  productIds?: string[];
  status?: string;
  blockedReason?: string | null;
  verdict?: string;
  note?: string | null;
}

function args(input: PackInput = {}): unknown[] {
  return [
    OWNER,
    input.channel ?? 'instagram',
    input.day ?? '2026-10-10',
    input.post ?? POST,
    input.suggestedAt === undefined ? '2026-10-10T14:00:00Z' : input.suggestedAt,
    input.label === undefined ? 'Afternoon, US Eastern' : input.label,
    input.caption === undefined ? 'A calm routine for dry skin, with the guide that keeps the steps in order.' : input.caption,
    input.pinTitle ?? null,
    input.pinDescription ?? null,
    '/magazine/easy-skincare-routine-dry-skin',
    null,
    null,
    input.productIds ?? [P[0]],
    input.status ?? 'ready',
    input.blockedReason ?? null,
    input.verdict ?? 'allow',
    input.note ?? null,
  ];
}

async function save(input: PackInput = {}): Promise<string> {
  const rows = await asServer<{ id: string }>(SAVE_SQL, args(input));
  return rows[0].id;
}

async function packCount(where = 'true'): Promise<number> {
  const rows = await asServer<{ n: number }>(`select count(*)::int as n from public.minds_packs where ${where}`);
  return rows[0].n;
}

async function setSwitches(takeover: boolean, kill = 'none'): Promise<void> {
  await db.exec('reset role');
  await db.query('update public.minds_controls set takeover = $1, kill_scope = $2 where id = 1', [takeover, kill]);
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
  `);
  await setSwitches(true, 'none');
  await db.query(`insert into public.posts (id, title, content) values ($1, 'Easy Skincare Routine for Dry Skin', 'Body text.')`, [POST]);
  // Three live slots on the article (the slot cap trigger from phase 3 allows no more). P[3] is a product, but not on the article.
  for (const id of P) {
    await db.query(`insert into public.products (id, name) values ($1, 'Calm Skin Routine Guide')`, [id]);
  }
  for (const id of P.slice(0, 3)) {
    await db.query(
      `insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`,
      [OWNER, POST, id],
    );
  }
});

afterAll(async () => {
  await db.close();
});

describe('minds_save_pack: Takeover off and Kill refuse every pack', () => {
  it('Takeover is off by default: a pack is refused and nothing is written', async () => {
    await setSwitches(false, 'none');
    await expect(save()).rejects.toThrow(/takeover_off/);
    expect(await packCount()).toBe(0);
  });

  it('Kill on the Executioner refuses the pack', async () => {
    await setSwitches(true, 'executioner');
    await expect(save()).rejects.toThrow(/killed/);
    expect(await packCount()).toBe(0);
  });

  it('Kill on all refuses the pack', async () => {
    await setSwitches(true, 'all');
    await expect(save()).rejects.toThrow(/killed/);
    expect(await packCount()).toBe(0);
  });
});

describe('minds_save_pack: one row per channel, day and article', () => {
  it('saves a pack for each of the four channels, same day and article', async () => {
    await save({ channel: 'instagram' });
    await save({ channel: 'tiktok', caption: 'A short check of the steps, one at a time.' });
    await save({ channel: 'facebook', caption: 'The guide keeps the morning steps in one easy order.' });
    await save({ channel: 'pinterest', caption: null, pinTitle: 'Dry skin routine', pinDescription: 'A calm routine for dry skin, step by step.' });
    expect(await packCount()).toBe(4);
  });

  it('a second save for the same channel, day and article replaces the row (same id)', async () => {
    const first = await save({ channel: 'instagram', caption: 'First version of the caption.' });
    const second = await save({ channel: 'instagram', caption: 'Second version of the caption.' });
    expect(second).toBe(first);
    expect(await packCount()).toBe(1);
    const rows = await asServer<{ caption: string }>('select caption from public.minds_packs where id = $1', [first]);
    expect(rows[0].caption).toBe('Second version of the caption.');
  });

  it('a different day is a new row', async () => {
    await save({ day: '2026-10-10' });
    await save({ day: '2026-10-11' });
    expect(await packCount()).toBe(2);
  });

  it('a channel outside the four is refused', async () => {
    await expect(save({ channel: 'youtube' })).rejects.toThrow(/channel_not_allowed/);
    await expect(save({ channel: 'whatsapp' })).rejects.toThrow(/channel_not_allowed/);
    expect(await packCount()).toBe(0);
  });
});

describe('minds_save_pack: at most 3 products, all live on the article', () => {
  it('three products are accepted', async () => {
    await save({ productIds: [P[0], P[1], P[2]] });
    const rows = await asServer<{ product_ids: string[] }>('select product_ids from public.minds_packs');
    expect(rows[0].product_ids).toHaveLength(3);
  });

  it('a fourth product is refused, and nothing is written', async () => {
    await expect(save({ productIds: [P[0], P[1], P[2], P[3]] })).rejects.toThrow(/at most 3 products/);
    expect(await packCount()).toBe(0);
  });

  it('a repeated product is refused', async () => {
    await expect(save({ productIds: [P[0], P[0]] })).rejects.toThrow(/repeated_product/);
  });

  it('a product that is not a live slot on this article is refused', async () => {
    await expect(save({ productIds: [P[3]] })).rejects.toThrow(/slot_missing/);
    expect(await packCount()).toBe(0);
  });

  it('the table itself refuses four products, even if a caller skipped the door', async () => {
    await expect(
      asServer(
        `insert into public.minds_packs (owner_id, channel, local_day, post_id, article_url, product_ids, status, auditor_verdict, suggested_at_utc, caption)
         values ($1, 'instagram', '2026-10-10', $2, '/x', $3::uuid[], 'ready', 'allow', now(), 'Caption.')`,
        [OWNER, POST, P],
      ),
    ).rejects.toThrow(/minds_packs_product_ids_check|cardinality|check constraint/i);
  });
});

describe('minds_save_pack: the Auditor and the copy rules', () => {
  it('a ready pack needs an Auditor allow', async () => {
    await expect(save({ verdict: 'block' })).rejects.toThrow(/auditor_blocked|verdict|check constraint/i);
    expect(await packCount()).toBe(0);
  });

  it('an Auditor block is saved only as blocked, with the reason', async () => {
    await save({ status: 'blocked', blockedReason: 'Auditor said no: the copy repeats.', verdict: 'block', caption: null, suggestedAt: null, label: null });
    const rows = await asServer<{ status: string; blocked_reason: string }>('select status, blocked_reason from public.minds_packs');
    expect(rows[0]).toEqual({ status: 'blocked', blocked_reason: 'Auditor said no: the copy repeats.' });
  });

  it('a blocked pack without a reason is refused', async () => {
    await expect(save({ status: 'blocked', blockedReason: null, verdict: 'allow' })).rejects.toThrow(/reason_missing/);
  });

  it('a ready pack needs a suggested time', async () => {
    await expect(save({ suggestedAt: null })).rejects.toThrow(/time_missing/);
  });

  it('a Pinterest pack needs a pin title and description, not a caption', async () => {
    await expect(save({ channel: 'pinterest', caption: 'Only a caption.', pinTitle: null, pinDescription: null })).rejects.toThrow(/copy_missing/);
  });

  it('copy with a country name, the local clock, a dash or non-USD money is refused', async () => {
    await expect(save({ caption: 'Made for readers in Lagos.' })).rejects.toThrow(/copy_not_clean/);
    await expect(save({ caption: 'Shipped from Nigeria.' })).rejects.toThrow(/copy_not_clean/);
    await expect(save({ caption: 'A calm routine \u2014 for you.' })).rejects.toThrow(/copy_not_clean/);
    await expect(save({ caption: 'It costs \u00a39.' })).rejects.toThrow(/copy_not_clean/);
    await expect(save({ label: 'Morning, 9 WAT' })).rejects.toThrow(/copy_not_clean/);
    expect(await packCount()).toBe(0);
  });

  it('the table refuses a dash in a caption even if a caller skipped the door', async () => {
    await expect(
      asServer(
        `insert into public.minds_packs (owner_id, channel, local_day, post_id, article_url, status, auditor_verdict, suggested_at_utc, caption)
         values ($1, 'instagram', '2026-10-10', $2, '/x', 'ready', 'allow', now(), 'A calm routine \u2014 for you.')`,
        [OWNER, POST],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('minds_save_pack: a posted pack is never overwritten', () => {
  it('once the owner marks a pack posted, a new save is refused and the row is unchanged', async () => {
    const id = await save({ caption: 'Original caption.' });
    await asServer(`update public.minds_packs set status = 'posted_by_owner', posted_at = now() where id = $1`, [id]);
    await expect(save({ caption: 'Replacement caption.' })).rejects.toThrow(/already_posted/);
    const rows = await asServer<{ caption: string; status: string }>('select caption, status from public.minds_packs where id = $1', [id]);
    expect(rows[0]).toEqual({ caption: 'Original caption.', status: 'posted_by_owner' });
  });

  it('save cannot set posted_by_owner directly', async () => {
    await expect(save({ status: 'posted_by_owner' })).rejects.toThrow(/status_not_allowed/);
  });
});

describe('minds_save_pack and minds_packs: who may touch them', () => {
  it('the owner can read his own packs', async () => {
    await save();
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
    try {
      const result = await db.query<{ n: number }>('select count(*)::int as n from public.minds_packs');
      expect(result.rows[0].n).toBe(1);
    } finally {
      await db.exec('reset role');
    }
  });

  it('a signed-in stranger sees no packs', async () => {
    await save();
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [STRANGER]);
    try {
      const result = await db.query<{ n: number }>('select count(*)::int as n from public.minds_packs');
      expect(result.rows[0].n).toBe(0);
    } finally {
      await db.exec('reset role');
    }
  });

  it('a signed-in owner cannot write a pack directly, and cannot call the save door', async () => {
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
    try {
      await expect(
        db.query(
          `insert into public.minds_packs (owner_id, channel, local_day, post_id, article_url, status, auditor_verdict, suggested_at_utc, caption)
           values ($1, 'instagram', '2026-10-10', $2, '/x', 'ready', 'allow', now(), 'Direct write.')`,
          [OWNER, POST],
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(db.query(SAVE_SQL, args())).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec('reset role');
    }
  });

  it('anon cannot read packs', async () => {
    await save();
    await db.exec('reset role');
    await db.exec('set role anon');
    try {
      await expect(db.query('select count(*) from public.minds_packs')).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec('reset role');
    }
  });
});
