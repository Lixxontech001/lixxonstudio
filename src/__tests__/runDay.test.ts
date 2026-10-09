import { describe, expect, it, vi } from 'vitest';
import {
  KILL_BLOCK_DETAIL,
  NOTHING_TO_RUN_DETAIL,
  NOT_WAITING_DETAIL,
  TAKEOVER_OFF_DETAIL,
  planDayRun,
  runDay,
  type DayRunInput,
} from '../../supabase/functions/_shared/runDay';
import type { LanedOrder } from '../../supabase/functions/_shared/buddyOrders';

const DAY = '2026-10-10';
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const DAILY = '22222222-2222-4222-8222-222222222222';
const HELD = '33333333-3333-4333-8333-333333333333';

function order(id: string, lane: LanedOrder['lane'], instruction = 'Run the products'): LanedOrder {
  return { id, instruction, mind: null, created_at: '2026-10-09T10:00:00Z', lane };
}

const WAITING_PRODUCT = order(PRODUCT, { lane: 'product_line' });
const WAITING_DAILY = order(DAILY, { lane: 'daily_run' }, `Daily run for ${DAY}: today's products and posts.`);
const WAITING_HELD = order(HELD, { lane: 'held', reason: 'Later' }, 'Post it to Instagram');

function input(overrides: Partial<DayRunInput> = {}): DayRunInput {
  return { localDay: DAY, trigger: 'owner', takeover: true, killScope: 'none', waiting: [WAITING_PRODUCT], ...overrides };
}

describe('takeover off means nothing runs', () => {
  it('takeover off: the plan is none and says orders wait', () => {
    expect(planDayRun(input({ takeover: false }))).toEqual({ kind: 'none', detail: TAKEOVER_OFF_DETAIL });
  });

  it('takeover off wins even for the daily trigger, so nothing is queued', () => {
    expect(planDayRun(input({ takeover: false, trigger: 'daily' })).kind).toBe('none');
  });

  it('takeover off: the runner ports are never called and the waiting order stays put', async () => {
    const ports = { createDailyOrder: vi.fn(async () => 'x'), runOrder: vi.fn(async () => ({ status: 'applied', detail: 'x' })) };
    const result = await runDay(input({ takeover: false, trigger: 'daily' }), ports);
    expect(result).toEqual({ status: 'nothing_to_do', detail: TAKEOVER_OFF_DETAIL, orderId: null });
    expect(ports.createDailyOrder).not.toHaveBeenCalled();
    expect(ports.runOrder).not.toHaveBeenCalled();
  });
});

describe('Kill blocks the run', () => {
  it.each(['all', 'strategist', 'executioner', 'auditor'] as const)('Kill %s blocks the run', (kill) => {
    expect(planDayRun(input({ killScope: kill }))).toEqual({ kind: 'none', detail: KILL_BLOCK_DETAIL });
  });

  it.each(['none', 'analyst', 'ceo'] as const)('Kill %s lets the run go ahead', (kill) => {
    expect(planDayRun(input({ killScope: kill })).kind).toBe('run_order');
  });

  it('a blocked daily run queues nothing and runs nothing', async () => {
    const ports = { createDailyOrder: vi.fn(async () => DAILY), runOrder: vi.fn(async () => ({ status: 'applied', detail: '' })) };
    const result = await runDay(input({ killScope: 'executioner', trigger: 'daily' }), ports);
    expect(result.status).toBe('nothing_to_do');
    expect(ports.createDailyOrder).not.toHaveBeenCalled();
    expect(ports.runOrder).not.toHaveBeenCalled();
  });
});

describe('an order waits unless the run is allowed', () => {
  it('with takeover on and a product-line order waiting, the run picks that order', () => {
    expect(planDayRun(input())).toEqual({ kind: 'run_order', orderId: PRODUCT, detail: 'Running your oldest waiting order.' });
  });

  it('the oldest runnable order goes first, and held orders are skipped', () => {
    const plan = planDayRun(input({ waiting: [WAITING_HELD, WAITING_DAILY, WAITING_PRODUCT] }));
    expect(plan).toMatchObject({ kind: 'run_order', orderId: DAILY });
  });

  it('only held orders waiting: nothing to run', () => {
    expect(planDayRun(input({ waiting: [WAITING_HELD] }))).toEqual({ kind: 'none', detail: NOTHING_TO_RUN_DETAIL });
  });

  it('a named order that is not runnable or not waiting is refused', () => {
    expect(planDayRun(input({ orderId: HELD }))).toEqual({ kind: 'none', detail: NOT_WAITING_DETAIL });
    expect(planDayRun(input({ orderId: '44444444-4444-4444-8444-444444444444' })).kind).toBe('none');
  });

  it('a named runnable order is run instead of the oldest', () => {
    expect(planDayRun(input({ waiting: [WAITING_PRODUCT, WAITING_DAILY], orderId: DAILY }))).toMatchObject({
      kind: 'run_order',
      orderId: DAILY,
    });
  });
});

describe('takeover on lets the run call the run port', () => {
  it('owner trigger with an order waiting calls the run port once, with that order', async () => {
    const ports = {
      createDailyOrder: vi.fn(async () => null),
      runOrder: vi.fn(async () => ({ status: 'applied', detail: 'I added one product.' })),
    };
    const result = await runDay(input(), ports);
    expect(ports.runOrder).toHaveBeenCalledTimes(1);
    expect(ports.runOrder).toHaveBeenCalledWith(PRODUCT);
    expect(ports.createDailyOrder).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'applied', detail: 'I added one product.', orderId: PRODUCT });
  });

  it("daily trigger creates today's order first, then runs that order", async () => {
    const calls: string[] = [];
    const ports = {
      createDailyOrder: vi.fn(async (day: string) => {
        calls.push(`create ${day}`);
        return DAILY;
      }),
      runOrder: vi.fn(async (id: string) => {
        calls.push(`run ${id}`);
        return { status: 'gap', detail: 'No product fits yet.' };
      }),
    };
    const result = await runDay(input({ trigger: 'daily', waiting: [] }), ports);
    expect(calls).toEqual([`create ${DAY}`, `run ${DAILY}`]);
    expect(result).toEqual({ status: 'gap', detail: 'No product fits yet.', orderId: DAILY });
  });

  it('daily trigger where the order cannot be saved runs nothing', async () => {
    const ports = { createDailyOrder: vi.fn(async () => null), runOrder: vi.fn(async () => ({ status: 'applied', detail: '' })) };
    const result = await runDay(input({ trigger: 'daily' }), ports);
    expect(result.status).toBe('held');
    expect(ports.runOrder).not.toHaveBeenCalled();
  });

  it('a refused owner order runs nothing', async () => {
    const ports = { createDailyOrder: vi.fn(async () => null), runOrder: vi.fn(async () => ({ status: 'applied', detail: '' })) };
    await runDay(input({ waiting: [] }), ports);
    expect(ports.runOrder).not.toHaveBeenCalled();
  });
});
