import { describe, expect, it } from 'vitest';
import {
  NIGHT_REPORT_BODY_LIMIT,
  NOTHING_RAN_LINE,
  buildNightReport,
  ownerClock,
  ownerDayWindow,
  writeNightReport,
  type MindLogRow,
  type NightReportSource,
  type OrderRow,
} from '../../supabase/functions/_shared/mindsNightReport';

const DAY = '2026-10-09';
// 08:05 UTC is 09:05 on the owner's clock.
const AT = '2026-10-09T08:05:00.000Z';

function logRow(overrides: Partial<MindLogRow> = {}): MindLogRow {
  return { happened_at: AT, mind: 'analyst', action: 'Read the sales numbers', outcome: 'done', detail: '', ...overrides };
}

function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return { id: 'o-1', instruction: 'Check the new article', mind: 'analyst', status: 'waiting', blocked_reason: null, ...overrides };
}

function fakeSource(options: { log?: MindLogRow[]; failRead?: boolean; alreadyWritten?: boolean; failSave?: boolean } = {}) {
  const saved: Array<{ report_date: string; title: string; body: string }> = [];
  const source: NightReportSource = {
    async readLog() {
      if (options.failRead) throw new Error('read failed');
      return options.log ?? [];
    },
    async readEvents() {
      return [];
    },
    async readOrders() {
      return [];
    },
    async saveReport(row) {
      if (options.failSave) throw new Error('save failed');
      saved.push(row);
      return options.alreadyWritten ? 'already_written' : 'written';
    },
  };
  return { source, saved };
}

describe('night report rules', () => {
  it('says nothing ran on an idle day, and never invents work', () => {
    const report = buildNightReport({ day: DAY, log: [], events: [], orders: [] });
    expect(report.ran).toBe(false);
    expect(report.title).toBe(`Night report for ${DAY}`);
    expect(report.body.startsWith(NOTHING_RAN_LINE)).toBe(true);
    expect(report.body).not.toContain('What the minds did');
    expect(report.counts).toEqual({ done: 0, skipped: 0, blocked: 0, failed: 0 });
  });

  it('says nothing ran when every step was skipped, and gives the reason', () => {
    const report = buildNightReport({
      day: DAY,
      log: [logRow({ outcome: 'skipped', action: 'Think', detail: 'Cannot think — no Google key.' })],
      events: [],
      orders: [],
    });
    expect(report.ran).toBe(false);
    expect(report.body).toContain(NOTHING_RAN_LINE);
    expect(report.body).toContain('1 step was skipped');
    expect(report.body).toContain('Cannot think');
  });

  it('lists real actions on the owner clock and counts each outcome', () => {
    const report = buildNightReport({
      day: DAY,
      log: [
        logRow({ outcome: 'done' }),
        logRow({ mind: 'auditor', action: 'Checked a plan', outcome: 'blocked', detail: 'Needs a fix first.' }),
      ],
      events: [],
      orders: [],
    });
    expect(report.ran).toBe(true);
    expect(report.counts).toEqual({ done: 1, skipped: 0, blocked: 1, failed: 0 });
    expect(report.body).toContain('09:05 Analyst: Read the sales numbers. Done.');
    expect(report.body).toContain('09:05 Auditor: Checked a plan. Blocked. Needs a fix first.');
    expect(report.body).not.toContain(NOTHING_RAN_LINE);
  });

  it('reports orders: waiting and done counts, and each blocked order with its reason', () => {
    const report = buildNightReport({
      day: DAY,
      log: [],
      events: [],
      orders: [
        order({ id: 'a' }),
        order({ id: 'b', status: 'blocked', blocked_reason: 'Needs your approval.' }),
      ],
    });
    expect(report.body).toContain('Waiting: 1. Done: 0. Blocked: 1.');
    expect(report.body).toContain('Blocked order: Check the new article. Reason: Needs your approval.');
  });

  it('lists notable events under their own heading', () => {
    const report = buildNightReport({
      day: DAY,
      log: [],
      events: [{ happened_at: AT, mind: 'owner', kind: 'takeover_changed', title: 'Takeover turned on', detail: 'Set by the owner in Minds.' }],
      orders: [],
    });
    expect(report.body).toContain('Notable');
    expect(report.body).toContain('09:05 Takeover turned on. Set by the owner in Minds.');
  });

  it('keeps the body inside the database limit', () => {
    const many = Array.from({ length: 3000 }, () => logRow({ action: 'A long repeated step with a little more text in it' }));
    const report = buildNightReport({ day: DAY, log: many, events: [], orders: [] });
    expect(report.body.length).toBeLessThanOrEqual(NIGHT_REPORT_BODY_LIMIT);
  });

  it('shows a dash rather than a guessed time for a bad timestamp', () => {
    expect(ownerClock('not a time')).toBe('--:--');
    expect(ownerClock('2026-10-09T23:30:00.000Z')).toBe('00:30');
  });

  it('keeps the owner day window in UTC, one day long', () => {
    expect(ownerDayWindow(DAY)).toEqual({
      start: '2026-10-08T23:00:00.000Z',
      end: '2026-10-09T23:00:00.000Z',
    });
  });

  it('never says Nigeria, Naira, Lagos or a country in the report text', () => {
    const report = buildNightReport({
      day: DAY,
      log: [logRow()],
      events: [],
      orders: [order({ status: 'blocked', blocked_reason: 'Blocked.' })],
    });
    expect(report.body).not.toMatch(/nigeria|naira|lagos|nigerian/i);
    expect(report.body).not.toContain('—');
  });
});

describe('night report writer', () => {
  it('writes an honest idle report when nothing ran', async () => {
    const { source, saved } = fakeSource({ log: [] });
    const result = await writeNightReport(source, DAY);
    expect(result).toEqual({ status: 'written', ran: false });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ report_date: DAY, title: `Night report for ${DAY}` });
    expect(saved[0].body.startsWith(NOTHING_RAN_LINE)).toBe(true);
  });

  it('writes a busy night with ran true', async () => {
    const { source, saved } = fakeSource({ log: [logRow()] });
    const result = await writeNightReport(source, DAY);
    expect(result).toEqual({ status: 'written', ran: true });
    expect(saved[0].body).toContain('Analyst: Read the sales numbers. Done.');
  });

  it('refuses a second report for the same day', async () => {
    const { source } = fakeSource({ log: [], alreadyWritten: true });
    expect(await writeNightReport(source, DAY)).toEqual({ status: 'already_written', ran: false });
  });

  it('writes nothing when a read fails, so a failed read is never called a quiet night', async () => {
    const { source, saved } = fakeSource({ failRead: true });
    const result = await writeNightReport(source, DAY);
    expect(result.status).toBe('failed');
    expect(saved).toHaveLength(0);
  });

  it('reports a failed save as failed', async () => {
    const { source } = fakeSource({ failSave: true });
    const result = await writeNightReport(source, DAY);
    expect(result.status).toBe('failed');
  });
});
