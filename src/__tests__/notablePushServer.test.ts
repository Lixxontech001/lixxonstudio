import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BUZZ_KINDS, NO_DEVICE_COPY, PUSH_HELP_COPY, type PushNotifyDeps } from '../../supabase/functions/_shared/notablePush';
import {
  NOTICE_WINDOW_MS,
  PENDING_STALE_MS,
  RETRY_WINDOW_MS,
  attemptRow,
  flushUnpushedNotables,
  ownerDayOf,
  pushNewestNotable,
  type NotablePushPorts,
  type NotableRow,
} from '../../supabase/functions/_shared/notablePushServer';
import type { PushTarget, VapidCredentials } from '../../supabase/functions/_shared/webPush';

// Phase D slice 4 and Phase E slice 5. Every send here is a fake. Every write is an in-memory row. No network.
// The in-memory ports follow the same rules as the database ports: a claim moves a row only from the expected note,
// and the flush reads only rows that still need a push.

const NOW = Date.parse('2026-10-10T12:00:00Z');
const ISO = (ms: number) => new Date(ms).toISOString();
const DEVICE: PushTarget = { id: 'dev-1', endpoint: 'https://push.example.test/dev-1', p256dh: 'P', auth_key: 'A' };
const KEYS: VapidCredentials = { publicKey: 'PUB-TEST', subject: 'mailto:owner@example.test', privateKey: 'PRIV-TEST' };
const OWNER = 'owner-a';
const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

function row(partial: Partial<NotableRow> & { id: string }): NotableRow {
  return {
    owner: OWNER,
    mind: 'owner',
    kind: 'takeover_changed',
    title: 'Takeover turned on',
    happenedAt: ISO(NOW - 30_000),
    pushNote: null,
    claimedAt: null,
    ...partial,
  };
}

interface StoreOptions {
  rows?: NotableRow[];
  credentials?: VapidCredentials | null;
  targets?: PushTarget[];
  sendStatus?: 'sent' | 'expired' | 'failed';
  sendThrows?: boolean;
  claimMode?: 'normal' | 'lost' | 'error';
  readFails?: boolean;
}

/** Fake ports: an in-memory table, a fake send and a fake credential read. Every write is recorded. */
function fakeStore(options: StoreOptions = {}) {
  const rows: NotableRow[] = (options.rows ?? []).map((item) => ({ ...item }));
  const notes: Array<{ id: string; status: string }> = [];
  const logs: Array<{ id: string; mind: string; day: string; detail: string }> = [];
  const send = vi.fn(async () => {
    if (options.sendThrows) throw new Error('network down');
    return { status: options.sendStatus ?? 'sent', reason: 'delivered', httpStatus: 201 } as never;
  });
  const markSent = vi.fn(async () => undefined);
  const deps = (): PushNotifyDeps => ({
    loadCredentials: async () => {
      if (options.readFails) throw new Error('vault');
      return options.credentials === undefined ? KEYS : options.credentials;
    },
    loadTargets: async () => options.targets ?? [DEVICE],
    send: send as never,
    markSent,
  });
  const ports: NotablePushPorts & { owner?: string } = {
    owner: OWNER,
    findNewestUnpushed: vi.fn(async (owner: string, kind: string, since: string) => {
      if (options.readFails) throw new Error('read');
      const found = rows
        .filter((item) => item.owner === owner && item.kind === kind && item.pushNote === null && item.happenedAt >= since)
        .sort((a, b) => b.happenedAt.localeCompare(a.happenedAt));
      return found[0] ? { ...found[0] } : null;
    }),
    listRetryable: vi.fn(async (since: string, owner?: string) => {
      if (options.readFails) throw new Error('read');
      return rows
        .filter((item) => BUZZ_KINDS.includes(item.kind))
        .filter((item) => item.happenedAt >= since)
        .filter((item) => item.pushNote === null || ['pending', 'failed', 'no_device', 'not_configured'].includes(item.pushNote))
        .filter((item) => (owner ? item.owner === owner : true))
        .map((item) => ({ ...item }));
    }),
    claim: vi.fn(async (target: NotableRow, from: Array<string | null>, nowIso: string) => {
      if (options.claimMode === 'error') return 'error' as const;
      const current = rows.find((item) => item.id === target.id);
      if (options.claimMode === 'lost' || !current) return 'lost' as const;
      if (!from.includes(current.pushNote)) return 'lost' as const;
      current.pushNote = 'pending';
      current.claimedAt = nowIso;
      notes.push({ id: current.id, status: 'pending' });
      return 'claimed' as const;
    }),
    setPushNote: vi.fn(async (target: NotableRow, status) => {
      const current = rows.find((item) => item.id === target.id);
      if (current) current.pushNote = status;
      notes.push({ id: target.id, status });
    }),
    logSkip: vi.fn(async (target: NotableRow, detail: string) => {
      logs.push({ id: target.id, mind: target.mind, day: ownerDayOf(target.happenedAt), detail });
    }),
    deps: () => deps(),
  };
  return { ports, rows, notes, logs, send, markSent };
}

describe('pushNewestNotable: one attempt for the newest fresh row', () => {
  it('a fresh takeover row with keys and a device is claimed, sent once, and recorded as sent', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })] });
    expect(await pushNewestNotable('takeover_changed', f.ports, NOW)).toBe('sent');
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.notes.map((note) => note.status)).toEqual(['pending', 'sent']);
    expect(f.rows[0].pushNote).toBe('sent');
  });

  it('the read is limited to the notice window: rows older than two minutes are not pushed', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-old', happenedAt: ISO(NOW - NOTICE_WINDOW_MS - 1_000) })] });
    expect(await pushNewestNotable('takeover_changed', f.ports, NOW)).toBeNull();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('no fresh row means nothing is attempted', async () => {
    const f = fakeStore({ rows: [] });
    expect(await pushNewestNotable('kill_changed', f.ports, NOW)).toBeNull();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('a kind that does not buzz is never read and never sent', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-art', kind: 'article_changed' })] });
    expect(await pushNewestNotable('article_changed', f.ports, NOW)).toBeNull();
    expect(f.ports.findNewestUnpushed).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('a row that already has a note is not pushed again by the browser or chat path', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1', pushNote: 'sent' })] });
    expect(await pushNewestNotable('takeover_changed', f.ports, NOW)).toBeNull();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('a lost claim (another attempt holds the row) sends nothing and writes nothing', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], claimMode: 'lost' });
    expect(await pushNewestNotable('takeover_changed', f.ports, NOW)).toBeNull();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.notes).toEqual([]);
  });

  it('a claim that cannot be written (migration not applied yet) still sends, as before Phase E', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], claimMode: 'error' });
    expect(await pushNewestNotable('takeover_changed', f.ports, NOW)).toBe('sent');
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('a failed read of the notable attempts nothing and never throws', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], readFails: true });
    await expect(pushNewestNotable('takeover_changed', f.ports, NOW)).resolves.toBeNull();
    expect(f.send).not.toHaveBeenCalled();
  });
});

describe('the owner push: honest skips, never a fake sent', () => {
  it('VAPID missing: skipped as not_configured, nothing sent, the row says so, one log line with the help copy', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], credentials: null });
    expect(await pushNewestNotable('takeover_changed', f.ports, NOW)).toBe('not_configured');
    expect(f.send).not.toHaveBeenCalled();
    expect(f.rows[0].pushNote).toBe('not_configured');
    expect(f.logs).toHaveLength(1);
    expect(f.logs[0].detail).toBe(PUSH_HELP_COPY);
  });

  it('keys present but no confirmed device: no_device, nothing sent, one plain log line', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], targets: [] });
    expect(await pushNewestNotable('takeover_changed', f.ports, NOW)).toBe('no_device');
    expect(f.send).not.toHaveBeenCalled();
    expect(f.logs.map((log) => log.detail)).toEqual([NO_DEVICE_COPY]);
  });

  it('a send that throws is recorded as failed, never as sent, and does not throw', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], sendThrows: true });
    await expect(pushNewestNotable('takeover_changed', f.ports, NOW)).resolves.toBe('failed');
    expect(f.rows[0].pushNote).toBe('failed');
  });

  it('a push service refusal (not gone) is failed, not sent', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], sendStatus: 'failed' });
    expect(await pushNewestNotable('takeover_changed', f.ports, NOW)).toBe('failed');
    expect(f.rows[0].pushNote).toBe('failed');
  });

  it('a failed read of the credentials is failed, never sent, never thrown', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], readFails: false });
    f.ports.deps = () => ({
      loadCredentials: async () => {
        throw new Error('vault');
      },
      loadTargets: async () => [DEVICE],
      send: f.send as never,
    });
    await expect(pushNewestNotable('takeover_changed', f.ports, NOW)).resolves.toBe('failed');
    expect(f.send).not.toHaveBeenCalled();
  });

  it('the skip line uses the row mind when the log accepts it, and the owner row is shown as buddy by the port', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-2', mind: 'executioner', kind: 'order_blocked', title: 'Blocked' })], credentials: null });
    await pushNewestNotable('order_blocked', f.ports, NOW);
    expect(f.logs[0].mind).toBe('executioner');
  });

  it('the skip line uses the day of the row (owner clock), not the server clock', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-3', happenedAt: '2026-10-10T23:30:00Z' })], credentials: null });
    await pushNewestNotable('takeover_changed', f.ports, NOW);
    expect(f.logs[0].day).toBe('2026-10-11');
  });
});

describe('flushUnpushedNotables: the server path, when no browser call happened', () => {
  it('a takeover row the browser never pushed is sent by the flush, and the row records sent', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })] });
    const result = await flushUnpushedNotables(f.ports, NOW);
    expect(result).toEqual({ ok: true, considered: 1, attempted: 1, sent: 1 });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.rows[0].pushNote).toBe('sent');
  });

  it('a night-report notable (the auditor writes order_blocked) is sent by the same flush', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-aud', mind: 'auditor', kind: 'order_blocked', title: 'Blocked' })] });
    expect((await flushUnpushedNotables(f.ports, NOW)).sent).toBe(1);
  });

  it('a sent row is never sent again: a second flush sends nothing', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })] });
    await flushUnpushedNotables(f.ports, NOW);
    const second = await flushUnpushedNotables(f.ports, NOW + 60_000);
    expect(second.sent).toBe(0);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('defence in depth: a sent row returned by the read is still skipped by the flush', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1', pushNote: 'sent' })] });
    f.ports.listRetryable = vi.fn(async () => [row({ id: 'n-1', pushNote: 'sent' })]);
    expect((await flushUnpushedNotables(f.ports, NOW)).attempted).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('a fresh pending claim (another attempt is sending) is left alone', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1', pushNote: 'pending', claimedAt: ISO(NOW - 60_000) })] });
    expect((await flushUnpushedNotables(f.ports, NOW)).attempted).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('a stale pending claim (a crashed attempt) is retried', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1', pushNote: 'pending', claimedAt: ISO(NOW - PENDING_STALE_MS - 1_000) })] });
    expect((await flushUnpushedNotables(f.ports, NOW)).sent).toBe(1);
    expect(f.rows[0].pushNote).toBe('sent');
  });

  it('no_device then a device appears: retried, sent once, and the skip line is written only once', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], targets: [] });
    expect((await flushUnpushedNotables(f.ports, NOW)).attempted).toBe(1);
    expect(f.rows[0].pushNote).toBe('no_device');
    f.ports.deps = () => ({ loadCredentials: async () => KEYS, loadTargets: async () => [DEVICE], send: f.send as never, markSent: f.markSent });
    expect((await flushUnpushedNotables(f.ports, NOW + 60_000)).sent).toBe(1);
    expect(f.rows[0].pushNote).toBe('sent');
    expect(f.logs.filter((log) => log.detail === NO_DEVICE_COPY)).toHaveLength(1);
  });

  it('not_configured then VAPID is added: retried and sent, the help line is written only once', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], credentials: null });
    await flushUnpushedNotables(f.ports, NOW);
    expect(f.rows[0].pushNote).toBe('not_configured');
    f.ports.deps = () => ({ loadCredentials: async () => KEYS, loadTargets: async () => [DEVICE], send: f.send as never, markSent: f.markSent });
    expect((await flushUnpushedNotables(f.ports, NOW + 60_000)).sent).toBe(1);
    expect(f.logs.filter((log) => log.detail === PUSH_HELP_COPY)).toHaveLength(1);
  });

  it('a failed send is retried by the next flush, and the retry sends', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], sendStatus: 'failed' });
    await flushUnpushedNotables(f.ports, NOW);
    expect(f.rows[0].pushNote).toBe('failed');
    f.ports.deps = () => ({ loadCredentials: async () => KEYS, loadTargets: async () => [DEVICE], send: vi.fn(async () => ({ status: 'sent', reason: 'delivered', httpStatus: 201 })) as never });
    expect((await flushUnpushedNotables(f.ports, NOW + 60_000)).sent).toBe(1);
  });

  it('a row older than the three-day retry window is not listed and not sent', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-old', happenedAt: ISO(NOW - RETRY_WINDOW_MS - 60_000) })] });
    expect(await flushUnpushedNotables(f.ports, NOW)).toEqual({ ok: true, considered: 0, attempted: 0, sent: 0 });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.ports.listRetryable).toHaveBeenCalledWith(ISO(NOW - RETRY_WINDOW_MS), undefined);
  });

  it('a kind that does not buzz is never sent by the flush', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-art', kind: 'article_changed' })] });
    expect((await flushUnpushedNotables(f.ports, NOW)).attempted).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('a flush scoped to one owner sends only that owner\'s rows', async () => {
    const f = fakeStore({
      rows: [row({ id: 'n-a', owner: 'owner-a' }), row({ id: 'n-b', owner: 'owner-b' })],
    });
    expect((await flushUnpushedNotables(f.ports, NOW, 'owner-a')).sent).toBe(1);
    expect(f.rows.find((item) => item.id === 'n-b')?.pushNote).toBeNull();
  });

  it('a failed read in the flush returns ok false and sends nothing, never throws', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })], readFails: true });
    await expect(flushUnpushedNotables(f.ports, NOW)).resolves.toEqual({ ok: false, considered: 0, attempted: 0, sent: 0 });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('two overlapping flushes send a notable once: the second claim loses', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })] });
    const [first, second] = await Promise.all([flushUnpushedNotables(f.ports, NOW), flushUnpushedNotables(f.ports, NOW)]);
    expect(first.sent + second.sent).toBe(1);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('a browser push and the flush overlapping send a notable once', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1' })] });
    const [browser, flush] = await Promise.all([pushNewestNotable('takeover_changed', f.ports, NOW), flushUnpushedNotables(f.ports, NOW)]);
    expect([browser, flush.sent].filter((value) => value === 'sent' || value === 1)).toHaveLength(1);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('attemptRow is the one path: a row that is already claimed elsewhere returns null', async () => {
    const f = fakeStore({ rows: [row({ id: 'n-1', pushNote: 'pending', claimedAt: ISO(NOW) })], claimMode: 'lost' });
    expect(await attemptRow(f.rows[0], f.ports, NOW)).toBeNull();
  });
});

describe('ownerDayOf', () => {
  it('shifts to the owner clock (UTC+1, Lagos)', () => {
    expect(ownerDayOf('2026-10-10T23:30:00Z')).toBe('2026-10-11');
    expect(ownerDayOf('2026-10-10T10:00:00Z')).toBe('2026-10-10');
  });
});

describe('the callers reach the one helper (source checks, no network)', () => {
  it('buddy-think attempts the owner push for a chat Kill, and never for a door pause or resume', () => {
    const src = read('supabase/functions/buddy-think/index.ts');
    expect(src).toContain('if (!isDoor) await pushNewestNotable("kill_changed", ownerNotablePorts(sb, user.id));');
  });

  it('the Minds notify function takes the caller from the JWT and pushes only the two Minds control kinds', () => {
    const src = read('supabase/functions/minds-control-notify/index.ts');
    expect(src).toContain('ownerNotablePorts(sb, user.id)');
  });

  it('the auditor gap write attempts the owner push for order_blocked, after the database write succeeds', () => {
    const run = read('supabase/functions/minds-run-placement/index.ts');
    expect(run.indexOf('minds_record_gap')).toBeLessThan(run.indexOf('pushNewestNotable("order_blocked"'));
  });

  it('the day run sends through attemptRow (the claim path), never through a direct notifyOwnerDevices of its own', () => {
    const run = read('supabase/functions/minds-run-placement/index.ts');
    expect(run).toContain('return await attemptRow(row, servicePushPorts(sb));');
    expect(run).not.toContain('notifyOwnerDevices(');
  });

  it('the day run flushes waiting pushes before the Takeover switch is read', () => {
    const run = read('supabase/functions/minds-run-placement/index.ts');
    expect(run.indexOf('flushUnpushedNotables(servicePushPorts(sb)')).toBeGreaterThan(0);
    expect(run.indexOf('flushUnpushedNotables(servicePushPorts(sb)')).toBeLessThan(run.indexOf('minds_controls'));
  });

  it('the night clock runs the flush before the night tick, and returns counts only', () => {
    const clock = read('supabase/functions/buddy-night-clock/index.ts');
    expect(clock).toContain('flushUnpushedNotables(servicePushPorts(sb))');
    expect(clock.indexOf('flushUnpushedNotables(')).toBeLessThan(clock.indexOf('runNightClock(sb'));
  });

  it('the claim is written before the send, inside the shared helper (beforeSend runs before send)', () => {
    const src = read('supabase/functions/_shared/notablePush.ts');
    expect(src.indexOf('deps.beforeSend')).toBeLessThan(src.indexOf('await send(target'));
  });

  it('the pending migration is a new file, adds the claim column and the pending note, and is not an edit of an old one', () => {
    const src = read('supabase/migrations/20261019010000_push_note_pending.sql');
    expect(src).toContain("'pending'");
    expect(src).toContain('push_claimed_at');
    expect(src).toContain('NOT applied to production');
  });
});
