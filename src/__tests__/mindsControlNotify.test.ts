import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Minds screen saves Takeover and Kill from the browser. After a successful save, the browser asks the server to
// attempt the owner's push for the notable the database wrote. The call is best effort and never changes the save result.
const { upsert, invoke } = vi.hoisted(() => ({ upsert: vi.fn(), invoke: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ upsert }),
    functions: { invoke },
  },
}));

import { saveMindsControls } from '../buddy/minds/mindsControlsStore';

const NEXT = { takeover: true, killScope: 'none' as const };

describe('saveMindsControls asks the server to attempt the owner push', () => {
  beforeEach(() => {
    upsert.mockReset();
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it('a successful save calls minds-control-notify once and reports ok', async () => {
    upsert.mockResolvedValue({ error: null });
    const result = await saveMindsControls(NEXT, 'owner-1');
    expect(result).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('minds-control-notify', { body: {} });
  });

  it('a failed save never calls the notify function and reports not ok', async () => {
    upsert.mockResolvedValue({ error: { message: 'refused' } });
    expect(await saveMindsControls(NEXT, 'owner-1')).toEqual({ ok: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a notify function that is missing or rejects does not change a saved result', async () => {
    upsert.mockResolvedValue({ error: null });
    invoke.mockRejectedValue(new Error('function not deployed'));
    expect(await saveMindsControls(NEXT, 'owner-1')).toEqual({ ok: true });
  });

  it('a notify call that throws synchronously does not change a saved result', async () => {
    upsert.mockResolvedValue({ error: null });
    invoke.mockImplementation(() => {
      throw new Error('no functions client');
    });
    expect(await saveMindsControls(NEXT, 'owner-1')).toEqual({ ok: true });
  });
});
