import { describe, expect, it } from 'vitest';
import {
  appliedLines,
  briefingApplied,
  briefingGaps,
  buildBriefing,
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
    minds: { ok: true, rows: [] },
    waiting: { ok: true, count: 0 },
    applied: { ok: true, rows: [] },
    gaps: { ok: true, rows: [] },
    ...overrides,
  };
}

function lines(result: ReturnType<typeof buildBriefing>, id: string): string[] {
  return result.sections.find((section) => section.id === id)?.lines ?? [];
}

describe('the briefing reports applied changes in chief-of-staff voice', () => {
  it('one line per change: what was added, to which article, and that one paragraph changed', () => {
    const result = buildBriefing(
      facts({ applied: { ok: true, rows: [{ postTitle: 'Easy Skincare Routine', productNames: ['Calm Skin Routine Guide'] }] } }),
      NOW,
      SINCE,
      false,
    );
    expect(result.quiet).toBe(false);
    expect(lines(result, 'went_out')).toContain('I added Calm Skin Routine Guide to "Easy Skincare Routine". One paragraph changed.');
    expect(lines(result, 'went_out')[0]).toBe('No mind has sent anything out.');
  });

  it('a change that could not be read is said plainly, not left out', () => {
    const result = buildBriefing(facts({ applied: { ok: false, rows: [] } }), NOW, SINCE, false);
    expect(lines(result, 'went_out')).toContain('I cannot read the article changes yet.');
    expect(result.quiet).toBe(false);
  });

  it('at most five change lines are shown', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ postTitle: `Article ${i}`, productNames: ['A'] }));
    expect(appliedLines({ ok: true, rows })).toHaveLength(5);
  });
});

describe('product gaps are a job for the owner, in the Your jobs section', () => {
  it('each open gap asks the owner to create a product, and is not a new section', () => {
    const result = buildBriefing(facts({ gaps: { ok: true, rows: [{ angle: 'Night routine for oily skin' }] } }), NOW, SINCE, false);
    expect(lines(result, 'jobs')).toContain('No product fits "Night routine for oily skin" yet. Create one in the shop, then ask me again.');
    expect(result.sections.map((section) => section.id)).not.toContain('gaps');
  });

  it('an open gap means the day is not quiet', () => {
    const result = buildBriefing(facts({ gaps: { ok: true, rows: [{ angle: 'x' }] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
  });

  it('a gap read that failed is said plainly', () => {
    const result = buildBriefing(facts({ gaps: { ok: false, rows: [] } }), NOW, SINCE, false);
    expect(lines(result, 'jobs')).toContain('I cannot read the product gaps yet.');
  });
});

describe('quiet days stay honest', () => {
  it('says quiet only when no change and no gap exists and every source was read', () => {
    expect(buildBriefing(facts(), NOW, SINCE, false)).toEqual({ quiet: true, sections: [], text: QUIET_LINE });
  });

  it('an unreadable change list means the day is not quiet, even when the rest is empty', () => {
    expect(buildBriefing(facts({ applied: { ok: false, rows: [] } }), NOW, SINCE, false).quiet).toBe(false);
    expect(buildBriefing(facts({ gaps: { ok: false, rows: [] } }), NOW, SINCE, false).quiet).toBe(false);
  });
});

describe('Money & readers uses real reads only', () => {
  it('its lines come from the paid orders and article views that were read, nothing else', () => {
    const result = buildBriefing(
      facts({ orders: { ok: true, paidCount: 2, usdTotal: 31.5 }, views: { ok: true, count: 14 } }),
      NOW,
      SINCE,
      false,
    );
    expect(lines(result, 'money')).toEqual([
      '2 paid orders since you left, USD 31.50 in total.',
      '14 article views since you left.',
    ]);
  });

  it('a money read that failed is said plainly, never shown as zero', () => {
    const result = buildBriefing(facts({ orders: { ok: false, paidCount: 0, usdTotal: 0 } }), NOW, SINCE, false);
    expect(lines(result, 'money')[0]).toBe('I cannot read orders yet.');
  });
});

describe('the mapping from database rows', () => {
  it('builds each change from its article title and product names, with fallbacks for missing ones', () => {
    const rows = briefingApplied(
      [
        { post_id: 'p1', product_ids: ['a', 'missing'] },
        { post_id: 'gone', product_ids: [] },
        { post_id: null, product_ids: ['a'] },
      ],
      { p1: 'Guide' },
      { a: 'Calm Skin Routine Guide' },
    );
    expect(rows).toEqual([
      { postTitle: 'Guide', productNames: ['Calm Skin Routine Guide'] },
      { postTitle: 'an article', productNames: [] },
    ]);
  });

  it('keeps only gap angles that are real text', () => {
    expect(briefingGaps([{ angle: 'Night routine' }, { angle: '   ' }, { angle: 5 }])).toEqual([{ angle: 'Night routine' }]);
  });
});
