// @vitest-environment node
// Runs the real Buddy phase 2 and phase 3 migrations in an in-process Postgres (PGlite), with small stand-ins
// for the tables and admin helpers they depend on. Tests the one door that changes an article: the switches,
// the checksum, the cap, the drip limit, the rollback, and who may call it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { paragraphChecksum } from '../../supabase/functions/_shared/postEdits';

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
];

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const ORDER = 'aaaaaaaa-0000-4000-8000-000000000001';
const POST = 'bbbbbbbb-0000-4000-8000-000000000001';
const OTHER_POSTS = ['bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000004'];
const P = ['cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000004'];

const LINE1 = 'Dry skin often feels tight after washing, and it can look dull by midday.';
const ARTICLE = ['# Easy Skincare Routine for Dry Skin', LINE1, '', 'Start with one change at a time.'].join('\n');
const AFTER = `${LINE1} The Calm Skin Routine Guide keeps the morning steps in one easy order.`;

// Stand-ins for what the real project already has. Same names, same access pattern.
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

/** Runs one statement as the server (service role), the only role that may call the apply and gap functions. */
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

async function count(table: string, where = 'true'): Promise<number> {
  const rows = await asServer<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`);
  return rows[0].n;
}

async function postContent(): Promise<string> {
  const rows = await asServer<{ content: string }>('select content from public.posts where id = $1', [POST]);
  return rows[0].content;
}

async function orderStatus(): Promise<string> {
  const rows = await asServer<{ status: string }>('select status from public.buddy_orders where id = $1', [ORDER]);
  return rows[0].status;
}

/** Puts the database back to a known start: Takeover off, one waiting order, one article, four products. */
async function reseed(opts: { takeover?: boolean; kill?: string } = {}): Promise<void> {
  await db.exec('reset role');
  await db.exec(`
    delete from public.post_product_edits;
    delete from public.post_product_slots;
    delete from public.post_drip_days;
    delete from public.minds_gap_notes;
    delete from public.minds_notable_events;
    delete from public.minds_daily_log;
    delete from public.buddy_orders;
    delete from public.posts;
    delete from public.products;
  `);
  await db.query(
    `update public.minds_controls set takeover = $1, kill_scope = $2, updated_by = null where id = 1`,
    [opts.takeover ?? false, opts.kill ?? 'none'],
  );
  await db.query(`insert into public.posts (id, title, content) values ($1, 'Easy Skincare Routine for Dry Skin', $2)`, [POST, ARTICLE]);
  for (const id of OTHER_POSTS) {
    await db.query(`insert into public.posts (id, title, content) values ($1, 'Another article', 'Other text.')`, [id]);
  }
  const names = ['Calm Skin Routine Guide', 'Barrier Repair Checklist', 'Gentle Foaming Cleanser', 'Night Cream Sample Pack'];
  for (let i = 0; i < P.length; i += 1) {
    await db.query(`insert into public.products (id, name, price) values ($1, $2, '12.00')`, [P[i], names[i]]);
  }
  await db.query(
    `insert into public.buddy_orders (id, owner_id, instruction, status) values ($1, $2, 'Add a product to the skin guide', 'waiting')`,
    [ORDER, OWNER],
  );
}

interface ApplyArgs {
  index?: number;
  before?: string;
  after?: string;
  beforeChecksum?: string;
  afterChecksum?: string;
  productIds?: string[];
  removed?: string[];
  orderId?: string;
  postId?: string;
}

async function applyEdit(args: ApplyArgs = {}) {
  const before = args.before ?? LINE1;
  const after = args.after ?? AFTER;
  const beforeChecksum = args.beforeChecksum ?? (await paragraphChecksum(before));
  const afterChecksum = args.afterChecksum ?? (await paragraphChecksum(after));
  return asServer<{ id: string }>(
    `select public.minds_apply_placement($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11::uuid[], $12::uuid[], $13, $14, $15) as id`,
    [
      OWNER,
      args.orderId ?? ORDER,
      args.postId ?? POST,
      '2026-10-09',
      args.index ?? 1,
      before,
      after,
      beforeChecksum,
      afterChecksum,
      'The Calm Skin Routine Guide keeps the morning steps in one easy order.',
      args.productIds ?? [P[0]],
      args.removed ?? [],
      'Allowed.',
      'Added a product line to an article',
      'Added the Calm Skin Routine Guide to "Easy Skincare Routine for Dry Skin". Only one paragraph changed.',
    ],
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
  // The server role reads and writes the minds tables, as the real service role does.
  await db.exec(`grant all on all tables in schema public to service_role`);
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await reseed({ takeover: true });
});

describe('takeover and kill come first: nothing is written when the switches stop the minds', () => {
  it('takeover is off by default: the apply is refused and nothing is written', async () => {
    await reseed({ takeover: false });
    await expect(applyEdit()).rejects.toThrow(/takeover_off/);
    expect(await postContent()).toBe(ARTICLE);
    expect(await count('post_product_slots')).toBe(0);
    expect(await count('post_product_edits')).toBe(0);
    expect(await count('post_drip_days')).toBe(0);
    expect(await count('minds_daily_log')).toBe(0);
    expect(await orderStatus()).toBe('waiting');
  });

  it.each(['all', 'executioner', 'strategist', 'auditor'])('kill "%s" refuses the apply and keeps the order waiting', async (kill) => {
    await reseed({ takeover: true, kill });
    await expect(applyEdit()).rejects.toThrow(/killed/);
    expect(await postContent()).toBe(ARTICLE);
    expect(await orderStatus()).toBe('waiting');
  });

  it('kill set to none, analyst or ceo lets the apply through', async () => {
    for (const kill of ['none', 'analyst', 'ceo']) {
      await reseed({ takeover: true, kill });
      await expect(applyEdit()).resolves.toHaveLength(1);
    }
  });
});

describe('the apply writes exactly the rows it should, and only one paragraph changes', () => {
  it('changes one line, writes the slot, drip, edit, log and notable event, and marks the order done', async () => {
    const rows = await applyEdit();
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);

    const lines = (await postContent()).split('\n');
    const original = ARTICLE.split('\n');
    expect(lines.length).toBe(original.length);
    original.forEach((line, index) => {
      if (index !== 1) expect(lines[index]).toBe(line);
    });
    expect(lines[1]).toBe(AFTER);

    expect(await count('post_product_slots', `post_id = '${POST}' and removed_at is null`)).toBe(1);
    expect(await count('post_drip_days', `post_id = '${POST}'`)).toBe(1);
    expect(await count('post_product_edits', `post_id = '${POST}' and auditor_verdict = 'allow'`)).toBe(1);
    expect(await count('minds_daily_log', `order_id = '${ORDER}' and outcome = 'done' and mind = 'executioner'`)).toBe(1);
    expect(await count('minds_notable_events', `kind = 'article_changed' and mind = 'executioner'`)).toBe(1);
    expect(await orderStatus()).toBe('done');
  });

  it('the stored checksums match the SHA-256 of the exact paragraphs, computed in the app', async () => {
    await applyEdit();
    const rows = await asServer<{ before_checksum: string; after_checksum: string; before_paragraph: string; after_paragraph: string }>(
      'select before_checksum, after_checksum, before_paragraph, after_paragraph from public.post_product_edits',
    );
    expect(rows[0].before_checksum).toBe(await paragraphChecksum(LINE1));
    expect(rows[0].after_checksum).toBe(await paragraphChecksum(AFTER));
    expect(rows[0].before_paragraph).toBe(LINE1);
    expect(rows[0].after_paragraph).toBe(AFTER);
  });
});

describe('checksum and paragraph guards', () => {
  it('a checksum that does not match the paragraph refuses the apply and writes nothing', async () => {
    await expect(applyEdit({ beforeChecksum: 'a'.repeat(64) })).rejects.toThrow(/checksum_mismatch/);
    expect(await postContent()).toBe(ARTICLE);
    expect(await count('post_product_slots')).toBe(0);
    expect(await orderStatus()).toBe('waiting');
  });

  it('a paragraph the owner changed since the plan refuses the apply', async () => {
    await db.query(`update public.posts set content = $1 where id = $2`, [ARTICLE.replace('feels tight', 'feels very tight'), POST]);
    await expect(applyEdit()).rejects.toThrow(/paragraph_changed/);
    expect(await count('post_product_slots')).toBe(0);
  });
});

describe('the cap and the drip limit are database rules', () => {
  it('a fourth product on one article is refused, and the article is left as it was', async () => {
    for (const id of [P[1], P[2], P[3]]) {
      await db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, POST, id]);
    }
    await expect(applyEdit({ productIds: [P[0]] })).rejects.toThrow(/at most 3 products/);
    expect(await postContent()).toBe(ARTICLE);
    expect(await count('post_product_slots', `post_id = '${POST}' and removed_at is null`)).toBe(3);
    expect(await orderStatus()).toBe('waiting');
  });

  it('a swap frees one slot first, so the new product fits and the article ends at three', async () => {
    for (const id of [P[1], P[2], P[3]]) {
      await db.query(`insert into public.post_product_slots (owner_id, post_id, product_id) values ($1, $2, $3)`, [OWNER, POST, id]);
    }
    await applyEdit({ productIds: [P[0]], removed: [P[1]] });
    expect(await count('post_product_slots', `post_id = '${POST}' and removed_at is null`)).toBe(3);
    expect(await count('post_product_slots', `post_id = '${POST}' and product_id = '${P[1]}' and removed_at is not null`)).toBe(1);
  });

  it('a fourth article on the same owner day is refused, and nothing for that article is kept', async () => {
    for (const id of OTHER_POSTS) {
      await db.query(`insert into public.post_drip_days (owner_id, local_day, post_id) values ($1, '2026-10-09', $2)`, [OWNER, id]);
    }
    await expect(applyEdit()).rejects.toThrow(/At most 3 articles a day/);
    expect(await postContent()).toBe(ARTICLE);
    expect(await count('post_product_slots')).toBe(0);
    expect(await count('post_product_edits')).toBe(0);
    expect(await orderStatus()).toBe('waiting');
  });

  it('an article already counted today may take another line on the same day', async () => {
    await db.query(`insert into public.post_drip_days (owner_id, local_day, post_id) values ($1, '2026-10-09', $2)`, [OWNER, POST]);
    for (const id of OTHER_POSTS.slice(0, 2)) {
      await db.query(`insert into public.post_drip_days (owner_id, local_day, post_id) values ($1, '2026-10-09', $2)`, [OWNER, id]);
    }
    await expect(applyEdit()).resolves.toHaveLength(1);
  });
});

describe('an order that is not waiting is never applied twice', () => {
  it('a done order refuses the apply', async () => {
    await db.query(`update public.buddy_orders set status = 'done', done_at = now() where id = $1`, [ORDER]);
    await expect(applyEdit()).rejects.toThrow(/order_not_waiting/);
    expect(await postContent()).toBe(ARTICLE);
  });
});

describe('a gap is recorded, never a product', () => {
  it('writes a gap note, blocks the order with a plain reason, and logs it', async () => {
    await asServer(
      `select public.minds_record_gap($1, $2, $3, $4, $5, $6, $7, $8::date)`,
      [OWNER, ORDER, POST, 'Add a product to the skin guide', 'Create one in the shop, then ask Buddy again.', 'The shop has no product that fits. Create one, then ask again.', 'Found a product gap', '2026-10-09'],
    );
    expect(await count('minds_gap_notes', `owner_id = '${OWNER}'`)).toBe(1);
    const order = await asServer<{ status: string; blocked_reason: string }>('select status, blocked_reason from public.buddy_orders where id = $1', [ORDER]);
    expect(order[0].status).toBe('blocked');
    expect(order[0].blocked_reason).toMatch(/Create one/);
    expect(await count('minds_daily_log', `outcome = 'blocked'`)).toBe(1);
    expect(await count('minds_notable_events', `kind = 'order_blocked'`)).toBe(1);
    expect(await count('products')).toBe(4);
  });

  it('with takeover off, the gap is refused too: nothing is written and the order stays waiting', async () => {
    await reseed({ takeover: false });
    await expect(
      asServer(
        `select public.minds_record_gap($1, $2, $3, $4, $5, $6, $7, $8::date)`,
        [OWNER, ORDER, POST, 'angle', 'note', 'reason', 'title', '2026-10-09'],
      ),
    ).rejects.toThrow(/takeover_off/);
    expect(await count('minds_gap_notes')).toBe(0);
    expect(await orderStatus()).toBe('waiting');
  });
});

describe('who may call and read', () => {
  it('a signed-in owner cannot call the apply directly: only the server can', async () => {
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
    await expect(
      db.query(`select public.minds_apply_placement($1, $2, $3, '2026-10-09'::date, 1, 'x', 'y', 'z', 'w', 's', '{}'::uuid[], '{}'::uuid[], 'n', 't', 'd')`, [OWNER, ORDER, POST]),
    ).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  });

  it('the owner can read his own applied edits, and a stranger cannot', async () => {
    await applyEdit();
    const read = async (user: string) => {
      await db.exec('reset role');
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
      const rows = await db.query<{ n: number }>('select count(*)::int as n from public.post_product_edits');
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
      return rows.rows[0].n;
    };
    expect(await read(OWNER)).toBe(1);
    expect(await read(STRANGER)).toBe(0);
  });
});
