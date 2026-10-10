// Phase 9 slice 2: the night report on a clock. The clock and the writer run against an in-memory database.
// The schedule is checked from its source (it is not applied). The morning briefing is checked not to read reports.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTHING_RAN_LINE } from '../../supabase/functions/_shared/mindsNightReport';
import { nightReportDayDue, previousDay, runNightClock } from '../../supabase/functions/_shared/nightReportClock';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

type Row = Record<string, unknown>;

/** A small in-memory stand-in for the query builder. Filters are applied; a table listed in `down` fails every read. */
function fakeDb(seed: Record<string, Row[]>, down: string[] = []) {
  const store: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const calls: string[] = [];
  const writes: Array<{ table: string; row: Row }> = [];

  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let upsertRow: Row | null = null;
    const api = {
      select: () => api,
      order: () => api,
      limit: () => api,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return api;
      },
      gte: (column: string, value: string) => {
        filters.push((row) => String(row[column]) >= value);
        return api;
      },
      gt: (column: string, value: string) => {
        filters.push((row) => String(row[column]) > value);
        return api;
      },
      lt: (column: string, value: string) => {
        filters.push((row) => String(row[column]) < value);
        return api;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return api;
      },
      upsert: (row: Row) => {
        upsertRow = row;
        return api;
      },
      then(resolve: (value: { data: unknown; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve().then(() => {
          calls.push(table);
          if (down.includes(table)) return { data: null, error: { message: `${table} is down` } };
          if (upsertRow) {
            // buddy_reports has one row per owner and day. A second insert is ignored, as the writer expects.
            const duplicate = (store[table] ?? []).some((row) => row.owner_id === upsertRow!.owner_id && row.report_date === upsertRow!.report_date);
            if (duplicate) return { data: [], error: null };
            const saved = { id: `r${(store[table] ?? []).length + 1}`, ...upsertRow };
            store[table] = [...(store[table] ?? []), saved];
            writes.push({ table, row: saved });
            return { data: [{ id: saved.id }], error: null };
          }
          const rows = (store[table] ?? []).filter((row) => filters.every((check) => check(row)));
          return { data: rows.map((row) => ({ ...row })), error: null };
        }).then(resolve, reject);
      },
    };
    return api;
  }

  return { client: { from: (table: string) => builder(table) }, store, calls, writes };
}

/** One Lagos-clock night: UTC is one hour behind the owner's clock. 22:30 UTC is 23:30 on the owner's clock. */
const DUE = new Date('2026-10-10T22:30:00Z');
const DAY = '2026-10-10';

const seedLog = (outcome: string, action = 'Checked the shop') => ({
  minds_daily_log: [{ owner_id: OWNER, day: DAY, happened_at: '2026-10-10T08:05:00Z', mind: 'analyst', action, outcome, detail: '' }],
  app_admins: [{ user_id: OWNER, role: 'owner' }],
});

describe('the night is due on the owner clock', () => {
  it('is not due before 23:30 and after the 04:00 catch-up', () => {
    expect(nightReportDayDue(new Date('2026-10-10T21:29:00Z'))).toBeNull(); // 22:29 owner time
    expect(nightReportDayDue(new Date('2026-10-10T12:00:00Z'))).toBeNull(); // midday
    expect(nightReportDayDue(new Date('2026-10-11T03:00:00Z'))).toBeNull(); // 04:00 owner time
  });

  it('is due from 23:30 on the owner day', () => {
    expect(nightReportDayDue(DUE)).toBe(DAY); // 23:30 owner time
    expect(nightReportDayDue(new Date('2026-10-10T22:59:00Z'))).toBe(DAY); // 23:59 owner time
  });

  it('after midnight and before 04:00, the night that just ended is still written', () => {
    expect(nightReportDayDue(new Date('2026-10-10T23:00:00Z'))).toBe(DAY); // 00:00 on the 11th, owner time
    expect(nightReportDayDue(new Date('2026-10-11T02:59:00Z'))).toBe(DAY); // 03:59 on the 11th
  });

  it('goes back across month and year ends', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });
});

describe('the clock writes the due night, through the writer', () => {
  it('outside the due window it reads and writes nothing', async () => {
    const db = fakeDb(seedLog('done'));
    const result = await runNightClock(db.client, new Date('2026-10-10T12:00:00Z'));
    expect(result.status).toBe('not_due');
    expect(db.calls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it('writes the due night once for each owner, titled with the owner day', async () => {
    const db = fakeDb(seedLog('done'));
    const result = await runNightClock(db.client, DUE);
    expect(result).toMatchObject({ status: 'done', day: DAY, owners: 1, written: 1, already_written: 0, failed: 0 });
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].row).toMatchObject({ owner_id: OWNER, report_date: DAY, title: `Night report for ${DAY}` });
    expect(String(db.writes[0].row.body)).toContain('Checked the shop');
  });

  it('a second tick for the same night writes nothing new', async () => {
    const db = fakeDb(seedLog('done'));
    await runNightClock(db.client, DUE);
    const again = await runNightClock(db.client, new Date('2026-10-10T23:00:00Z'));
    expect(again).toMatchObject({ status: 'done', day: DAY, written: 0, already_written: 1 });
    expect(db.writes).toHaveLength(1);
  });

  it('an empty night is written honestly as nothing ran, not as a failure', async () => {
    const db = fakeDb({ app_admins: [{ user_id: OWNER, role: 'owner' }] });
    const result = await runNightClock(db.client, DUE);
    expect(result).toMatchObject({ status: 'done', written: 1, failed: 0 });
    expect(db.writes).toHaveLength(1);
    expect(String(db.writes[0].row.body)).toContain(NOTHING_RAN_LINE);
    expect(String(db.writes[0].row.body)).not.toMatch(/failed|could not/i);
  });

  it('a failed read writes nothing, so a failure is never shown as a quiet night', async () => {
    const db = fakeDb(seedLog('done'), ['minds_daily_log']);
    const result = await runNightClock(db.client, DUE);
    expect(result).toMatchObject({ status: 'done', written: 0, failed: 1 });
    expect(db.writes).toEqual([]);
  });

  it('a failed owner read stops the clock with nothing written', async () => {
    const db = fakeDb(seedLog('done'), ['app_admins']);
    const result = await runNightClock(db.client, DUE);
    expect(result.status).toBe('failed');
    expect(db.writes).toEqual([]);
  });

  it('only owners get a night report, never other roles', async () => {
    const db = fakeDb({
      app_admins: [
        { user_id: OWNER, role: 'owner' },
        { user_id: OTHER, role: 'admin' },
      ],
    });
    const result = await runNightClock(db.client, DUE);
    expect(result).toMatchObject({ owners: 1, written: 1 });
    expect(db.writes.map((write) => write.row.owner_id)).toEqual([OWNER]);
  });
});

describe('the schedule is in code, and it is not applied', () => {
  it('the migration schedules buddy-night-clock every 30 minutes, guarded by Vault, and says it is not applied', () => {
    const sql = read('supabase/migrations/20261016000000_buddy_night_clock.sql');
    expect(sql).toContain('NOT APPLIED');
    expect(sql).toContain("cron.schedule(\n    'lixxon_buddy_night_clock',\n    '*/30 * * * *'");
    expect(sql).toContain("|| '/buddy-night-clock'");
    expect(sql).toContain("'x-internal-secret'");
    expect(sql).toContain("vault.decrypted_secrets WHERE name = 'lixxon_internal_fn_secret'");
  });

  it('the clock function checks the internal secret, not the owner session', () => {
    const source = read('supabase/functions/buddy-night-clock/index.ts');
    expect(source).toContain("req.headers.get(\"x-internal-secret\")");
    expect(source).toContain('env("INTERNAL_FN_SECRET")');
    expect(source).toContain('runNightClock(sb, new Date())');
    expect(source).not.toContain('callerUser');
    expect(read('supabase/config.toml')).toMatch(/\[functions\.buddy-night-clock\]\nverify_jwt = false/);
  });
});

describe('the morning briefing never loads last night', () => {
  it('buddy-think and the briefing rules do not read night reports or the clock', () => {
    for (const file of ['supabase/functions/buddy-think/index.ts', 'supabase/functions/_shared/buddyBriefing.ts']) {
      const text = read(file);
      expect(text, file).not.toContain('buddy_reports');
      // mindsNightReport is imported by buddy-think for its pure ownerClock formatter only, so the writer and clock are checked by name.
      expect(text, file).not.toMatch(/nightReportRun|nightReportClock|runNightClock|runNightReport|writeNightReport/);
    }
  });

  it('the app briefing call asks for the briefing action only, and never lists reports', () => {
    const store = read('src/buddy/buddyChatStore.ts');
    const askBriefing = store.match(/export async function askBriefing[\s\S]*?\n}\n/)?.[0] ?? '';
    expect(askBriefing).toContain("action: 'briefing'");
    expect(askBriefing).not.toMatch(/listReports|buddy_reports|night/i);
  });
});
