import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NO_DEVICE_COPY, PUSH_HELP_COPY } from '../../supabase/functions/_shared/notablePush';
import {
  NOTICE_WINDOW_MS,
  ownerDayOf,
  pushNewestNotable,
  type NewestNotable,
  type NotablePushPorts,
} from '../../supabase/functions/_shared/notablePushServer';
import type { PushTarget, VapidCredentials } from '../../supabase/functions/_shared/webPush';

// Fixed clock for every test: the window is measured from NOW.
const NOW = Date.parse('2026-10-10T12:00:00Z');
const DEVICE: PushTarget = { id: 'dev-1', endpoint: 'https://push.example.test/dev-1', p256dh: 'P', auth_key: 'A' };
const KEYS: VapidCredentials = { publicKey: 'PUB-TEST', subject: 'mailto:owner@example.test', privateKey: 'PRIV-TEST' };
const ROW: NewestNotable = { id: 'n-1', mind: 'owner', title: 'Takeover turned on', happenedAt: '2026-10-10T11:59:30Z' };
const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

interface FakeOptions {
  row?: NewestNotable | null;
  credentials?: VapidCredentials | null;
  targets?: PushTarget[];
  sendStatus?: 'sent' | 'expired' | 'failed';
  sendThrows?: boolean;
}

/** Fake ports only: no network, no real push. Every write is recorded so a test can see exactly what happened. */
function fakePorts(options: FakeOptions = {}) {
  const notes: Array<[string, string]> = [];
  const logs: Array<{ day: string; mind: string; detail: string }> = [];
  const sent: PushTarget[] = [];
  const send = vi.fn(async () => {
    if (options.sendThrows) throw new Error('network down');
    return { status: options.sendStatus ?? 'sent', reason: 'delivered', httpStatus: 201 } as never;
  });
  // Answers only when called with a kind and a window, as the real port is.
  const findUnsent = vi.fn(async (...args: string[]) => (args.length === 2 ? (options.row === undefined ? ROW : options.row) : null));
  const ports: NotablePushPorts = {
    findUnsent,
    setPushNote: vi.fn(async (id: string, status: string) => {
      notes.push([id, status]);
    }) as never,
    logSkip: vi.fn(async (entry) => {
      logs.push(entry);
    }),
    notify: {
      loadCredentials: async () => (options.credentials === undefined ? KEYS : options.credentials),
      loadTargets: async () => options.targets ?? [DEVICE],
      send: send as never,
      markSent: async (target: PushTarget) => {
        sent.push(target);
      },
    },
  };
  return { ports, notes, logs, send, findUnsent, sent };
}

describe('pushNewestNotable: one attempt for the newest fresh row', () => {
  it('a fresh takeover row with keys and a device is pushed once, and the row records sent', async () => {
    const f = fakePorts();
    const status = await pushNewestNotable('takeover_changed', f.ports, NOW);
    expect(status).toBe('sent');
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.notes).toEqual([['n-1', 'sent']]);
    expect(f.sent).toEqual([DEVICE]);
    expect(f.logs).toEqual([]);
  });

  it('the read is limited to the notice window: rows older than two minutes are not pushed', async () => {
    const f = fakePorts();
    await pushNewestNotable('kill_changed', f.ports, NOW);
    const since = f.findUnsent.mock.calls[0][1];
    expect(Date.parse(since)).toBe(NOW - NOTICE_WINDOW_MS);
  });

  it('no fresh row means nothing is attempted: no send and no note', async () => {
    const f = fakePorts({ row: null });
    expect(await pushNewestNotable('kill_changed', f.ports, NOW)).toBeNull();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.notes).toEqual([]);
  });

  it('a kind that does not buzz is never read and never sent', async () => {
    const f = fakePorts();
    expect(await pushNewestNotable('article_changed', f.ports, NOW)).toBeNull();
    expect(f.findUnsent).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
});

describe('pushNewestNotable: honest skips, never a fake sent', () => {
  it('VAPID missing: skipped as not_configured, nothing sent, the row says so, one daily-log line with the help copy', async () => {
    const f = fakePorts({ credentials: null });
    const status = await pushNewestNotable('takeover_changed', f.ports, NOW);
    expect(status).toBe('not_configured');
    expect(f.send).not.toHaveBeenCalled();
    expect(f.notes).toEqual([['n-1', 'not_configured']]);
    expect(f.logs).toEqual([{ day: '2026-10-10', mind: 'buddy', detail: PUSH_HELP_COPY }]);
  });

  it('keys present but no confirmed device: no_device, nothing sent, one plain daily-log line', async () => {
    const f = fakePorts({ targets: [] });
    expect(await pushNewestNotable('kill_changed', f.ports, NOW)).toBe('no_device');
    expect(f.send).not.toHaveBeenCalled();
    expect(f.logs).toEqual([{ day: '2026-10-10', mind: 'buddy', detail: NO_DEVICE_COPY }]);
  });

  it('a send that throws is recorded as failed, never as sent, and does not throw', async () => {
    const f = fakePorts({ sendThrows: true });
    await expect(pushNewestNotable('takeover_changed', f.ports, NOW)).resolves.toBe('failed');
    expect(f.notes).toEqual([['n-1', 'failed']]);
    expect(f.sent).toEqual([]);
  });

  it('a push service refusal (not gone) is failed, not sent', async () => {
    const f = fakePorts({ sendStatus: 'failed' });
    expect(await pushNewestNotable('takeover_changed', f.ports, NOW)).toBe('failed');
    expect(f.sent).toEqual([]);
  });

  it('a failed read of the row attempts nothing and never throws', async () => {
    const f = fakePorts();
    f.ports.findUnsent = async () => {
      throw new Error('read refused');
    };
    await expect(pushNewestNotable('kill_changed', f.ports, NOW)).resolves.toBeNull();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('a failed read of the credentials is failed, never sent, never thrown', async () => {
    const f = fakePorts();
    f.ports.notify.loadCredentials = async () => {
      throw new Error('vault down');
    };
    await expect(pushNewestNotable('kill_changed', f.ports, NOW)).resolves.toBe('failed');
    expect(f.send).not.toHaveBeenCalled();
  });
});

describe('pushNewestNotable: the daily-log line uses a mind the log accepts', () => {
  it('a row written by the executioner keeps its mind in the skip line', async () => {
    const f = fakePorts({ row: { ...ROW, id: 'n-2', mind: 'executioner', title: 'An order was blocked' }, targets: [] });
    await pushNewestNotable('order_blocked', f.ports, NOW);
    expect(f.logs[0].mind).toBe('executioner');
  });

  it('the owner row (written by the database for Takeover and Kill) is shown as buddy in the log', async () => {
    const f = fakePorts({ credentials: null });
    await pushNewestNotable('takeover_changed', f.ports, NOW);
    expect(f.logs[0].mind).toBe('buddy');
  });

  it('the skip line uses the owner day of the row, not the server clock', async () => {
    const f = fakePorts({ credentials: null, row: { ...ROW, happenedAt: '2026-10-10T23:30:00Z' } });
    await pushNewestNotable('takeover_changed', f.ports, NOW);
    expect(f.logs[0].day).toBe('2026-10-11');
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

  it('the auditor gap write attempts the owner push for order_blocked, after the database write succeeds', () => {
    const src = read('supabase/functions/minds-run-placement/index.ts');
    const block = src.slice(src.indexOf('recordGap: async (gap: GapRecord)'), src.indexOf('log: (entry: RunLog)'));
    expect(block.indexOf('minds_record_gap')).toBeLessThan(block.indexOf('pushNewestNotable("order_blocked"'));
    expect(block).toContain('if (error) return { ok: false, reason: reasonFrom(error.message) };');
  });

  it('the day run and the chat path use the same owner push deps (one helper, not a second product)', () => {
    const run = read('supabase/functions/minds-run-placement/index.ts');
    expect(run).toContain('notifyOwnerDevices(kind, title, ownerPushDeps(sb, owner))');
    expect(run).not.toMatch(/loadCredentials: \(\) => loadPushCredentials/);
  });

  it('the Minds notify function takes the caller from the JWT and pushes only the two Minds control kinds', () => {
    const src = read('supabase/functions/minds-control-notify/index.ts');
    expect(src).toContain('const user = await callerUser(req);');
    expect(src).toContain('const CONTROL_KINDS = ["takeover_changed", "kill_changed"] as const;');
    expect(src).toContain('ownerNotablePorts(sb, user.id)');
    expect(read('supabase/config.toml')).toMatch(/\[functions\.minds-control-notify\]\s*\nverify_jwt = true/);
  });
});
