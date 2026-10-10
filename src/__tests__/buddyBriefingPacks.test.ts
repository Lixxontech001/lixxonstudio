import { describe, expect, it } from 'vitest';
import { PACK_LINE_LIMIT, QUIET_LINE, buildBriefing, briefingPacks, packLines, type BriefingFacts } from '../../supabase/functions/_shared/buddyBriefing';

const NOW = new Date('2026-10-10T12:00:00Z');
const SINCE = '2026-10-10T08:00:00Z';

function quietFacts(extra: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    articles: { ok: true, count: 0, titles: [] },
    orders: { ok: true, paidCount: 0, usdTotal: 0 },
    views: { ok: true, count: 0 },
    failures: { ok: true, count: 0, codes: [] },
    minds: { ok: true, rows: [] },
    waiting: { ok: true, count: 0 },
    applied: { ok: true, rows: [] },
    gaps: { ok: true, rows: [] },
    packs: { ok: true, rows: [] },
    ...extra,
  };
}

function jobs(result: ReturnType<typeof buildBriefing>): string[] {
  if (result.quiet) return [];
  return result.sections.find((section) => section.id === 'jobs')?.lines ?? [];
}

describe('briefing: pack lines in "Your jobs"', () => {
  it('a ready pack says it is ready to post by hand, with the channel and the article title', () => {
    const lines = packLines({
      ok: true,
      rows: [{ channel: 'instagram', status: 'ready', articleTitle: 'Easy Skincare Routine for Dry Skin', blockedReason: null }],
    });
    expect(lines).toEqual(['Instagram pack for "Easy Skincare Routine for Dry Skin" is ready to post by hand.']);
  });

  it('a blocked pack shows its plain reason, once, with a full stop', () => {
    const lines = packLines({
      ok: true,
      rows: [{ channel: 'pinterest', status: 'blocked', articleTitle: 'Night Routine', blockedReason: 'video not made yet.' }],
    });
    expect(lines).toEqual(['Pinterest pack for "Night Routine" is blocked: video not made yet.']);
  });

  it('a failed read is said plainly, not guessed', () => {
    expect(packLines({ ok: false, rows: [] })).toEqual(['I cannot read your packs yet.']);
  });

  it('no packs means no pack lines', () => {
    expect(packLines({ ok: true, rows: [] })).toEqual([]);
    expect(packLines(undefined)).toEqual([]);
  });

  it('at most three pack lines are shown', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ channel: 'facebook', status: 'ready', articleTitle: `Article ${index}`, blockedReason: null }));
    expect(packLines({ ok: true, rows })).toHaveLength(PACK_LINE_LIMIT);
  });

  it('a long title is clipped, and an unknown channel is named plainly', () => {
    const [line] = packLines({
      ok: true,
      rows: [{ channel: 'youtube', status: 'ready', articleTitle: 'x'.repeat(300), blockedReason: null }],
    });
    expect(line.startsWith('A channel pack for "')).toBe(true);
    expect(line.length).toBeLessThan(200);
  });
});

describe('briefing: rows from the database', () => {
  it('keeps only ready and blocked packs, and fills the article title from the lookup', () => {
    const rows = briefingPacks(
      [
        { channel: 'instagram', status: 'ready', blocked_reason: null, post_id: 'p1' },
        { channel: 'tiktok', status: 'posted_by_owner', blocked_reason: null, post_id: 'p1' },
        { channel: 'facebook', status: 'blocked', blocked_reason: 'video not made yet', post_id: 'missing' },
        { channel: 42, status: 'ready', post_id: 'p1' },
      ],
      { p1: 'Easy Skincare Routine for Dry Skin' },
    );
    expect(rows).toEqual([
      { channel: 'instagram', status: 'ready', articleTitle: 'Easy Skincare Routine for Dry Skin', blockedReason: null },
      { channel: 'facebook', status: 'blocked', articleTitle: 'an article', blockedReason: 'video not made yet' },
    ]);
  });
});

describe('briefing: the day with packs', () => {
  it('a day with a ready pack is not quiet, and says so under "Your jobs"', () => {
    const result = buildBriefing(
      quietFacts({ packs: { ok: true, rows: [{ channel: 'instagram', status: 'ready', articleTitle: 'Night Routine', blockedReason: null }] } }),
      NOW,
      SINCE,
      false,
    );
    expect(result.quiet).toBe(false);
    expect(jobs(result)).toContain('Instagram pack for "Night Routine" is ready to post by hand.');
  });

  it('a day with only a blocked pack is not quiet either', () => {
    const result = buildBriefing(
      quietFacts({ packs: { ok: true, rows: [{ channel: 'pinterest', status: 'blocked', articleTitle: 'Night Routine', blockedReason: 'video not made yet' }] } }),
      NOW,
      SINCE,
      false,
    );
    expect(result.quiet).toBe(false);
  });

  it('a day with no packs and nothing else stays quiet, with the same words as before', () => {
    expect(buildBriefing(quietFacts(), NOW, SINCE, false)).toEqual({ quiet: true, sections: [], text: QUIET_LINE });
  });

  it('a failed pack read keeps the day from looking quiet, and says it could not be read', () => {
    const result = buildBriefing(quietFacts({ packs: { ok: false, rows: [] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    expect(jobs(result)).toContain('I cannot read your packs yet.');
  });

  it('still shows the seven sections, in the same order', () => {
    const result = buildBriefing(
      quietFacts({ packs: { ok: true, rows: [{ channel: 'instagram', status: 'ready', articleTitle: 'Night Routine', blockedReason: null }] } }),
      NOW,
      SINCE,
      false,
    );
    if (result.quiet) throw new Error('expected a briefing');
    expect(result.sections.map((section) => section.id)).toEqual(['since', 'went_out', 'money', 'minds', 'problems', 'jobs', 'next']);
  });

  it('pack lines carry no dash, no country name and no non-US money', () => {
    const result = buildBriefing(
      quietFacts({
        packs: {
          ok: true,
          rows: [
            { channel: 'instagram', status: 'ready', articleTitle: 'Night Routine', blockedReason: null },
            { channel: 'pinterest', status: 'blocked', articleTitle: 'Night Routine', blockedReason: 'video not made yet' },
          ],
        },
      }),
      NOW,
      SINCE,
      false,
    );
    const text = jobs(result).join(' ');
    expect(text).not.toMatch(/[\u2014\u2013]/);
    expect(text).not.toMatch(/nigeria|lagos|naira|\bWAT\b|\u00a3|\u20ac/i);
  });
});
