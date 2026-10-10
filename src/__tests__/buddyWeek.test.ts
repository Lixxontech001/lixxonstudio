import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CANNOT_SEE_LAST_WEEK,
  PAID_FLOOR,
  VIEW_FLOOR,
  isoWeekKey,
  planWeekNotables,
  weekDirection,
  weekSentence,
  weekWindows,
  type WeekFacts,
} from '../../supabase/functions/_shared/buddyWeek';
import { scanNotableSources, type NotablePlan, type NotablePorts } from '../../supabase/functions/_shared/notableSources';
import { BRIEFING_NOTABLE_KINDS, buildBriefing, type BriefingFacts } from '../../supabase/functions/_shared/buddyBriefing';

// Phase B slice 3: the Analyst's week against last week, one plain sentence, and a notable only for a real
// spike or drop (with a floor), written once per ISO week.

const NOW = new Date('2026-10-10T12:00:00Z');

function week(thisViews: number, lastViews: number, thisPaid: number, lastPaid: number): WeekFacts {
  return { ok: true, thisWeek: { views: thisViews, paid: thisPaid }, lastWeek: { views: lastViews, paid: lastPaid } };
}

describe('week windows: this week is the last 7 days, last week is the 7 days before', () => {
  it('starts 7 days back and 14 days back, and ends now', () => {
    const w = weekWindows(NOW);
    expect(w.thisStart).toBe('2026-10-03T12:00:00.000Z');
    expect(w.lastStart).toBe('2026-09-26T12:00:00.000Z');
    expect(w.end).toBe('2026-10-10T12:00:00.000Z');
  });
});

describe('weekDirection: up, down, or about the same', () => {
  it('up and down are real moves; within 10% is about the same', () => {
    expect(weekDirection(240, 110)).toBe('up');
    expect(weekDirection(15, 40)).toBe('down');
    expect(weekDirection(100, 95)).toBe('same');
    expect(weekDirection(0, 0)).toBe('same');
  });

  it('going from nothing to something is up, and from something to nothing is down', () => {
    expect(weekDirection(5, 0)).toBe('up');
    expect(weekDirection(0, 5)).toBe('down');
  });
});

describe('weekSentence: one plain sentence with real counts', () => {
  it('says up, down or about the same, with the real counts for both metrics', () => {
    expect(weekSentence(week(240, 110, 3, 2))).toBe(
      'Against the 7 days before, the last 7 days have article views up (240 against 110) and paid orders up (3 against 2).',
    );
    expect(weekSentence(week(100, 95, 0, 4))).toBe(
      'Against the 7 days before, the last 7 days have article views about the same (100 against 95) and paid orders down (0 against 4).',
    );
  });

  it('says so honestly when a count could not be read, and never invents a number', () => {
    expect(weekSentence({ ok: false, thisWeek: { views: 0, paid: 0 }, lastWeek: { views: 0, paid: 0 } })).toBe(CANNOT_SEE_LAST_WEEK);
    expect(CANNOT_SEE_LAST_WEEK).toBe('I cannot see last week yet.');
  });

  it('is null when the week was not asked for', () => {
    expect(weekSentence(undefined)).toBeNull();
  });

  it('uses no dash-like character, no country, no currency other than the words above', () => {
    const sentence = weekSentence(week(240, 110, 3, 2)) ?? '';
    expect(sentence).not.toMatch(/[\u2014\u2013]/);
    expect(sentence).not.toMatch(/nigeria|lagos|naira|\bWAT\b/i);
  });
});

describe('isoWeekKey: the ISO week of the owner\'s local day', () => {
  it('gives the ISO week, including around the year boundary', () => {
    expect(isoWeekKey('2026-10-10')).toBe('2026-W41');
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
  });
});

describe('planWeekNotables: a spike or drop with a floor, written once per week', () => {
  it('a doubling of article views above the floor is week_up for views', () => {
    const plans = planWeekNotables(week(240, 110, 0, 0), '2026-10-10');
    expect(plans).toEqual([
      expect.objectContaining({ key: 'week:2026-W41:views:up', kind: 'week_up', mind: 'analyst', title: 'Article views are up this week.' }),
    ]);
  });

  it('paid orders at least doubling and clearing the paid floor is week_up for paid orders', () => {
    const plans = planWeekNotables(week(0, 0, 6, 2), '2026-10-10');
    expect(plans.map((plan) => plan.key)).toEqual(['week:2026-W41:paid:up']);
  });

  it('a drop to half or less, from a week that cleared the floor, is week_down', () => {
    const plans = planWeekNotables(week(15, 40, 0, 0), '2026-10-10');
    expect(plans.map((plan) => [plan.kind, plan.key])).toEqual([['week_down', 'week:2026-W41:views:down']]);
  });

  it('0 to 1 is never a spike, and a small week is never a drop', () => {
    expect(planWeekNotables(week(1, 0, 1, 0), '2026-10-10')).toEqual([]);
    expect(planWeekNotables(week(VIEW_FLOOR - 1, 2, PAID_FLOOR - 1, 0), '2026-10-10')).toEqual([]);
    expect(planWeekNotables(week(0, VIEW_FLOOR - 1, 0, PAID_FLOOR - 1), '2026-10-10')).toEqual([]);
  });

  it('a heartbeat with the same numbers plans the same notables, so nothing new is written', () => {
    const first = planWeekNotables(week(240, 110, 6, 2), '2026-10-10');
    const again = planWeekNotables(week(240, 110, 6, 2), '2026-10-10');
    expect(again).toEqual(first);
  });

  it('an unread week plans nothing', () => {
    expect(planWeekNotables({ ok: false, thisWeek: { views: 500, paid: 9 }, lastWeek: { views: 1, paid: 0 } }, '2026-10-10')).toEqual([]);
  });
});

describe('the day run scan writes week notables once, and reports an unread week by name', () => {
  function fakePorts(week: WeekFacts | null) {
    const written = new Set<string>();
    const recorded: NotablePlan[] = [];
    const ports: NotablePorts = {
      readPaidOrders: async () => [],
      readClicks: async () => [],
      readEarlierSources: async () => [],
      readWeekCounts: async () => week,
      record: async (plan) => {
        if (written.has(plan.key)) return false;
        written.add(plan.key);
        recorded.push(plan);
        return true;
      },
    };
    return { ports, recorded };
  }
  const window = { now: NOW, localDay: '2026-10-10', dayStartIso: '2026-10-10T00:00:00.000Z', dayEndIso: '2026-10-11T00:00:00.000Z' };

  it('a real spike is written once; the same numbers on the next run write nothing new', async () => {
    const { ports, recorded } = fakePorts(week(240, 110, 0, 0));
    const first = await scanNotableSources(ports, window);
    expect(first.written).toBe(1);
    expect(recorded[0]).toMatchObject({ kind: 'week_up', mind: 'analyst' });
    const second = await scanNotableSources(ports, window);
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('an unread week is reported by name, and the rest of the scan still runs', async () => {
    const { ports } = fakePorts(null);
    const result = await scanNotableSources(ports, window);
    expect(result.unreadable).toContain('week');
  });

  it('a week with a failed count is reported by name and writes no week notable', async () => {
    const { ports, recorded } = fakePorts({ ok: false, thisWeek: { views: 500, paid: 9 }, lastWeek: { views: 1, paid: 0 } });
    const result = await scanNotableSources(ports, window);
    expect(result.unreadable).toContain('week');
    expect(recorded).toEqual([]);
  });
});

describe('the briefing shows the week in Money & readers', () => {
  const base: BriefingFacts = {
    articles: { ok: true, count: 0, titles: [] },
    orders: { ok: true, paidCount: 0, usdTotal: 0 },
    views: { ok: true, count: 0 },
    failures: { ok: true, count: 0, codes: [] },
  };
  const SINCE = '2026-10-09T12:00:00Z';

  it('shows the one sentence under Money & readers', () => {
    // A quiet day shows no sections, so the day has one real paid order to be not quiet.
    const result = buildBriefing({ ...base, orders: { ok: true, paidCount: 1, usdTotal: 24 }, weeks: week(240, 110, 3, 2) }, NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    const money = result.sections.find((section) => section.id === 'money')?.lines ?? [];
    expect(money).toContain(weekSentence(week(240, 110, 3, 2)));
  });

  it('says it cannot see last week, and the day is not quiet', () => {
    const result = buildBriefing({ ...base, weeks: { ok: false, thisWeek: { views: 0, paid: 0 }, lastWeek: { views: 0, paid: 0 } } }, NOW, SINCE, false);
    const money = result.sections.find((section) => section.id === 'money')?.lines ?? [];
    expect(money).toContain(CANNOT_SEE_LAST_WEEK);
    expect(result.quiet).toBe(false);
  });

  it('a week spike notable shows under Money & readers', () => {
    expect(BRIEFING_NOTABLE_KINDS).toContain('week_up');
    expect(BRIEFING_NOTABLE_KINDS).toContain('week_down');
    const result = buildBriefing(
      { ...base, notables: { ok: true, rows: [{ kind: 'week_up', title: 'Article views are up this week.', detail: '' }] } },
      NOW,
      SINCE,
      false,
    );
    const money = result.sections.find((section) => section.id === 'money')?.lines ?? [];
    expect(money).toContain('Article views are up this week.');
  });
});

describe('the migration allows the two week kinds and keeps every kind already allowed', () => {
  const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/20261018000000_notable_week_change.sql'), 'utf8');
  it('adds week_up and week_down', () => {
    expect(sql).toContain("'week_up'");
    expect(sql).toContain("'week_down'");
  });
  it('keeps the kinds from the door-failed migration', () => {
    for (const kind of ['takeover_changed', 'kill_changed', 'door_posted', 'door_failed', 'mind_failed', 'auditor_blocked', 'order_blocked', 'sale', 'product_click', 'traffic_new_kind', 'job_finished', 'pack_ready', 'article_changed', 'night_report_written']) {
      expect(sql, kind).toContain(`'${kind}'`);
    }
  });
  it('is additive and not applied', () => {
    expect(sql).toContain('NOT applied to production');
  });
});
