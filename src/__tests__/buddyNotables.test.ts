import { describe, expect, it } from 'vitest';
import {
  BRIEFING_NOTABLE_KINDS,
  NOTHING_SENT_LINE,
  NOTABLE_LINE_LIMIT,
  briefingNotables,
  buildBriefing,
  doorSentLines,
  type BriefingFacts,
} from '../../supabase/functions/_shared/buddyBriefing';
import { doorFailNotices, type DoorOutcome } from '../../supabase/functions/_shared/runDoors';

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

function note(kind: string, title: string, detail = '') {
  return { kind, title, detail };
}

function sectionLines(result: ReturnType<typeof buildBriefing>, id: string): string[] {
  return result.sections.find((section) => section.id === id)?.lines ?? [];
}

describe('briefing reads the Phase 8 notables', () => {
  it('a sale, a product click and a new traffic source show under Money & readers', () => {
    const result = buildBriefing(
      facts({
        notables: {
          ok: true,
          rows: [note('sale', 'Paid order: USD 24.00.'), note('product_click', '3 product clicks today'), note('traffic_new_kind', 'New traffic source: Pinterest')],
        },
      }),
      NOW,
      SINCE,
      false,
    );
    const money = sectionLines(result, 'money');
    expect(money).toContain('Paid order: USD 24.00.');
    expect(money).toContain('3 product clicks today.');
    expect(money).toContain('New traffic source: Pinterest.');
  });

  it('a summary of free doors that posted shows under What went out', () => {
    const result = buildBriefing(
      facts({ notables: { ok: true, rows: [note('door_posted', '2 free doors posted today', 'The Executioner sent these.')] } }),
      NOW,
      SINCE,
      false,
    );
    expect(sectionLines(result, 'went_out')).toContain('2 free doors posted today.');
  });

  it('a blocked placement or order shows under Your jobs', () => {
    const result = buildBriefing(
      facts({ notables: { ok: true, rows: [note('auditor_blocked', 'The Auditor held a placement'), note('order_blocked', 'An order was blocked')] } }),
      NOW,
      SINCE,
      false,
    );
    const jobs = sectionLines(result, 'jobs');
    expect(jobs).toContain('The Auditor held a placement.');
    expect(jobs).toContain('An order was blocked.');
  });

  it('a failed door shows under Problems in its own sentence, and the next move says to look at the problems', () => {
    const result = buildBriefing(
      facts({ notables: { ok: true, rows: [note('door_failed', 'Did not go out to Flipboard', 'Flipboard did not take it: Feed was refused.')] } }),
      NOW,
      SINCE,
      false,
    );
    expect(sectionLines(result, 'problems')).toContain('Flipboard did not take it: Feed was refused.');
    expect(sectionLines(result, 'next')).toEqual(['Look at the problems above before anything else.']);
  });

  it('a mind that failed shows under Problems', () => {
    const result = buildBriefing(
      facts({ notables: { ok: true, rows: [note('mind_failed', 'The free doors could not run', 'Nothing was posted. Check the log.')] } }),
      NOW,
      SINCE,
      false,
    );
    expect(sectionLines(result, 'problems')).toContain('The free doors could not run.');
  });

  it('a ready pack makes the next move "post it by hand"', () => {
    const result = buildBriefing(facts({ notables: { ok: true, rows: [note('pack_ready', 'A pack is ready')] } }), NOW, SINCE, false);
    expect(sectionLines(result, 'next')).toEqual(['Post the ready pack by hand, then tap I posted this.']);
  });

  it('a notable alone means the day is not quiet', () => {
    const result = buildBriefing(facts({ notables: { ok: true, rows: [note('sale', 'Paid order.')] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
  });

  it('ignores kinds the briefing does not read, so a night report never becomes the briefing', () => {
    const rows = briefingNotables([
      { kind: 'night_report_written', title: 'Night report', detail: '' },
      { kind: 'article_changed', title: 'An article changed', detail: '' },
      { kind: 'sale', title: 'Paid order.', detail: '' },
    ]);
    expect(rows).toEqual([{ kind: 'sale', title: 'Paid order.', detail: '' }]);
    expect(BRIEFING_NOTABLE_KINDS).not.toContain('night_report_written');
    const quiet = buildBriefing(facts({ notables: { ok: true, rows: briefingNotables([{ kind: 'night_report_written', title: 'Night report' }]) } }), NOW, SINCE, false);
    expect(quiet.quiet).toBe(true);
  });

  it('says so when the notable read fails, and the day is not quiet', () => {
    const result = buildBriefing(facts({ notables: { ok: false, rows: [] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    expect(sectionLines(result, 'problems')).toContain('I cannot read the notable events yet.');
  });

  it('shows at most three lines from each notable kind', () => {
    const rows = Array.from({ length: 6 }, (_, index) => note('sale', `Paid order: USD ${index + 1}.00.`));
    const result = buildBriefing(facts({ notables: { ok: true, rows } }), NOW, SINCE, false);
    const money = sectionLines(result, 'money').filter((line) => line.startsWith('Paid order'));
    expect(money).toHaveLength(NOTABLE_LINE_LIMIT);
  });
});

describe('RSS doors are never said to have posted', () => {
  it('a posted RSS row says the feed was updated and the hub pinged, never posted', () => {
    const lines = doorSentLines({ ok: true, rows: [{ door: 'flipboard', status: 'posted', postTitle: 'Calm', errorNote: null }] });
    expect(lines).toEqual(['RSS updated and pinged for Flipboard: "Calm".']);
    expect(lines.join(' ')).not.toMatch(/Posted to/);
  });

  it('a failed RSS row says the ping did not take', () => {
    const lines = doorSentLines({ ok: true, rows: [{ door: 'google_news', status: 'failed', postTitle: 'Calm', errorNote: 'The hub did not answer.' }] });
    expect(lines).toEqual([NOTHING_SENT_LINE, 'Google News did not take the ping for "Calm". The hub did not answer.']);
  });

  it('a non-RSS posted row still says Posted to', () => {
    const lines = doorSentLines({ ok: true, rows: [{ door: 'pixelfed', status: 'posted', postTitle: 'Calm', errorNote: null }] });
    expect(lines).toEqual(['Posted to Pixelfed: "Calm".']);
  });
});

describe('a failed door send becomes a notable', () => {
  const outcomes: DoorOutcome[] = [
    { door: 'flipboard', outcome: 'failed', detail: 'Flipboard did not take it: Feed was refused.' },
    { door: 'discord', outcome: 'posted', detail: 'Posted to Discord: "Calm".' },
    { door: 'telegram', outcome: 'skipped', detail: 'Telegram: already posted today.' },
    { door: 'bluesky', outcome: 'not_connected', detail: 'Bluesky' },
    { door: 'mastodon', outcome: 'failed', detail: 'Mastodon did not take it: Rate limited.' },
  ];

  it('makes one notice per failed send, with the door name and the day in its key', () => {
    const notices = doorFailNotices(outcomes, '2026-10-10');
    expect(notices.map((item) => item.key)).toEqual(['door_failed:flipboard:2026-10-10', 'door_failed:mastodon:2026-10-10']);
    expect(notices[0]).toMatchObject({ mind: 'executioner', kind: 'door_failed', title: 'Did not go out to Flipboard' });
    expect(notices[0].detail).toBe('Flipboard did not take it: Feed was refused.');
  });

  it('posts, skips and not-connected doors are not notices', () => {
    const kinds = doorFailNotices(outcomes.filter((item) => item.outcome !== 'failed'), '2026-10-10');
    expect(kinds).toEqual([]);
  });

  it('keeps the title and the detail inside the database limits', () => {
    const [notice] = doorFailNotices([{ door: 'flipboard', outcome: 'failed', detail: 'x'.repeat(900) }], '2026-10-10');
    expect(notice.title.length).toBeLessThanOrEqual(160);
    expect(notice.detail.length).toBeLessThanOrEqual(500);
  });
});
