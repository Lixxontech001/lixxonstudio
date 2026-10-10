import { describe, expect, it } from 'vitest';
import { servicePushPorts } from '../../supabase/functions/_shared/notablePushServer';

// Phase E slice 6 fix: the service adapter must not select push_claimed_at before the pending migration is applied.
// A fake chainable client records every call. No database, no network.

type Call = { table: string; method: string; args: unknown[] };
type Result = { data: unknown; error: { message: string } | null };

function fakeClient(respond: (table: string, calls: Call[]) => Result) {
  const log: Call[][] = [];
  const client = {
    from(table: string) {
      const calls: Call[] = [];
      log.push(calls);
      const builder: Record<string, unknown> = {};
      const chain = (method: string) => (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
      for (const method of ['select', 'eq', 'is', 'in', 'gte', 'or', 'order', 'limit', 'update', 'insert', 'maybeSingle']) {
        builder[method] = chain(method);
      }
      builder.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(respond(table, calls)).then(resolve, reject);
      return builder;
    },
  };
  return { client: client as never, log };
}

const selectArgs = (calls: Call[]) => calls.filter((call) => call.method === 'select').map((call) => String(call.args[0]));

const pendingRow = {
  id: 'n1',
  owner_id: 'owner-1',
  mind: 'buddy',
  kind: 'notable',
  title: 'Waiting',
  happened_at: '2026-10-10T10:00:00Z',
  push_note: 'pending',
};

describe('the service adapter reads only columns that exist before the pending migration', () => {
  it('findNewestUnpushed selects no push_claimed_at', async () => {
    const { client, log } = fakeClient(() => ({ data: null, error: null }));
    await servicePushPorts(client).findNewestUnpushed('owner-1', 'notable', '2026-10-10T00:00:00Z');
    const selects = selectArgs(log[0]);
    expect(selects).toHaveLength(1);
    expect(selects[0]).not.toContain('push_claimed_at');
  });

  it('listRetryable with no pending rows selects no push_claimed_at and makes one read', async () => {
    const { client, log } = fakeClient(() => ({
      data: [{ id: 'n2', owner_id: 'owner-1', mind: 'buddy', kind: 'notable', title: 'x', happened_at: '2026-10-10T10:00:00Z', push_note: null }],
      error: null,
    }));
    const rows = await servicePushPorts(client).listRetryable('2026-10-07T00:00:00Z');
    expect(rows).toHaveLength(1);
    expect(log).toHaveLength(1);
    expect(selectArgs(log[0])[0]).not.toContain('push_claimed_at');
  });

  it('listRetryable reads claim times only for pending rows, and keeps the real time when it is readable', async () => {
    const claimed = '2026-10-10T09:00:00.000Z';
    const { client, log } = fakeClient((_table, calls) => {
      if (calls.some((call) => call.method === 'select' && String(call.args[0]).includes('push_claimed_at'))) {
        return { data: [{ id: 'n1', push_claimed_at: claimed }], error: null };
      }
      return { data: [pendingRow], error: null };
    });
    const rows = await servicePushPorts(client).listRetryable('2026-10-07T00:00:00Z');
    expect(rows[0].claimedAt).toBe(claimed);
    expect(log).toHaveLength(2);
    expect(selectArgs(log[1])[0]).toBe('id,push_claimed_at');
  });

  it('a failed claim-time read counts the pending row as fresh, so it is not sent this time', async () => {
    const { client } = fakeClient((table, calls) => {
      if (calls.some((call) => call.method === 'select' && String(call.args[0]).includes('push_claimed_at'))) {
        return { data: null, error: { message: 'boom' } };
      }
      return { data: [pendingRow], error: null };
    });
    const rows = await servicePushPorts(client).listRetryable('2026-10-07T00:00:00Z');
    expect(rows[0].claimedAt).not.toBeNull();
    expect(Date.now() - Date.parse(rows[0].claimedAt as string)).toBeLessThan(60_000);
  });

  it('claiming a stale pending row is compare-and-set on the claim time that was read', async () => {
    const { client, log } = fakeClient(() => ({ data: [{ id: 'n1' }], error: null }));
    const row = { id: 'n1', owner: 'owner-1', mind: 'buddy', kind: 'notable', title: '', happenedAt: '2026-10-10T10:00:00Z', pushNote: 'pending', claimedAt: '2026-10-10T09:00:00.000Z' };
    const outcome = await servicePushPorts(client).claim(row, ['pending'], '2026-10-10T12:00:00.000Z');
    expect(outcome).toBe('claimed');
    const eqs = log[0].filter((call) => call.method === 'eq').map((call) => call.args);
    expect(eqs).toContainEqual(['push_claimed_at', '2026-10-10T09:00:00.000Z']);
  });

  it('claiming a row with no note does not compare claim times', async () => {
    const { client, log } = fakeClient(() => ({ data: [{ id: 'n2' }], error: null }));
    const row = { id: 'n2', owner: 'owner-1', mind: 'buddy', kind: 'notable', title: '', happenedAt: '2026-10-10T10:00:00Z', pushNote: null, claimedAt: null };
    await servicePushPorts(client).claim(row, [null], '2026-10-10T12:00:00.000Z');
    const columns = log[0].filter((call) => call.method === 'eq').map((call) => call.args[0]);
    expect(columns).not.toContain('push_claimed_at');
  });
});
