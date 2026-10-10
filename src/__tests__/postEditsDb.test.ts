// @vitest-environment node
// Runs the real Phase 3 slice 2 migrations in an in-process Postgres (PGlite), with small stand-ins for the
// tables and admin helpers they depend on. Tests the cap, the daily limit, the checksum, and who can read what.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DRIP_DAILY_LIMIT, PRODUCT_CAP, paragraphChecksum, paragraphUnchanged } from '../../supabase/functions/_shared/postEdits';

const MIGRATIONS = [
  '20261009190000_post_product_slots.sql',
  '20261009200000_post_product_edits.sql',
  '20261009210000_post_drip_days.sql',
  '20261009220000_minds_gap_notes.sql',
];

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';

// Stand-ins for what the real project already has. Same names, same access pattern.
const STAND_INS = `
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

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
const products: string[] = [];

async function newPost(title: string): Promise<string> {
  const r = await db.query<{ id: string }>(`insert into public.posts (title, content) values ($1, 'Original text.') returning id`, [title]);
  return r.rows[0].id;
}

async function asUser(id: string | null): Promise<void> {
  await db.exec('reset role');
  if (id === null) {
    await db.exec('set role anon');
    return;
  }
  await db.exec('set role authenticated');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
}

async function resetRole(): Promise<void> {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let message = '';
  try {
    await promise;
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toMatch(pattern);
}

// Always go back to the admin role after a test, so one failure cannot leak into the next.
afterEach(async () => {
  await resetRole();
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STAND_INS);
  for (const name of MIGRATIONS) {
    await db.exec(readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8'));
  }
  for (let i = 0; i < 5; i += 1) {
    const r = await db.query<{ id: string }>(`insert into public.products (name, price) values ($1, '9.00') returning id`, [`Kit ${i}`]);
    products.push(r.rows[0].id);
  }
}, 120_000);

describe('the 3-product cap on one article', () => {
  it('three products can sit on one article', async () => {
    const post = await newPost('Cap: three products');
    for (const product of products.slice(0, 3)) {
      await db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, post, product]);
    }
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.post_product_slots where post_id = $1 and removed_at is null`, [post]);
    expect(count.rows[0].n).toBe(PRODUCT_CAP);
  });

  it('a fourth product is refused', async () => {
    const post = await newPost('Cap: fourth refused');
    for (const product of products.slice(0, 3)) {
      await db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, post, product]);
    }
    await rejects(
      db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, post, products[3]]),
      /at most 3 products/,
    );
  });

  it('a swap is allowed: remove one, add another, and the article still has three', async () => {
    const post = await newPost('Cap: swap');
    for (const product of products.slice(0, 3)) {
      await db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, post, product]);
    }
    await db.query(`update public.post_product_slots set removed_at = now() where post_id = $1 and product_id = $2`, [post, products[0]]);
    await db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, post, products[3]]);
    const live = await db.query<{ n: number }>(`select count(*)::int as n from public.post_product_slots where post_id = $1 and removed_at is null`, [post]);
    const removed = await db.query<{ n: number }>(`select count(*)::int as n from public.post_product_slots where post_id = $1 and removed_at is not null`, [post]);
    expect(live.rows[0].n).toBe(PRODUCT_CAP);
    expect(removed.rows[0].n).toBe(1);
  });

  it('a removed product cannot be brought back while the article is full', async () => {
    const post = await newPost('Cap: bring back');
    for (const product of products.slice(0, 3)) {
      await db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, post, product]);
    }
    await db.query(`update public.post_product_slots set removed_at = now() where post_id = $1 and product_id = $2`, [post, products[0]]);
    await db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, post, products[3]]);
    await rejects(
      db.query(`update public.post_product_slots set removed_at = null where post_id = $1 and product_id = $2`, [post, products[0]]),
      /at most 3 products/,
    );
  });

  it('the same product cannot be live twice on one article', async () => {
    const post = await newPost('Cap: duplicate');
    await db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, post, products[0]]);
    await rejects(
      db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, post, products[0]]),
      /duplicate key|unique/i,
    );
  });
});

describe('the one-article-a-day drip limit', () => {
  const DAY = '2026-10-09';

  async function touch(post: string, day: string): Promise<void> {
    await db.query(
      `insert into public.post_drip_days (owner_id, local_day, post_id) values ($1, $2, $3) on conflict do nothing`,
      [OWNER, day, post],
    );
  }

  it('the limit is three different articles a day, and a fourth is refused', async () => {
    expect(DRIP_DAILY_LIMIT).toBe(3);
    const day = '2026-11-01';
    for (let i = 0; i < DRIP_DAILY_LIMIT; i += 1) {
      await touch(await newPost(`Drip ${day} ${i}`), day);
    }
    await rejects(touch(await newPost(`Drip ${day} extra`), day), /At most 3 articles a day/);
  });

  it('an article already counted today can be touched again', async () => {
    const day = '2026-11-02';
    const posts: string[] = [];
    for (let i = 0; i < DRIP_DAILY_LIMIT; i += 1) {
      const post = await newPost(`Drip again ${day} ${i}`);
      posts.push(post);
      await touch(post, day);
    }
    await touch(posts[0], day);
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.post_drip_days where owner_id = $1 and local_day = $2`, [OWNER, day]);
    expect(r.rows[0].n).toBe(DRIP_DAILY_LIMIT);
  });

  it('the next day starts fresh', async () => {
    await touch(await newPost(`Drip next ${DAY}`), DAY);
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.post_drip_days where owner_id = $1 and local_day = $2`, [OWNER, DAY]);
    expect(r.rows[0].n).toBe(1);
  });
});

describe('edit records', () => {
  const sha = (text: string) => paragraphChecksum(text);

  async function recordEdit(overrides: Partial<Record<string, unknown>> = {}): Promise<void> {
    const post = await newPost(`Edit ${Math.random()}`);
    const before = 'Dry skin often needs a gentle routine.';
    const after = `${before} A simple kit can help you start.`;
    const row = {
      owner_id: OWNER,
      post_id: post,
      local_day: '2026-10-09',
      before_paragraph: before,
      after_paragraph: after,
      before_checksum: await sha(before),
      after_checksum: await sha(after),
      sentences_added: 'A simple kit can help you start.',
      product_ids: `{${products[0]}}`,
      removed_product_ids: '{}',
      auditor_verdict: 'allow',
      ...overrides,
    };
    const keys = Object.keys(row);
    await db.query(
      `insert into public.post_product_edits (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      keys.map((key) => row[key as keyof typeof row]),
    );
  }

  it('a complete record is stored', async () => {
    await recordEdit();
  });

  it('a record with four products on the article is refused', async () => {
    await rejects(recordEdit({ product_ids: `{${products.slice(0, 4).join(',')}}` }), /check constraint/);
  });

  it('a record that changes nothing is refused', async () => {
    const same = 'Same text.';
    await rejects(recordEdit({ before_paragraph: same, after_paragraph: same, before_checksum: await sha(same), after_checksum: await sha(same) }), /check constraint/);
  });

  it('a record with a malformed checksum is refused', async () => {
    await rejects(recordEdit({ before_checksum: 'not-a-checksum' }), /check constraint/);
  });

  it('only the executioner can be recorded as the one who applied an edit', async () => {
    await rejects(recordEdit({ mind: 'ceo' }), /check constraint/);
  });

  it('a record that does not carry an Auditor allow is refused', async () => {
    await rejects(recordEdit({ auditor_verdict: 'block' }), /check constraint/);
  });
});

describe('who can read what', () => {
  it('the owner reads his own slots, edits and drip days', async () => {
    await asUser(OWNER);
    const slots = await db.query(`select id from public.post_product_slots`);
    const edits = await db.query(`select id from public.post_product_edits`);
    const drip = await db.query(`select 1 from public.post_drip_days`);
    expect(slots.rows.length).toBeGreaterThan(0);
    expect(edits.rows.length).toBeGreaterThan(0);
    expect(drip.rows.length).toBeGreaterThan(0);
    await resetRole();
  });

  it('a signed-in user who is not an admin sees none of these rows', async () => {
    await asUser(STRANGER);
    const slots = await db.query(`select id from public.post_product_slots`);
    const edits = await db.query(`select id from public.post_product_edits`);
    expect(slots.rows).toHaveLength(0);
    expect(edits.rows).toHaveLength(0);
    await resetRole();
  });

  it('a visitor who is not signed in cannot read any of the tables', async () => {
    await asUser(null);
    await rejects(db.query(`select id from public.post_product_slots`), /permission denied/);
    await rejects(db.query(`select id from public.post_product_edits`), /permission denied/);
    await rejects(db.query(`select 1 from public.post_drip_days`), /permission denied/);
    await rejects(db.query(`select id from public.minds_gap_notes`), /permission denied/);
    await resetRole();
  });

  it('the owner cannot write slots, edits or drip days from the browser', async () => {
    const post = await newPost('Browser write');
    await asUser(OWNER);
    await rejects(
      db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, post, products[0]]),
      /permission denied/,
    );
    await rejects(
      db.query(`insert into public.post_drip_days (owner_id, local_day, post_id) values ($1, '2026-10-09', $2)`, [OWNER, post]),
      /permission denied/,
    );
    await resetRole();
  });
});

describe('gap notes', () => {
  it('the server writes a note; the owner can read it and mark it seen', async () => {
    await db.query(
      `insert into public.minds_gap_notes (owner_id, angle, note) values ($1, 'sleep kit for shift workers', 'Create a product for shift workers who need a sleep kit.')`,
      [OWNER],
    );
    await asUser(OWNER);
    const read = await db.query<{ id: string }>(`select id from public.minds_gap_notes`);
    expect(read.rows.length).toBeGreaterThan(0);
    await db.query(`update public.minds_gap_notes set seen_at = now() where id = $1`, [read.rows[0].id]);
    await resetRole();
  });

  it('the owner cannot change the note text, only the seen time', async () => {
    await asUser(OWNER);
    const read = await db.query<{ id: string }>(`select id from public.minds_gap_notes limit 1`);
    await rejects(db.query(`update public.minds_gap_notes set note = 'changed' where id = $1`, [read.rows[0].id]), /permission denied/);
    await resetRole();
  });

  it('the owner cannot add a note from the browser', async () => {
    await asUser(OWNER);
    await rejects(
      db.query(`insert into public.minds_gap_notes (owner_id, angle, note) values ($1, 'x', 'y')`, [OWNER]),
      /permission denied/,
    );
    await resetRole();
  });
});

describe('the checksum guard', () => {
  it('the checksum is the standard SHA-256 of the exact text, the same as Postgres computes it', async () => {
    const text = 'It’s a gentle start: “simple” is fine.';
    const fromDb = await db.query<{ h: string }>(`select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [text]);
    expect(await paragraphChecksum(text)).toBe(fromDb.rows[0].h);
  });

  it('an unchanged paragraph passes', async () => {
    const text = 'The paragraph as it is.';
    expect(await paragraphUnchanged(text, await paragraphChecksum(text))).toEqual({ ok: true });
  });

  it('a paragraph the owner has edited since the plan is refused, and nothing is applied', async () => {
    const planned = 'The paragraph as it was planned.';
    const edited = 'The paragraph as the owner changed it.';
    expect(await paragraphUnchanged(edited, await paragraphChecksum(planned))).toEqual({ ok: false, reason: 'paragraph_changed' });
  });
});

describe('the migrations keep the rules', () => {
  const sql = MIGRATIONS.map((name) => readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8')).join('\n');

  it('no migration writes to products or to article content', () => {
    expect(sql).not.toMatch(/insert\s+into\s+(public\.)?products/i);
    expect(sql).not.toMatch(/update\s+(public\.)?posts\b/i);
    expect(sql).not.toMatch(/insert\s+into\s+(public\.)?posts\b/i);
  });

  it('the caps in the database match the caps in the code', () => {
    expect(sql).toMatch(/live >= 3/);
    expect(sql).toMatch(/touched >= 3/);
  });

  it('nothing is granted to anonymous visitors', () => {
    expect(sql).not.toMatch(/GRANT[^;]*\banon\b/i);
  });
});
