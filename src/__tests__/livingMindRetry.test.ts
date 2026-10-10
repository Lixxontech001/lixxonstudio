import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as server from '../../supabase/functions/_shared/buddyLivingMinds';

// Phase E slice 3: a failed or empty living-mind day may retry the same local day. A done row never retries.
// Kill writes one stopped row per mind per day, not one per run. Every think here is a fake. No brain is called.

const GOOD_REPLY = JSON.stringify({ summary: 'Views went up a little.', proposals: [{ kind: 'note', text: 'Views rose by two.' }] });
const BASE = { takeover: true, killScope: 'none' as const, facts: 'Last 7 days: 3 article views.', orders: [] as string[] };

function world(thinkImpl: (request: server.LivingThinkRequest) => Promise<server.LivingThinkResult>) {
  const logs: server.LivingLogEntry[] = [];
  const think = vi.fn(thinkImpl);
  const ports: server.LivingMindPorts = {
    think,
    log: vi.fn(async (entry: server.LivingLogEntry) => {
      logs.push(entry);
    }),
  };
  return { ports, logs, think };
}

/** What the day run reads from today's rows, reduced the same way minds-run-placement reduces them. */
function todayFrom(rows: Array<{ mind: server.LivingMind; action: string; outcome: string }>) {
  const doneToday = server.LIVING_MINDS.filter((mind) => rows.some((row) => row.mind === mind && row.outcome === 'done'));
  const stoppedToday = server.LIVING_MINDS.filter((mind) => rows.some((row) => row.mind === mind && row.action === server.STOPPED_ACTION));
  return { doneToday, stoppedToday };
}

describe('a done row never retries', () => {
  it('a mind with a done row today is not thought about again; the other two still run', async () => {
    const { ports, logs, think } = world(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(ports, { ...BASE, doneToday: ['analyst'] });
    expect(think.mock.calls.map((call) => call[0].mind)).toEqual(['strategist', 'ceo']);
    expect(logs.map((row) => row.mind)).toEqual(['strategist', 'ceo']);
  });

  it('when all three are done today, nothing is thought and nothing is written', async () => {
    const { ports, logs, think } = world(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(ports, { ...BASE, doneToday: ['analyst', 'strategist', 'ceo'] });
    expect(think).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });
});

describe('a failed, empty or skipped day may retry the same local day', () => {
  it('a failed Analyst (rate limited) is run again on a later run the same day, and that run writes a done row', async () => {
    let calls = 0;
    const { ports, logs } = world(async (request) => {
      if (request.mind !== 'analyst') return { ok: true, text: GOOD_REPLY };
      calls += 1;
      return calls === 1 ? { ok: false, reason: 'rate_limited' } : { ok: true, text: GOOD_REPLY };
    });
    await server.runLivingMinds(ports, BASE);
    expect(logs.find((row) => row.mind === 'analyst')?.outcome).toBe('failed');

    // The day run reads today's rows: the Analyst is failed (not done), so it is not in doneToday.
    const { doneToday, stoppedToday } = todayFrom([
      { mind: 'analyst', action: server.ANALYST_ACTION, outcome: 'failed' },
      { mind: 'strategist', action: server.STRATEGIST_ACTION, outcome: 'done' },
      { mind: 'ceo', action: server.CEO_ACTION, outcome: 'done' },
    ]);
    expect(doneToday).toEqual(['strategist', 'ceo']);
    logs.length = 0;
    await server.runLivingMinds(ports, { ...BASE, doneToday, stoppedToday });
    expect(logs.map((row) => [row.mind, row.outcome])).toEqual([['analyst', 'done']]);
  });

  it('an empty reply (no brain sent anything usable) is a failed row, and is retried later the same day', async () => {
    const { ports, logs } = world(async () => ({ ok: false, reason: 'empty' }));
    await server.runLivingMinds(ports, BASE);
    expect(logs.every((row) => row.outcome === 'failed')).toBe(true);
    expect(logs[0].detail).toBe('No brain sent back anything usable.');
    const { doneToday } = todayFrom(logs.map((row) => ({ mind: row.mind as server.LivingMind, action: row.action, outcome: row.outcome })));
    expect(doneToday).toEqual([]);
  });

  it('a skipped row (no key saved) is not done, so a later run the same day tries again', async () => {
    const { ports, logs } = world(async () => ({ ok: false, reason: 'no_key' }));
    await server.runLivingMinds(ports, BASE);
    expect(logs.every((row) => row.outcome === 'skipped')).toBe(true);
    const { doneToday } = todayFrom(logs.map((row) => ({ mind: row.mind as server.LivingMind, action: row.action, outcome: row.outcome })));
    expect(doneToday).toEqual([]);
  });

  it('a missing row for a mind counts as not done, so the mind runs', async () => {
    const { ports, think } = world(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(ports, { ...BASE, doneToday: [] });
    expect(think).toHaveBeenCalledTimes(3);
  });
});

describe('Kill writes one stopped row per mind per day', () => {
  it('Kill all on the first run writes one stopped row for each mind', async () => {
    const { ports, logs, think } = world(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(ports, { ...BASE, killScope: 'all' });
    expect(think).not.toHaveBeenCalled();
    expect(logs.map((row) => row.mind)).toEqual(['analyst', 'strategist', 'ceo']);
  });

  it('Kill all on a second run the same day writes no second stopped row', async () => {
    const { ports, logs, think } = world(async () => ({ ok: true, text: GOOD_REPLY }));
    const { stoppedToday } = todayFrom(
      server.LIVING_MINDS.map((mind) => ({ mind, action: server.STOPPED_ACTION, outcome: 'skipped' })),
    );
    await server.runLivingMinds(ports, { ...BASE, killScope: 'all', stoppedToday });
    expect(think).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it('Kill the CEO on a later run writes no second CEO stopped row, but the Analyst still runs once', async () => {
    const { ports, logs, think } = world(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(ports, { ...BASE, killScope: 'ceo', stoppedToday: ['ceo'] });
    expect(think.mock.calls.map((call) => call[0].mind)).toEqual(['analyst', 'strategist']);
    expect(logs.map((row) => row.mind)).toEqual(['analyst', 'strategist']);
    expect(logs.some((row) => row.mind === 'ceo')).toBe(false);
  });

  it('Kill lifted after a stopped row: the mind may run the same day, and its done row then stops further retries', async () => {
    const first = world(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(first.ports, { ...BASE, killScope: 'ceo' });
    const { doneToday, stoppedToday } = todayFrom([
      { mind: 'analyst', action: server.ANALYST_ACTION, outcome: 'done' },
      { mind: 'strategist', action: server.STRATEGIST_ACTION, outcome: 'done' },
      { mind: 'ceo', action: server.STOPPED_ACTION, outcome: 'skipped' },
    ]);
    expect(stoppedToday).toEqual(['ceo']);
    const second = world(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(second.ports, { ...BASE, killScope: 'none', doneToday, stoppedToday });
    expect(second.logs.map((row) => [row.mind, row.outcome])).toEqual([['ceo', 'done']]);

    const third = world(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(third.ports, { ...BASE, killScope: 'none', doneToday: ['analyst', 'strategist', 'ceo'] });
    expect(third.think).not.toHaveBeenCalled();
  });
});

describe('the day run reads each mind on its own rows (source check, no network)', () => {
  const placement = readFileSync(resolve(__dirname, '../../supabase/functions/minds-run-placement/index.ts'), 'utf8');

  it('the day run no longer stops the whole day on any living row: it reads outcome and action per mind', () => {
    expect(placement).toContain('select("mind,action,outcome")');
    expect(placement).toMatch(/row\.mind === mind && row\.outcome === "done"/);
    expect(placement).toMatch(/row\.action === STOPPED_ACTION/);
    expect(placement).toContain('doneToday, stoppedToday });');
  });

  it('a read error still skips the steps entirely, so a flaky read never runs them twice', () => {
    expect(placement).toMatch(/if \(today\.error\) return;/);
  });
});
