import { describe, expect, it } from 'vitest';
import {
  BRIEFING_NOTABLE_KINDS,
  buildBriefing,
  doorSentLines,
  type BriefingFacts,
} from '../../supabase/functions/_shared/buddyBriefing';
import { DOORS, isDoorId, type DoorId } from '../../supabase/functions/_shared/doorRegistry';
import { isRssDoor } from '../../supabase/functions/_shared/rssHub';

// Phase B slice 2: the briefing reads every notable kind the minds write, shows each in the right section,
// and tells the truth about RSS pings. Quiet still needs every source read and nothing real.

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

describe('Briefing slice 2: the Auditor is a problem, not a job', () => {
  it('an Auditor block shows under Problems, and not under Your jobs', () => {
    const result = buildBriefing(facts({ notables: { ok: true, rows: [note('auditor_blocked', 'The Auditor held a placement')] } }), NOW, SINCE, false);
    expect(sectionLines(result, 'problems')).toContain('The Auditor held a placement.');
    expect(sectionLines(result, 'jobs')).not.toContain('The Auditor held a placement.');
  });

  it('an order blocked still shows under Your jobs', () => {
    const result = buildBriefing(facts({ notables: { ok: true, rows: [note('order_blocked', 'An order was blocked')] } }), NOW, SINCE, false);
    expect(sectionLines(result, 'jobs')).toContain('An order was blocked.');
  });

  it('a mind that failed shows under Problems', () => {
    const result = buildBriefing(facts({ notables: { ok: true, rows: [note('mind_failed', 'The Analyst could not finish')] } }), NOW, SINCE, false);
    expect(sectionLines(result, 'problems')).toContain('The Analyst could not finish.');
  });
});

describe('Briefing slice 2: Takeover and Kill changes show under Since you left', () => {
  it('a Takeover change is news, shown under Since you left, so the day is not quiet', () => {
    const result = buildBriefing(facts({ notables: { ok: true, rows: [note('takeover_changed', 'Takeover turned on')] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    expect(sectionLines(result, 'since')).toContain('Takeover turned on.');
  });

  it('a Kill change shows under Since you left', () => {
    const result = buildBriefing(facts({ notables: { ok: true, rows: [note('kill_changed', 'Kill set to analyst')] } }), NOW, SINCE, false);
    expect(sectionLines(result, 'since')).toContain('Kill set to analyst.');
  });
});

describe('Briefing slice 2: every notable kind the minds write reaches the briefing', () => {
  // kind -> the title the writer uses, and the section it must reach. pack_ready is shown from the packs read.
  const WRITTEN: Array<[string, string, string]> = [
    ['takeover_changed', 'Takeover turned on', 'since'],
    ['kill_changed', 'Kill set to none', 'since'],
    ['door_posted', '2 free doors posted today', 'went_out'],
    ['door_failed', 'Telegram did not post "Spring kit"', 'problems'],
    ['mind_failed', 'The Analyst could not finish', 'problems'],
    ['auditor_blocked', 'The Auditor held a placement', 'problems'],
    ['order_blocked', 'An order was blocked', 'jobs'],
    ['sale', 'Paid order: USD 24.00.', 'money'],
    ['product_click', '3 product clicks today', 'money'],
    ['traffic_new_kind', 'New traffic source: Pinterest', 'money'],
  ];

  it('each written kind is in the read list', () => {
    for (const [kind] of WRITTEN) expect(BRIEFING_NOTABLE_KINDS).toContain(kind);
    expect(BRIEFING_NOTABLE_KINDS).toContain('pack_ready');
  });

  it('each written kind makes the day not quiet and shows its title in its section', () => {
    for (const [kind, title, section] of WRITTEN) {
      const result = buildBriefing(facts({ notables: { ok: true, rows: [note(kind, title, kind === 'door_failed' ? title : '')] } }), NOW, SINCE, false);
      expect(result.quiet, kind).toBe(false);
      const lines = sectionLines(result, section).join(' ');
      expect(lines, `${kind} in ${section}`).toContain(title.replace(/[.!?]+$/, ''));
    }
  });

  it('a pack that is ready to post by hand is not quiet, and shows from the packs read', () => {
    const result = buildBriefing(
      facts({
        notables: { ok: true, rows: [note('pack_ready', 'Instagram pack ready')] },
        packs: { ok: true, rows: [{ channel: 'instagram', status: 'ready', articleTitle: 'Spring kit', blockedReason: null }] },
      }),
      NOW,
      SINCE,
      false,
    );
    expect(result.quiet).toBe(false);
    expect(sectionLines(result, 'jobs')).toContain('Instagram pack for "Spring kit" is ready to post by hand.');
  });

  it('an unread notable source says so in Problems, and the day is not quiet', () => {
    const result = buildBriefing(facts({ notables: { ok: false, rows: [] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    expect(sectionLines(result, 'problems')).toContain('I cannot read the notable events yet.');
  });

  it('the quiet rule is unchanged: nothing real and every source read is quiet', () => {
    const result = buildBriefing(facts({ notables: { ok: true, rows: [] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(true);
  });
});

describe('Briefing slice 2: RSS pings are told as pings, never as posts', () => {
  const rssDoor = (Object.keys(DOORS) as string[]).find((id) => isDoorId(id) && isRssDoor(id)) as DoorId | undefined;

  it('there is at least one RSS door to test against', () => {
    expect(rssDoor).toBeDefined();
  });

  it('a posted RSS row says the feed was updated and pinged, not posted', () => {
    const lines = doorSentLines({ ok: true, rows: [{ door: rssDoor as string, status: 'posted', postTitle: 'Spring kit', errorNote: null }] });
    const text = lines.join(' ');
    expect(text).toContain('RSS updated and pinged');
    expect(text).not.toMatch(/Posted to /);
  });

  it('a failed RSS ping says the hub did not take the ping', () => {
    const lines = doorSentLines({ ok: true, rows: [{ door: rssDoor as string, status: 'failed', postTitle: 'Spring kit', errorNote: 'Hub timed out.' }] });
    expect(lines.join(' ')).toContain('did not take the ping');
  });

  it('no line in the briefing names Flipboard', () => {
    const result = buildBriefing(
      facts({ notables: { ok: true, rows: [note('door_posted', 'RSS updated and pinged for a feed')] } }),
      NOW,
      SINCE,
      false,
    );
    expect(result.text).not.toMatch(/flipboard/i);
  });
});
