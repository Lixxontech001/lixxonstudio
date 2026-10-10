// @vitest-environment node
// Runs the real Buddy switch and order migrations, plus the unapplied daily-run migration, in an in-process Postgres
// (PGlite). Stand-ins cover only the auth schema and the admin helpers the migrations use.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS = [
  '20261009140000_minds_controls.sql',
  '20261009150000_buddy_orders.sql',
  '20261010090000_minds_daily_run.sql',
];

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';

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
insert into auth.users (id) values ('${OWNER}'), ('${STRANGER}');
insert into public.app_admins (user_id, role) values ('${OWNER}', 'owner');
`;

let db: PGlite;

/** Runs one statement as the server (service role), the only role that may queue a daily run. */
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

async function queue(day: string, owner = OWNER): Promise<string | null> {
  const rows = await asServer<{ id: string | null }>('select public.minds_queue_daily_run($1::uuid, $2::date) as id', [owner, day]);
  return rows[0].id;
}

async function setSwitches(takeover: boolean, kill = 'none'): Promise<void> {
  await db.exec('reset role');
  await db.query('update public.minds_controls set takeover = $1, kill_scope = $2 where id = 1', [takeover, kill]);
}

async function dailyOrders(): Promise<{ id: string; instruction: string; status: string; owner_id: string }[]> {
  return asServer<{ id: string; instruction: string; status: string; owner_id: string }>(
    `select id, instruction, status, owner_id from public.buddy_orders where instruction like 'Daily run for %' order by created_at`,
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
  await db.exec('delete from public.buddy_orders');
  await setSwitches(false, 'none');
});

afterAll(async () => {
  await db.close();
});

describe('minds_queue_daily_run: Takeover is off by default', () => {
  it('Takeover off: no order is queued, and nothing is written', async () => {
    expect(await queue('2026-10-10')).toBeNull();
    expect(await dailyOrders()).toHaveLength(0);
  });
});

describe('minds_queue_daily_run: with Takeover on', () => {
  it('queues one waiting daily order for the owner and the day', async () => {
    await setSwitches(true);
    const id = await queue('2026-10-10');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await dailyOrders();
    expect(rows).toEqual([
      { id, instruction: "Daily run for 2026-10-10: today's products and posts.", status: 'waiting', owner_id: OWNER },
    ]);
  });

  it('is idempotent per day: a second call returns the same order and adds none', async () => {
    await setSwitches(true);
    const first = await queue('2026-10-10');
    const second = await queue('2026-10-10');
    expect(second).toBe(first);
    expect(await dailyOrders()).toHaveLength(1);
  });

  it('a new day queues a new order', async () => {
    await setSwitches(true);
    await queue('2026-10-10');
    await queue('2026-10-11');
    expect(await dailyOrders()).toHaveLength(2);
  });

  it('Kill on all, strategist, executioner or auditor blocks the queue', async () => {
    for (const kill of ['all', 'strategist', 'executioner', 'auditor']) {
      await setSwitches(true, kill);
      expect(await queue('2026-10-10')).toBeNull();
    }
    expect(await dailyOrders()).toHaveLength(0);
  });

  it('Kill on analyst or CEO does not block the run', async () => {
    await setSwitches(true, 'analyst');
    expect(await queue('2026-10-10')).not.toBeNull();
    await setSwitches(true, 'ceo');
    expect(await queue('2026-10-11')).not.toBeNull();
  });

  it('only the owner has a daily run: a signed-in stranger is refused', async () => {
    await setSwitches(true);
    expect(await queue('2026-10-10', STRANGER)).toBeNull();
    expect(await dailyOrders()).toHaveLength(0);
  });

  it('a missing day or owner queues nothing', async () => {
    await setSwitches(true);
    const rows = await asServer<{ id: string | null }>('select public.minds_queue_daily_run(null::uuid, null::date) as id');
    expect(rows[0].id).toBeNull();
  });
});

describe('minds_queue_daily_run: who may call it', () => {
  it('a signed-in owner cannot call it directly', async () => {
    await setSwitches(true);
    await db.exec('reset role');
    await db.exec('set role authenticated');
    await db.exec(`select set_config('request.jwt.claim.sub', '${OWNER}', false)`);
    try {
      await expect(db.query('select public.minds_queue_daily_run($1::uuid, $2::date)', [OWNER, '2026-10-10'])).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec('reset role');
    }
    expect(await dailyOrders()).toHaveLength(0);
  });

  it('anon cannot call it', async () => {
    await setSwitches(true);
    await db.exec('reset role');
    await db.exec('set role anon');
    try {
      await expect(db.query('select public.minds_queue_daily_run($1::uuid, $2::date)', [OWNER, '2026-10-10'])).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec('reset role');
    }
  });
});
