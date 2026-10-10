// @vitest-environment node
// The day run's packs, saved through the real pack door (minds_save_pack) in an in-process Postgres (PGlite).
// Runs the real Buddy migrations and the packs migrations, with small stand-ins for auth, admin helpers, posts and products.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runDayPacks, type DayPacksPorts, type PackRow, type PackSource } from '../../supabase/functions/_shared/dayPacks';
import { VIDEO_NOT_MADE_REASON } from '../../supabase/functions/_shared/packMedia';
import { PACKS_ALREADY_MADE_DETAIL } from '../../supabase/functions/_shared/dayPacks';

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
const POST = 'bbbbbbbb-0000-4000-8000-000000000001';
const P1 = 'cccccccc-0000-4000-8000-000000000001';
const P2 = 'cccccccc-0000-4000-8000-000000000002';
const P3 = 'cccccccc-0000-4000-8000-000000000003';
const PICTURE = 'https://images.example.com/cover.jpg';
const SITE = 'https://lixxonstudio.example';

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
insert into auth.users (id) values ('${OWNER}');
insert into public.app_admins (user_id, role) values ('${OWNER}', 'owner');
`;

const SAVE_SQL = `select public.minds_save_pack($1::uuid, $2, $3::date, $4::uuid, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12, $13::uuid[], $14, $15, $16, $17) as id`;

let db: PGlite;

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

async function setSwitches(takeover: boolean, kill = 'none'): Promise<void> {
  await db.exec('reset role');
  await db.query('update public.minds_controls set takeover = $1, kill_scope = $2 where id = 1', [takeover, kill]);
}

/** The real pack door, as the day run's port calls it: the service role, one row per call. */
const savePort: DayPacksPorts['savePack'] = async (row: PackRow) => {
  try {
    await asServer(SAVE_SQL, [
      OWNER,
      row.channel,
      row.localDay,
      row.postId,
      row.suggestedAtUtc,
      row.suggestedLabel,
      row.caption,
      row.pinTitle,
      row.pinDescription,
      row.articleUrl,
      row.imagePath,
      row.videoPath,
      row.productIds,
      row.status,
      row.blockedReason,
      row.auditorVerdict,
      row.auditorNote,
    ]);
    return { ok: true };
  } catch (error) {
    const message = (error as Error).message;
    return { ok: false, reason: /takeover_off/.test(message) ? 'takeover_off' : /killed/.test(message) ? 'killed' : 'failed' };
  }
};

const GOOD = {
  instagram: 'A calm routine for dry skin, with the Calm Skin Routine Guide that keeps the steps in order.',
  tiktok: 'Dry skin feels tight by midday. The Calm Skin Routine Guide puts the steps in one easy order.',
  facebook: 'If your skin feels dry after washing, start with one calm order of steps. The Dry Skin Checklist shows it.',
  pinterest: { title: 'Calm routine for dry skin', description: 'A simple order of steps for dry skin, with the Calm Skin Routine Guide.' },
};

const SOURCE: PackSource = {
  id: POST,
  title: 'Easy Skincare Routine for Dry Skin',
  slug: 'easy-skincare-routine-dry-skin',
  coverImage: PICTURE,
  liveProductIds: [P1, P2],
};

const SHOP = [
  { id: P1, name: 'Calm Skin Routine Guide', isDigital: true, priceUsd: 12 },
  { id: P2, name: 'Dry Skin Checklist', isDigital: true, priceUsd: 5 },
  { id: P3, name: 'Night Care Bundle', isDigital: false, priceUsd: 24 },
];

function ports(overrides: { imageOk?: boolean } = {}): DayPacksPorts {
  return {
    think: async () => ({ ok: true, text: JSON.stringify(GOOD) }),
    checkImage: async () =>
      overrides.imageOk === false
        ? { ok: false, reason: 'not_fetchable' }
        : { ok: true, url: PICTURE, contentType: 'image/jpeg', bytes: 2048 },
    savePack: savePort,
    log: async () => undefined,
  };
}

function dayInput(overrides: Partial<{ takeover: boolean; alreadyMade: boolean; killScope: 'none' | 'all' }> = {}) {
  return {
    localDay: '2026-10-10',
    takeover: overrides.takeover ?? true,
    killScope: overrides.killScope ?? ('none' as const),
    articles: [SOURCE],
    shop: SHOP,
    siteOrigin: SITE,
    alreadyMade: overrides.alreadyMade ?? false,
  };
}

async function packRows() {
  return asServer<{ channel: string; status: string; image_path: string | null; video_path: string | null; product_ids: string[]; article_url: string; blocked_reason: string | null }>(
    `select channel, status, image_path, video_path, product_ids, article_url, blocked_reason from public.minds_packs where owner_id = $1 order by channel`,
    [OWNER],
  );
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
  await db.query(`insert into public.products (id, name) values ($1, 'Calm Skin Routine Guide'), ($2, 'Dry Skin Checklist')`, [P1, P2]);
  for (const id of [P1, P2]) {
    await db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, POST, id]);
  }
});

afterAll(async () => {
  await db.close();
});

describe('a day run with Takeover on saves real pack rows', () => {
  it('a picture that fetches: four real rows, with the picture, the two products, the article link, and no video', async () => {
    const result = await runDayPacks(dayInput(), ports());
    expect(result).toMatchObject({ status: 'done', saved: 4, postId: POST });
    const rows = await packRows();
    expect(rows.map((row) => row.channel)).toEqual(['facebook', 'instagram', 'pinterest', 'tiktok']);
    for (const row of rows) {
      expect(row.status).toBe('blocked');
      expect(row.blocked_reason).toBe(VIDEO_NOT_MADE_REASON);
      expect(row.image_path).toBe(PICTURE);
      expect(row.video_path).toBeNull();
      expect(row.article_url).toBe(`${SITE}/blog/easy-skincare-routine-dry-skin`);
      expect([...row.product_ids].sort()).toEqual([P1, P2].sort());
    }
  });

  it('a picture that cannot be fetched: the rows are still saved, honest, with no picture', async () => {
    const result = await runDayPacks(dayInput(), ports({ imageOk: false }));
    expect(result.status).toBe('done');
    const rows = await packRows();
    expect(rows.length).toBe(4);
    expect(rows.every((row) => row.image_path === null && row.blocked_reason === VIDEO_NOT_MADE_REASON)).toBe(true);
  });

  it('a second run on the same day saves nothing new, so there are still four rows', async () => {
    await runDayPacks(dayInput(), ports());
    const again = await runDayPacks(dayInput({ alreadyMade: true }), ports());
    expect(again).toEqual({ status: 'nothing_to_do', detail: PACKS_ALREADY_MADE_DETAIL, saved: 0, postId: null });
    expect((await packRows()).length).toBe(4);
  });
});

describe('a day run with Takeover off writes nothing, even if the gate were skipped', () => {
  it('the database refuses the first row, so no pack row is saved', async () => {
    await setSwitches(false, 'none');
    const result = await runDayPacks(dayInput({ takeover: true }), ports());
    expect(result.status).toBe('held');
    expect(result.saved).toBe(0);
    expect(result.detail).toMatch(/takeover is off/i);
    expect((await packRows()).length).toBe(0);
  });

  it('a Kill on all: the database refuses the row, and nothing is saved', async () => {
    await setSwitches(true, 'all');
    const result = await runDayPacks(dayInput({ takeover: true }), ports());
    expect(result.status).toBe('held');
    expect((await packRows()).length).toBe(0);
  });
});
