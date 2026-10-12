import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
const ORDER_ID = '66666666-6666-4666-8666-666666666666';
vi.mock('../lib/supabaseClient', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { startDayRun } from '../buddy/buddyChatStore';
import { parseRunAnswer, parseThinkReply } from '../buddy/buddyThinkResult';

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe('starting today\'s run from the browser', () => {
  it('runs the exact chat order through the owner-only function', async () => {
    mocks.invoke.mockResolvedValue({ data: { status: 'applied', detail: 'I added one product.', order_id: ORDER_ID }, error: null });
    const answer = await startDayRun('2026-10-10', ORDER_ID);
    expect(mocks.invoke).toHaveBeenCalledWith('minds-run-placement', {
      body: { local_day: '2026-10-10', order_id: ORDER_ID },
    });
    expect(answer).toEqual({ status: 'applied', detail: 'I added one product.' });
  });

  it('can still start a general day run without naming an order', async () => {
    mocks.invoke.mockResolvedValue({ data: { status: 'applied', detail: 'The day run finished.' }, error: null });
    expect(await startDayRun('2026-10-10')).toEqual({ status: 'applied', detail: 'The day run finished.' });
    expect(mocks.invoke).toHaveBeenCalledWith('minds-run-placement', { body: { local_day: '2026-10-10' } });
  });

  it('a refused run returns the refusal, so the owner is told why', async () => {
    mocks.invoke.mockResolvedValue({ data: { status: 'held', detail: 'Takeover is off. Nothing runs. Your orders stay waiting.' }, error: null });
    expect(await startDayRun('2026-10-10')).toEqual({ status: 'held', detail: 'Takeover is off. Nothing runs. Your orders stay waiting.' });
  });

  it('an unreachable function returns null, never a made-up answer', async () => {
    mocks.invoke.mockRejectedValue(new Error('network'));
    expect(await startDayRun('2026-10-10')).toBeNull();
  });

  it('an answer without a plain detail becomes null', async () => {
    mocks.invoke.mockResolvedValue({ data: { error: 'Owner-only access is required.' }, error: null });
    expect(await startDayRun('2026-10-10')).toBeNull();
  });
});

describe('reading the run answer', () => {
  it('needs a status and a detail', () => {
    expect(parseRunAnswer({ status: 'applied', detail: 'Done.' })).toEqual({ status: 'applied', detail: 'Done.' });
    expect(parseRunAnswer({ status: 'applied' })).toBeNull();
    expect(parseRunAnswer({ status: 'applied', detail: '  ' })).toBeNull();
    expect(parseRunAnswer(null)).toBeNull();
  });
});

describe('reading the Buddy reply for a run', () => {
  it('reads the start signal but accepts only a valid saved-order id for a run call', () => {
    expect(parseThinkReply({ ok: true, reply: 'Filed.', run_start: true, run_order_id: ORDER_ID })).toMatchObject({
      ok: true,
      runStart: true,
      runOrderId: ORDER_ID,
    });
    expect(parseThinkReply({ ok: true, reply: 'Filed.', run_start: true })).toMatchObject({ ok: true, runStart: true, runOrderId: null });
    expect(parseThinkReply({ ok: true, reply: 'Filed.', run_start: true, run_order_id: 'not-an-id' })).toMatchObject({ ok: true, runStart: true, runOrderId: null });
    expect(parseThinkReply({ ok: true, reply: 'Filed.' })).toMatchObject({ ok: true, runStart: false, runOrderId: null });
    expect(parseThinkReply({ ok: true, reply: 'Filed.', run_start: 'yes', run_order_id: ORDER_ID })).toMatchObject({ ok: true, runStart: false, runOrderId: null });
  });
});
