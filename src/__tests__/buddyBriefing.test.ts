import { describe, expect, it } from 'vitest';
import {
  buildBriefing,
  briefingText,
  describeAway,
  FIRST_VISIT_WINDOW_HOURS,
  QUIET_LINE,
  type BriefingFacts,
} from '../../supabase/functions/_shared/buddyBriefing';

const NOW = new Date('2026-10-09T12:00:00Z');
const SINCE = '2026-10-08T12:00:00Z';

function facts(overrides: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    articles: { ok: true, count: 0, titles: [] },
    orders: { ok: true, paidCount: 0, usdTotal: 0 },
    views: { ok: true, count: 0 },
    failures: { ok: true, count: 0, codes: [] },
    ...overrides,
  };
}

function sectionLines(result: ReturnType<typeof buildBriefing>, id: string): string[] {
  return result.sections.find((section) => section.id === id)?.lines ?? [];
}

describe('Buddy briefing rules: quiet case', () => {
  it('says quiet only when every source was read and nothing real happened', () => {
    const result = buildBriefing(facts(), NOW, SINCE, false);
    expect(result).toEqual({ quiet: true, sections: [], text: QUIET_LINE });
    expect(QUIET_LINE).toBe('Quiet since you left.');
  });

  it('is not quiet when a source could not be read, even if the readable ones are empty', () => {
    const orders = buildBriefing(facts({ orders: { ok: false, paidCount: 0, usdTotal: 0 } }), NOW, SINCE, false);
    expect(orders.quiet).toBe(false);
    expect(sectionLines(orders, 'money')).toContain('I cannot read orders yet.');

    const failures = buildBriefing(facts({ failures: { ok: false, count: 0, codes: [] } }), NOW, SINCE, false);
    expect(failures.quiet).toBe(false);
    expect(sectionLines(failures, 'problems')).toEqual(['I cannot read the error log yet.']);
  });

  it('is not quiet when there is a new article, a paid order or a failed step', () => {
    expect(buildBriefing(facts({ articles: { ok: true, count: 1, titles: ['A'] } }), NOW, SINCE, false).quiet).toBe(false);
    expect(buildBriefing(facts({ orders: { ok: true, paidCount: 1, usdTotal: 9 } }), NOW, SINCE, false).quiet).toBe(false);
    expect(buildBriefing(facts({ failures: { ok: true, count: 2, codes: ['X'] } }), NOW, SINCE, false).quiet).toBe(false);
  });

  it('does not count article views as news on their own', () => {
    const result = buildBriefing(facts({ views: { ok: true, count: 40 } }), NOW, SINCE, false);
    expect(result.quiet).toBe(true);
  });
});

describe('Buddy briefing rules: sections and real numbers', () => {
  it('lists the seven sections in the agreed order', () => {
    const result = buildBriefing(facts({ articles: { ok: true, count: 1, titles: ['Hello'] } }), NOW, SINCE, false);
    expect(result.sections.map((section) => section.title)).toEqual([
      'Since you left',
      'What went out',
      'Money & readers',
      'The five minds',
      'Problems',
      'Your jobs',
      'Your next move',
    ]);
  });

  it('uses the fixed honest lines for what did not go out and what is not running', () => {
    const result = buildBriefing(facts({ articles: { ok: true, count: 1, titles: ['Hello'] } }), NOW, SINCE, false);
    expect(sectionLines(result, 'went_out')[0]).toBe('No mind has sent anything out.');
    expect(sectionLines(result, 'minds')).toEqual(["I cannot read the minds' log yet."]);
    expect(sectionLines(result, 'jobs')).toEqual(['I cannot read your orders yet.']);
  });

  it('states paid orders in USD with the real total and count', () => {
    const result = buildBriefing(facts({ orders: { ok: true, paidCount: 2, usdTotal: 58.5 } }), NOW, SINCE, false);
    expect(sectionLines(result, 'money')[0]).toBe('2 paid orders since you left, USD 58.50 in total.');
  });

  it('lists article titles and says how many more there are', () => {
    const result = buildBriefing(
      facts({ articles: { ok: true, count: 7, titles: ['One', 'Two'] } }),
      NOW,
      SINCE,
      false,
    );
    expect(sectionLines(result, 'went_out')[1]).toBe('7 new articles are live: "One", "Two" and 5 more.');
  });

  it('names failed steps by their short codes only', () => {
    const result = buildBriefing(facts({ failures: { ok: true, count: 1, codes: ['PUBLISH_FAILED'] } }), NOW, SINCE, false);
    expect(sectionLines(result, 'problems')).toEqual(['1 failed automation step since you left (PUBLISH_FAILED).']);
  });

  it('keeps the plain-text version in step with the sections', () => {
    const result = buildBriefing(facts({ articles: { ok: true, count: 1, titles: ['Hello'] } }), NOW, SINCE, false);
    expect(result.text).toBe(briefingText(result.sections));
    expect(result.text.split('\n')).toHaveLength(7);
  });
});

describe('Buddy briefing rules: since you left and first visit', () => {
  it('describes time away in plain words', () => {
    expect(describeAway(10 * 60_000)).toBe('less than an hour');
    expect(describeAway(60 * 60_000)).toBe('about 1 hour');
    expect(describeAway(5 * 3_600_000)).toBe('about 5 hours');
    expect(describeAway(3 * 86_400_000)).toBe('about 3 days');
  });

  it('explains a first visit as a look back over the window', () => {
    const result = buildBriefing(facts({ articles: { ok: true, count: 1, titles: ['A'] } }), NOW, SINCE, true);
    expect(sectionLines(result, 'since')[0]).toBe(`First visit here. Buddy looks back ${FIRST_VISIT_WINDOW_HOURS} hours.`);
  });

  it('measures time away from the last Continue on later visits', () => {
    const result = buildBriefing(facts({ articles: { ok: true, count: 1, titles: ['A'] } }), NOW, SINCE, false);
    expect(sectionLines(result, 'since')[0]).toBe('You were away for about 24 hours.');
  });
});

describe('Buddy briefing rules: copy rules', () => {
  it('never names a country, city or local currency in Buddy copy, and uses no dashes', () => {
    const busy = facts({
      articles: { ok: true, count: 3, titles: ['Hello', 'Second', 'Third'] },
      orders: { ok: true, paidCount: 4, usdTotal: 120 },
      views: { ok: true, count: 12 },
      failures: { ok: true, count: 1, codes: ['SCHEDULE_FAILED'] },
    });
    const text = buildBriefing(busy, NOW, SINCE, true).text;
    expect(text).not.toMatch(/Nigeria|Naira|Lagos|NGN/i);
    expect(text).not.toContain('\u2014');
    expect(text).not.toContain('\u2013');
  });
});
