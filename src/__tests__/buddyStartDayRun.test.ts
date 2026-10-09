import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { startDayRun } from '../buddy/buddyChatStore';
import { parseRunAnswer, parseThinkReply } from '../buddy/buddyThinkResult';

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe('starting today\'s run from the browser', () => {
  it('calls the owner-only run function with the local day and returns its plain answer', async () => {
    mocks.invoke.mockResolvedValue({ data: { status: 'applied', detail: 'I added one product.', order_id: 'x' }, error: null });
    const answer = await startDayRun('2026-10-10');
    expect(mocks.invoke).toHaveBeenCalledWith('minds-run-placement', { body: { local_day: '2026-10-10' } });
    expect(answer).toEqual({ status: 'applied', detail: 'I added one product.' });
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
  it('run_start is true only when the server says the run starts', () => {
    expect(parseThinkReply({ ok: true, reply: 'Filed.', run_start: true })).toMatchObject({ ok: true, runStart: true });
    expect(parseThinkReply({ ok: true, reply: 'Filed.' })).toMatchObject({ ok: true, runStart: false });
    expect(parseThinkReply({ ok: true, reply: 'Filed.', run_start: 'yes' })).toMatchObject({ ok: true, runStart: false });
  });
});
