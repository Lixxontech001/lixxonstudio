// Phase I slice 1: the 08:00 morning clock. The rules and the tick run with a fake clock and fake ports: no
// database, no network, no real time, no live brain. The schedule is checked from its source, because it is not
// applied. If the Takeover rule breaks, this file fails.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { KILL_BLOCK_DETAIL, TAKEOVER_OFF_DETAIL } from '../../supabase/functions/_shared/runDay';
import {
  MORNING_CATCH_UP_UNTIL_MINUTES,
  MORNING_RUN_MINUTES,
  NOT_DUE_DETAIL,
  OWNERS_UNREADABLE_DETAIL,
  PIPELINE_START_FAILED_DETAIL,
  morningRunDayDue,
  runMorningClock,
  type MorningClockPorts,
} from '../../supabase/functions/_shared/morningClock';
import { OWNER_UTC_OFFSET_HOURS } from '../../supabase/functions/_shared/mindsNightReport';
import type { KillScope } from '../../supabase/functions/_shared/placementRun';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';
const DAY = '2026-10-14';
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');
/** The source with the comments gone, so a rule about code is not tripped by the words around it. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
const exists = (path: string) => existsSync(join(process.cwd(), path));

/** An instant at the owner's own clock time, on one day. The owner clock is UTC+1 (OWNER_UTC_OFFSET_HOURS). */
function ownerClock(day: string, minutes: number): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date, Math.floor(minutes / 60) - OWNER_UTC_OFFSET_HOURS, minutes % 60));
}

function fakePorts(options: {
  takeover?: boolean;
  killScope?: KillScope;
  owners?: string[];
  orderId?: string | null;
  ownersDown?: boolean;
  controlsDown?: boolean;
  queueThrows?: boolean;
} = {}) {
  const owners = options.owners ?? [OWNER];
  const readOwners = vi.fn(async () => (options.ownersDown ? { ok: false as const } : { ok: true as const, owners }));
  const readControls = vi.fn(async () =>
    options.controlsDown
      ? { ok: false as const }
      : { ok: true as const, takeover: options.takeover ?? true, killScope: options.killScope ?? ('none' as KillScope) },
  );
  const queueDailyRun = vi.fn(async () => {
    if (options.queueThrows) throw new Error('the database is down');
    return options.orderId === undefined ? ORDER : options.orderId;
  });
  const doors = { readOwners, readControls, queueDailyRun } as unknown as MorningClockPorts;
  return { doors, readOwners, readControls, queueDailyRun };
}

describe('Phase I slice 1: the 08:00 window on the owner clock', () => {
  it('the run is due at 08:00 and is still queued until 12:00', () => {
    expect(MORNING_RUN_MINUTES).toBe(8 * 60);
    expect(MORNING_CATCH_UP_UNTIL_MINUTES).toBe(12 * 60);
  });

  it('before 08:00, from 12:00 and in the evening, no day is due', () => {
    expect(morningRunDayDue(ownerClock(DAY, 0))).toBeNull();
    expect(morningRunDayDue(ownerClock(DAY, 7 * 60 + 59))).toBeNull();
    expect(morningRunDayDue(ownerClock(DAY, 12 * 60))).toBeNull();
    expect(morningRunDayDue(ownerClock(DAY, 23 * 60))).toBeNull();
  });

  it('from 08:00 to 11:59 the owner day is due, with the catch-up window included', () => {
    expect(morningRunDayDue(ownerClock(DAY, 8 * 60))).toBe(DAY);
    expect(morningRunDayDue(ownerClock(DAY, 8 * 60 + 1))).toBe(DAY);
    expect(morningRunDayDue(ownerClock(DAY, 11 * 60 + 59))).toBe(DAY);
    // 07:00 UTC is 08:00 on the owner clock, and the day is still the owner's day.
    expect(morningRunDayDue(new Date('2026-10-14T07:00:00Z'))).toBe(DAY);
    // 23:00 UTC is the next owner day at midnight, before the window.
    expect(morningRunDayDue(new Date('2026-10-14T23:00:00Z'))).toBeNull();
  });

  it('outside the window nothing is read and nothing is written', async () => {
    const ports = fakePorts();
    const result = await runMorningClock(ownerClock(DAY, 7 * 60), ports.doors);
    expect(result).toEqual({ status: 'not_due', day: null, owners: 0, queued: 0, skipped: 0, failed: 0, detail: NOT_DUE_DETAIL, pipeline: [] });
    expect(ports.readOwners).not.toHaveBeenCalled();
    expect(ports.readControls).not.toHaveBeenCalled();
    expect(ports.queueDailyRun).not.toHaveBeenCalled();
  });
});

describe('Phase I slice 1: the run happens only when Takeover is On', () => {
  it('Takeover off: nothing is queued, and the plain line says so', async () => {
    const ports = fakePorts({ takeover: false });
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
    expect(result).toMatchObject({ status: 'takeover_off', day: DAY, owners: 1, queued: 0, skipped: 1, failed: 0 });
    expect(result.detail).toBe(TAKEOVER_OFF_DETAIL);
    expect(ports.queueDailyRun).not.toHaveBeenCalled();
  });

  it('a Kill that stops the run holds the day back, and nothing is queued', async () => {
    for (const killScope of ['all', 'strategist', 'executioner', 'auditor'] as KillScope[]) {
      const ports = fakePorts({ killScope });
      const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
      expect(result.status, killScope).toBe('takeover_off');
      expect(result.detail, killScope).toBe(KILL_BLOCK_DETAIL);
      expect(ports.queueDailyRun, killScope).not.toHaveBeenCalled();
    }
  });

  it('a Kill that leaves the run alone still queues the day', async () => {
    for (const killScope of ['none', 'analyst', 'ceo'] as KillScope[]) {
      const ports = fakePorts({ killScope });
      const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
      expect(result.status, killScope).toBe('done');
      expect(ports.queueDailyRun, killScope).toHaveBeenCalledWith(OWNER, DAY);
      expect(result.queued, killScope).toBe(1);
    }
  });

  it('Takeover on: the day is queued once, for the owner, on the owner day', async () => {
    const ports = fakePorts();
    const result = await runMorningClock(ownerClock(DAY, 8 * 60 + 30), ports.doors);
    expect(result).toEqual({
      status: 'done',
      day: DAY,
      owners: 1,
      queued: 1,
      skipped: 0,
      failed: 0,
      detail: 'Queued the day for 1 of 1 owner(s).',
      pipeline: [],
    });
    expect(ports.readControls).toHaveBeenCalledTimes(1);
    expect(ports.queueDailyRun).toHaveBeenCalledTimes(1);
    expect(ports.queueDailyRun).toHaveBeenCalledWith(OWNER, DAY);
  });

  it('a second tick on the same day reads the same order and queues nothing new', async () => {
    // The database rule returns the order already queued for that day, so the clock counts it as in place.
    const ports = fakePorts();
    await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
    const second = await runMorningClock(ownerClock(DAY, 9 * 60), ports.doors);
    expect(second.queued).toBe(1);
    expect(ports.queueDailyRun).toHaveBeenCalledTimes(2);
    expect(new Set(ports.queueDailyRun.mock.calls.map((call) => call[1]))).toEqual(new Set([DAY]));
  });

  it('two owners are each read and each queued on their own', async () => {
    const ports = fakePorts({ owners: [OWNER, OTHER] });
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
    expect(result).toMatchObject({ status: 'done', owners: 2, queued: 2, skipped: 0, failed: 0 });
    expect(ports.queueDailyRun).toHaveBeenCalledWith(OTHER, DAY);
  });

  it('the same owner listed twice is read once, so no double queue', async () => {
    const ports = fakePorts({ owners: [OWNER, OWNER] });
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
    expect(result.owners).toBe(1);
    expect(ports.queueDailyRun).toHaveBeenCalledTimes(1);
  });

  it('one owner stopped and one allowed: the day is queued for the allowed one only', async () => {
    const ports = fakePorts({ owners: [OWNER, OTHER] });
    let seen = 0;
    ports.readControls.mockImplementation(async () => {
      seen += 1;
      return { ok: true as const, takeover: seen > 1, killScope: 'none' as KillScope };
    });
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
    expect(result).toMatchObject({ status: 'done', owners: 2, queued: 1, skipped: 1, failed: 0 });
    expect(ports.queueDailyRun).toHaveBeenCalledTimes(1);
    expect(ports.queueDailyRun).toHaveBeenCalledWith(OTHER, DAY);
  });

  it('a database refusal (a name the rule will not queue) is held back, not failed', async () => {
    const ports = fakePorts({ orderId: null });
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
    expect(result).toMatchObject({ status: 'done', queued: 0, skipped: 1, failed: 0 });
  });

  it('a failed queue call is counted as held back and never throws out of the tick', async () => {
    const ports = fakePorts({ queueThrows: true });
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
    expect(result).toMatchObject({ status: 'done', queued: 0, skipped: 1, failed: 0 });
  });

  it('an unreadable owner list stops the tick', async () => {
    const ports = fakePorts({ ownersDown: true });
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
    expect(result).toEqual({
      status: 'failed',
      day: DAY,
      owners: 0,
      queued: 0,
      skipped: 0,
      failed: 0,
      detail: OWNERS_UNREADABLE_DETAIL,
      pipeline: [],
    });
    expect(ports.readControls).not.toHaveBeenCalled();
    expect(ports.queueDailyRun).not.toHaveBeenCalled();
  });

  it('an unreadable controls row stops that owner and queues nothing', async () => {
    const ports = fakePorts({ controlsDown: true });
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
    expect(result).toMatchObject({ status: 'done', owners: 1, queued: 0, skipped: 0, failed: 1 });
    expect(ports.queueDailyRun).not.toHaveBeenCalled();
  });
});

describe('Phase I slice 1: the clock only queues, and the schedule is a file', () => {
  it('the shared clock never posts, spends, publishes or writes an article', () => {
    const source = code(read('supabase/functions/_shared/morningClock.ts'));
    expect(source).not.toMatch(/fetch\(|insert\(|update\(|delete\(|http_post|spend|publish/i);
    expect(source).toContain('blockedDetail');
    expect(source).toContain('ownerDayAndMinutes');
  });

  it('the function checks the internal secret, reads the controls, and queues through the database rule', () => {
    const source = code(read('supabase/functions/minds-morning-clock/index.ts'));
    expect(source).toContain('env("INTERNAL_FN_SECRET")');
    expect(source).toContain('req.headers.get("x-internal-secret")');
    expect(source).toContain('runMorningClock(now, ports)');
    expect(source).toContain('const now = new Date();');
    expect(source).toContain('minds_queue_daily_run');
    expect(source).toContain('minds_controls');
    expect(source).toContain('runMindPipeline');
    expect(source).not.toContain('callerUser');
    // The clock writes the daily log and nothing else: no article, no product, no order, no price, no post.
    expect(source).not.toMatch(/\.update\(|\.delete\(/);
    expect([...source.matchAll(/from\("([a-z_]+)"\)\.insert/g)].map((match) => match[1])).toEqual(['minds_daily_log']);
    expect(source).not.toMatch(/from\("(posts|products|orders|buddy_orders|shop_products)"\)\.insert/);
    expect(read('supabase/config.toml')).toMatch(/\[functions\.minds-morning-clock\]\nverify_jwt = false/);
  });

  it('the migration file exists, is guarded, and says it is not applied', () => {
    const file = 'supabase/migrations/20261021000000_minds_morning_clock.sql';
    expect(exists(file)).toBe(true);
    const sql = read(file);
    expect(sql).toContain('NOT APPLIED');
    expect(sql).toContain("'lixxon_minds_morning_clock'");
    expect(sql).toContain("'*/15 * * * *'");
    expect(sql).toContain("|| '/minds-morning-clock'");
    expect(sql).toContain("'x-internal-secret'");
    expect(sql).toContain("vault.decrypted_secrets WHERE name = 'lixxon_internal_fn_secret'");
    expect(sql).toContain('pg_available_extensions');
  });


describe('Phase I slice 2: the clock starts the day, and only after the day is in place', () => {
  it('no pipeline port means the day is only queued', async () => {
    const ports = fakePorts();
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), ports.doors);
    expect(result.pipeline).toEqual([]);
  });

  it('a queued day runs the pipeline once, for that owner and that day', async () => {
    const ports = fakePorts();
    const runPipeline = vi.fn(async () => ({ status: 'done', detail: 'Added the kit.', minds: 3, plans: 2, changed: 1 }));
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), { ...ports.doors, runPipeline } as MorningClockPorts);
    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(runPipeline).toHaveBeenCalledWith(OWNER, DAY);
    expect(result.pipeline).toEqual([{ status: 'done', detail: 'Added the kit.', minds: 3, plans: 2, changed: 1 }]);
  });

  it('a day that was held back never reaches the pipeline', async () => {
    for (const options of [{ takeover: false }, { killScope: 'all' as KillScope }]) {
      const ports = fakePorts(options);
      const runPipeline = vi.fn(async () => ({ status: 'done', detail: 'x', minds: 3, plans: 0, changed: 0 }));
      const result = await runMorningClock(ownerClock(DAY, 8 * 60), { ...ports.doors, runPipeline } as MorningClockPorts);
      expect(runPipeline).not.toHaveBeenCalled();
      expect(result.pipeline).toEqual([]);
    }
  });

  it('a database refusal never reaches the pipeline either', async () => {
    const ports = fakePorts({ orderId: null });
    const runPipeline = vi.fn(async () => ({ status: 'done', detail: 'x', minds: 3, plans: 0, changed: 0 }));
    await runMorningClock(ownerClock(DAY, 8 * 60), { ...ports.doors, runPipeline } as MorningClockPorts);
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it('a pipeline that throws is reported as failed, and the day is still counted as queued', async () => {
    const ports = fakePorts();
    const runPipeline = vi.fn(async () => {
      throw new Error('the run is down');
    });
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), { ...ports.doors, runPipeline } as MorningClockPorts);
    expect(result.queued).toBe(1);
    expect(result.pipeline).toEqual([{ status: 'failed', detail: PIPELINE_START_FAILED_DETAIL, minds: 0, plans: 0, changed: 0 }]);
  });

  it('two owners each get their own run', async () => {
    const ports = fakePorts({ owners: [OWNER, OTHER] });
    const runPipeline = vi.fn(async () => ({ status: 'done', detail: 'ran', minds: 3, plans: 0, changed: 0 }));
    const result = await runMorningClock(ownerClock(DAY, 8 * 60), { ...ports.doors, runPipeline } as MorningClockPorts);
    expect(runPipeline.mock.calls.map((call) => call[0])).toEqual([OWNER, OTHER]);
    expect(result.pipeline).toHaveLength(2);
  });

  it('the run address is asked only inside the window', async () => {
    const ports = fakePorts();
    const runPipeline = vi.fn(async () => ({ status: 'done', detail: 'ran', minds: 3, plans: 0, changed: 0 }));
    await runMorningClock(ownerClock(DAY, 13 * 60), { ...ports.doors, runPipeline } as MorningClockPorts);
    expect(runPipeline).not.toHaveBeenCalled();
  });
});

  it('the old commented 07:00 queue line is left commented, so nothing is scheduled twice', () => {
    const sql = read('supabase/migrations/20261010090000_minds_daily_run.sql');
    expect(sql).toContain("-- SELECT cron.schedule('minds-daily-run', '0 7 * * *'");
  });
});
