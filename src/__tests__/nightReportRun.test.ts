// @vitest-environment node
// The night report, called through runNightReport with a fake database client. Real rules, fake rows. No timer runs.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNightReportDay, runNightReport } from '../../supabase/functions/_shared/nightReportRun';
import { NOTHING_RAN_LINE } from '../../supabase/functions/_shared/mindsNightReport';

type Row = Record<string, unknown>;
interface FakeOptions {
  tables?: Record<string, Row[]>;
  failTable?: string;
  /** Keys already saved, shared across calls, like the real unique index. */
  saved?: Set<string>;
}

/** A small stand-in for the database client: filters, ordering and upsert are enough for the report's reads and write. */
function fakeClient(options: FakeOptions = {}) {
  const tables = options.tables ?? {};
  const saved = options.saved ?? new Set<string>();
  const writes: Row[] = [];
  const touched: string[] = [];
  const from = (table: string) => {
    touched.push(table);
    const filters: Array<(row: Row) => boolean> = [];
    let payload: Row | null = null;
    const chain = {
      select: () => chain,
      order: () => chain,
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return chain;
      },
      gte(column: string, value: string) {
        filters.push((row) => String(row[column]) >= value);
        return chain;
      },
      lt(column: string, value: string) {
        filters.push((row) => String(row[column]) < value);
        return chain;
      },
      upsert(value: Row) {
        payload = value;
        return chain;
      },
      then(resolve: (value: { data: unknown; error: { message: string } | null }) => void) {
        if (options.failTable === table) return resolve({ data: null, error: { message: 'read failed' } });
        if (payload) {
          const key = `${payload.owner_id}|${payload.report_date}`;
          if (saved.has(key)) return resolve({ data: [], error: null });
          saved.add(key);
          writes.push(payload);
          return resolve({ data: [{ id: 'report-1' }], error: null });
        }
        return resolve({ data: (tables[table] ?? []).filter((row) => filters.every((test) => test(row))), error: null });
      },
    };
    return chain;
  };
  return { client: { from }, writes, touched };
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DAY = '2026-10-10';

const logRow = (over: Row = {}): Row => ({
  owner_id: OWNER,
  day: DAY,
  happened_at: '2026-10-10T19:30:00Z',
  mind: 'executioner',
  action: 'Post to Telegram',
  outcome: 'done',
  detail: 'Sent the new article.',
  ...over,
});

describe('the night report is callable, and checks its input first', () => {
  it('accepts a real calendar day and refuses anything else', () => {
    expect(isNightReportDay('2026-10-10')).toBe(true);
    expect(isNightReportDay('2026-02-29')).toBe(false);
    expect(isNightReportDay('2026-13-01')).toBe(false);
    expect(isNightReportDay('today')).toBe(false);
    expect(isNightReportDay(undefined)).toBe(false);
  });

  it('a bad day is refused before anything is read, and nothing is written', async () => {
    const fake = fakeClient();
    const result = await runNightReport(fake.client, OWNER, '2026-99-99');
    expect(result).toEqual({ status: 'failed', ran: false, reason: 'The day is not valid. Nothing was written.' });
    expect(fake.touched).toEqual([]);
    expect(fake.writes).toHaveLength(0);
  });
});

describe('the night report says what happened, honestly', () => {
  it('an empty night is still written, and says that nothing ran', async () => {
    const fake = fakeClient();
    const result = await runNightReport(fake.client, OWNER, DAY);
    expect(result).toEqual({ status: 'written', ran: false });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ owner_id: OWNER, report_date: DAY, title: `Night report for ${DAY}` });
    expect(String(fake.writes[0].body)).toContain(NOTHING_RAN_LINE);
  });

  it('a night with a real step says it ran, and lists the step on the owner clock', async () => {
    const fake = fakeClient({ tables: { minds_daily_log: [logRow()] } });
    const result = await runNightReport(fake.client, OWNER, DAY);
    expect(result).toEqual({ status: 'written', ran: true });
    const body = String(fake.writes[0].body);
    expect(body).toContain('1 step logged for 2026-10-10.');
    expect(body).toContain('20:30 Executioner: Post to Telegram. Done. Sent the new article.');
    expect(body).not.toContain(NOTHING_RAN_LINE);
  });

  it('a night where every step was skipped says nothing ran, and gives the honest reasons', async () => {
    const fake = fakeClient({
      tables: { minds_daily_log: [logRow({ outcome: 'skipped', action: 'Post to YouTube', detail: 'YouTube: no video yet. Nothing was posted.' })] },
    });
    const result = await runNightReport(fake.client, OWNER, DAY);
    expect(result).toEqual({ status: 'written', ran: false });
    const body = String(fake.writes[0].body);
    expect(body).toContain(NOTHING_RAN_LINE);
    expect(body).toContain('no video yet');
  });

  it('reads only this owner, so another owner’s step is never in the report', async () => {
    const fake = fakeClient({ tables: { minds_daily_log: [logRow({ owner_id: OTHER, action: 'Someone else step' })] } });
    const result = await runNightReport(fake.client, OWNER, DAY);
    expect(result.ran).toBe(false);
    expect(String(fake.writes[0].body)).not.toContain('Someone else step');
  });
});

describe('the night report never guesses', () => {
  it('a failed read writes nothing, so a failed read is never called a quiet night', async () => {
    const fake = fakeClient({ failTable: 'minds_daily_log' });
    const result = await runNightReport(fake.client, OWNER, DAY);
    expect(result).toEqual({ status: 'failed', ran: false, reason: 'The day could not be read. Nothing was written.' });
    expect(fake.writes).toHaveLength(0);
  });

  it('a second run for the same day writes nothing new', async () => {
    const saved = new Set<string>();
    const first = await runNightReport(fakeClient({ saved }).client, OWNER, DAY);
    const second = await runNightReport(fakeClient({ saved }).client, OWNER, DAY);
    expect(first).toEqual({ status: 'written', ran: false });
    expect(second).toEqual({ status: 'already_written', ran: false });
  });
});

describe('the night report stays out of the schedule, the UI, and the country rule', () => {
  it('the schedule file has no live cron line', () => {
    const sql = readFileSync(join(process.cwd(), 'scripts/night-report-schedule.sql'), 'utf8');
    const live = sql.split('\n').filter((line) => /cron\.schedule\s*\(/.test(line) && !line.trim().startsWith('--'));
    expect(live).toEqual([]);
    expect(sql).toContain('NOT APPLIED');
  });

  it('the Edge function is owner only, uses the one writer, and never sets a timer', () => {
    const source = readFileSync(join(process.cwd(), 'supabase/functions/buddy-night-report/index.ts'), 'utf8');
    expect(source).toContain('automation_list_secrets');
    expect(source).toContain('runNightReport(sb, user.id, day)');
    expect(source).toContain('Owner authentication required.');
    expect(source).not.toMatch(/Deno\.cron|cron\.schedule/);
  });

  it('the report text and the Buddy screens never name a country', () => {
    const files = [
      'supabase/functions/_shared/mindsNightReport.ts',
      'supabase/functions/_shared/nightReportRun.ts',
      'src/buddy/BuddyReports.tsx',
      'src/buddy/buddyChatStore.ts',
    ];
    for (const file of files) {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      expect(text, file).not.toMatch(/Nigeria|Naira|Lagos|Abuja/);
    }
  });

  it('the new function is registered with the owner check on, like Buddy', () => {
    const config = readFileSync(join(process.cwd(), 'supabase/config.toml'), 'utf8');
    expect(config).toContain('[functions.buddy-night-report]\nverify_jwt = true');
    expect(existsSync(join(process.cwd(), 'supabase/functions/buddy-night-report/index.ts'))).toBe(true);
  });
});
