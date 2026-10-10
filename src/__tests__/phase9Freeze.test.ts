// @vitest-environment node
// Phase 9 freeze. The checks call the real briefing, night writer and door code with small local fixtures and fakes.
// Wiring checks read the source. Nothing here reaches a live door, a live database, a live voice or a phone.
// Nothing here merges, deploys, or applies a migration.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildBriefing, type BriefingFacts } from '../../supabase/functions/_shared/buddyBriefing';
import { NOTHING_RAN_LINE, writeNightReport, type NightReportSource } from '../../supabase/functions/_shared/mindsNightReport';
import { planSaleNotables } from '../../supabase/functions/_shared/notableSources';
import { OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';
import { DEFAULT_VIDEO_TEMPLATE } from '../../scripts/video-template.mjs';
import { mp4HasAudioTrack } from '../../scripts/pack-video.mjs';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const readBytes = (file: string) => new Uint8Array(readFileSync(join(ROOT, file)));

const NOW = new Date('2026-10-10T08:00:00Z');
const SINCE = '2026-10-09T08:00:00Z';
const GATED = ['instagram', 'tiktok', 'facebook', 'pinterest'];
const RSS_FOUR = ['flipboard', 'google_news', 'microsoft_start', 'smartnews'];

/** Every briefing source read as clean and empty, so one fixture line can be tested alone. */
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
    packs: { ok: true, rows: [] },
    doors: { ok: true, rows: [] },
    notables: { ok: true, rows: [] },
    messages: { ok: true, count: 0 },
    ...overrides,
  };
}

function sectionLines(result: ReturnType<typeof buildBriefing>, id: string): string[] {
  if (result.quiet) return [];
  return result.sections.find((section) => section.id === id)?.lines ?? [];
}

describe('Phase 9 freeze: Takeover is off by default', () => {
  it('the saved Takeover switch still defaults to off', () => {
    expect(read('supabase/migrations/20261009140000_minds_controls.sql')).toMatch(/takeover boolean NOT NULL DEFAULT false/);
  });

  it('no Phase 9 migration sets Takeover to true, in a default or in a seed', () => {
    const phase9 = [
      'supabase/migrations/20261015000000_notable_door_failed.sql',
      'supabase/migrations/20261015010000_video_template_clear_name.sql',
      'supabase/migrations/20261015020000_minds_controls_change_source.sql',
      'supabase/migrations/20261016000000_buddy_night_clock.sql',
    ];
    for (const file of phase9) {
      expect(read(file), file).not.toMatch(/takeover[^;]*\btrue\b/i);
    }
  });
});

describe('Phase 9 freeze: the briefing reads the minds\' notables', () => {
  it('a paid order fixture from the real sale rule shows in Money & readers, and the day is not quiet', () => {
    const [plan] = planSaleNotables([{ id: 'ord_phase9_fixture_1', amount: 24, currency: 'USD' }]);
    const result = buildBriefing(
      facts({ notables: { ok: true, rows: [{ kind: plan.kind, title: plan.title, detail: '' }] } }),
      NOW,
      SINCE,
      false,
    );
    expect(result.quiet).toBe(false);
    expect(sectionLines(result, 'money')).toContain('Paid order: USD 24.00.');
  });

  it('the briefing keeps its seven sections in order', () => {
    const result = buildBriefing(facts({ articles: { ok: true, count: 1, titles: ['Fixture article'] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    expect(result.sections.map((section) => section.id)).toEqual(['since', 'went_out', 'money', 'minds', 'problems', 'jobs', 'next']);
  });
});

describe('Phase 9 freeze: a failed door send goes to Problems', () => {
  it('a door_failed notable shows its sentence under Problems, not under What went out', () => {
    const result = buildBriefing(
      facts({
        notables: {
          ok: true,
          rows: [{ kind: 'door_failed', title: 'Did not go out to Telegram', detail: 'Telegram said no. Nothing was posted.' }],
        },
      }),
      NOW,
      SINCE,
      false,
    );
    expect(result.quiet).toBe(false);
    expect(sectionLines(result, 'problems')).toContain('Telegram said no. Nothing was posted.');
    expect(sectionLines(result, 'went_out').join(' ')).not.toContain('Did not go out');
  });
});

describe('Phase 9 freeze: the night report writer is callable, and never the morning briefing', () => {
  it('the writer runs on a fake source, writes an honest empty night, and reports ran false', async () => {
    const saved: Array<{ report_date: string; title: string; body: string }> = [];
    const source: NightReportSource = {
      readLog: vi.fn(async () => []),
      readEvents: vi.fn(async () => []),
      readOrders: vi.fn(async () => []),
      saveReport: vi.fn(async (row) => {
        saved.push(row);
        return 'written' as const;
      }),
    };
    const result = await writeNightReport(source, '2026-10-09');
    expect(result).toEqual({ status: 'written', ran: false });
    expect(saved).toHaveLength(1);
    expect(saved[0].body).toContain(NOTHING_RAN_LINE);
  });

  it('the morning briefing never calls the night writer or the night clock', () => {
    const briefing = read('supabase/functions/_shared/buddyBriefing.ts');
    const think = read('supabase/functions/buddy-think/index.ts');
    for (const text of [briefing, think]) {
      expect(text).not.toContain('writeNightReport');
      expect(text).not.toContain('runNightClock');
      expect(text).not.toContain('serviceNightReportSource');
    }
  });
});

describe('Phase 9 freeze: a reader message is only a count, and Buddy never replies to it', () => {
  it('one message says "There is a message for you."', () => {
    const result = buildBriefing(facts({ messages: { ok: true, count: 1 } }), NOW, SINCE, false);
    expect(sectionLines(result, 'money')).toContain('There is a message for you.');
  });

  it('the reader message read is a count only, and buddy-think never writes to the reader tables or sends mail', () => {
    const think = read('supabase/functions/buddy-think/index.ts');
    expect(think).toMatch(/\.from\("contact_messages"\)\s*\.select\("id", \{ count: "exact", head: true \}\)/);
    expect(think).not.toMatch(/contact_messages[^;]*\.(insert|update|upsert|delete)\(/);
    expect(think).not.toMatch(/resend|sendgrid|smtp|sendMail/i);
  });
});

describe('Phase 9 freeze: twenty doors, four gated, sixteen auto', () => {
  it('sixteen doors are open to the day run, and the four RSS doors are among them', () => {
    expect(OPEN_DOORS).toHaveLength(16);
    for (const door of RSS_FOUR) expect(OPEN_DOORS).toContain(door);
  });

  it('the four gated channels are not doors, so the day run never sends to them', () => {
    for (const channel of GATED) expect(DOOR_IDS as readonly string[]).not.toContain(channel);
  });
});

describe('Phase 9 freeze: the video template and the fixture video', () => {
  it('the default video template name has no city in it', () => {
    expect(DEFAULT_VIDEO_TEMPLATE.name).toBe('Clear daylight (default)');
    expect(JSON.stringify(DEFAULT_VIDEO_TEMPLATE)).not.toMatch(/Lagos|Nigeria|Naira/);
  });

  it('the fixture MP4 still has an audio track, and the silent one does not', () => {
    expect(mp4HasAudioTrack(readBytes('src/__tests__/fixtures/pack-media/tiny-voiced.mp4'))).toBe(true);
    expect(mp4HasAudioTrack(readBytes('src/__tests__/fixtures/pack-media/tiny.mp4'))).toBe(false);
  });
});

describe('Phase 9 freeze: no owner route to the old senders', () => {
  it('the admin shell and its sidebar name no WhatsApp, Facebook or Pinterest sender and no old Distribution link', () => {
    for (const file of ['src/admin/AdminApp.tsx', 'src/admin/AdminLayout.tsx']) {
      expect(read(file), file).not.toMatch(/whatsapp|pinterest|facebook/i);
      expect(read(file), file).not.toContain('/admin/automation/distribution\'');
    }
  });

  it('the old Distribution address only redirects, and the old share library is not imported by any owner page', () => {
    expect(read('src/admin/AdminApp.tsx')).toContain('RetiredDistributionRedirect');
    for (const file of ['src/admin/AdminApp.tsx', 'src/admin/AdminLayout.tsx', 'src/buddy/BuddyEntry.tsx']) {
      expect(read(file), file).not.toMatch(/lib\/automationDistribution/);
    }
  });
});

describe('Phase 9 freeze: nothing is applied or shipped by this phase', () => {
  it('every Phase 9 migration says it is not applied to production', () => {
    const phase9 = [
      'supabase/migrations/20261015000000_notable_door_failed.sql',
      'supabase/migrations/20261015010000_video_template_clear_name.sql',
      'supabase/migrations/20261015020000_minds_controls_change_source.sql',
      'supabase/migrations/20261016000000_buddy_night_clock.sql',
    ];
    for (const file of phase9) {
      expect(read(file), file).toMatch(/not applied/i);
    }
  });
});
