// Phase 4 freeze checks. Each test is one promise made at the end of Phase 4.
// Behaviour is checked with the real pure modules. Migrations and server files are read as text.
import { describe, expect, it } from 'vitest';
import renderSource from '../../scripts/pack-video.mjs?raw';
import vercelConfig from '../../vercel.json?raw';
import runDaySource from '../../supabase/functions/_shared/runDay.ts?raw';
import placementRunSource from '../../supabase/functions/_shared/placementRun.ts?raw';
import functionSource from '../../supabase/functions/minds-run-placement/index.ts?raw';
import buddyThinkFunctionSource from '../../supabase/functions/buddy-think/index.ts?raw';
import briefingSource from '../../supabase/functions/_shared/buddyBriefing.ts?raw';
import packRulesSource from '../../supabase/functions/_shared/packRules.ts?raw';
import packCopySource from '../../supabase/functions/_shared/packCopy.ts?raw';
import packMediaSource from '../../supabase/functions/_shared/packMedia.ts?raw';
import jobsSource from '../buddy/buddyJobs.ts?raw';
import changesSource from '../buddy/BuddyChanges.tsx?raw';
import { MINDS_CONTROLS_DEFAULTS } from '../buddy/minds/mindsControlsStore';
import { PACK_CHANNELS, PACK_PRODUCT_CAP, productProblem } from '../../supabase/functions/_shared/packRules';
import {
  CHANNEL_WINDOWS,
  TIME_WINDOWS,
  auditCopy,
  chooseProductsForCopy,
  suggestedTimeFor,
  type PackCopy,
} from '../../supabase/functions/_shared/packCopy';
import { sameTextKey } from '../../supabase/functions/_shared/packCopy';
import { planPackMedia, captionChunks, VIDEO_NOT_MADE_REASON } from '../../supabase/functions/_shared/packMedia';
import { describePackJob, parsePackRow } from '../buddy/buddyJobs';
import { buildBriefing, type BriefingFacts } from '../../supabase/functions/_shared/buddyBriefing';

// Every migration written in Phase 4 (all named 20261010...).
const MIGRATIONS = import.meta.glob('../../supabase/migrations/20261010*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const PHASE4_MIGRATION_NAMES = Object.keys(MIGRATIONS).map((path) => path.split('/').pop());
const ALL_MIGRATION_TEXT = Object.values(MIGRATIONS).join('\n');

const SHOP = [
  { id: 'p1', name: 'Calm Skin Routine Guide', isDigital: true, priceUsd: 12 },
  { id: 'p2', name: 'Dry Skin Checklist', isDigital: true, priceUsd: 5 },
  { id: 'p3', name: 'Night Care Bundle', isDigital: false, priceUsd: 24 },
];

const GOOD_COPY: PackCopy = {
  instagram: 'A calm routine for dry skin, with the Calm Skin Routine Guide that keeps the steps in order.',
  tiktok: 'Dry skin feels tight by midday. The Calm Skin Routine Guide puts the steps in one easy order.',
  facebook: 'If your skin feels dry after washing, start with one calm order of steps. The Dry Skin Checklist shows it.',
  pinterest: { title: 'Calm routine for dry skin', description: 'A simple order of steps for dry skin, with the Calm Skin Routine Guide.' },
};

const COUNTRY_WORDS = /nigeria|nigerian|lagos|abuja|naira|\bWAT\b/i;

describe('takeover and the four gated channels', () => {
  it('Takeover is off by default, in the code and in every Phase 4 migration', () => {
    expect(MINDS_CONTROLS_DEFAULTS.takeover).toBe(false);
    expect(ALL_MIGRATION_TEXT).not.toMatch(/takeover\s*=\s*true\s+(where|default)/i);
    expect(ALL_MIGRATION_TEXT).not.toMatch(/takeover\s+boolean\s+(not null\s+)?default\s+true/i);
  });

  it('exactly four gated channels: Instagram, TikTok, Facebook (Page) and Pinterest', () => {
    expect([...PACK_CHANNELS]).toEqual(['instagram', 'tiktok', 'facebook', 'pinterest']);
    const check = ALL_MIGRATION_TEXT.match(/channel text NOT NULL CHECK \(channel IN \(([^)]*)\)\)/);
    expect(check?.[1]).toBe("'instagram', 'tiktok', 'facebook', 'pinterest'");
  });

  it('no WhatsApp and no YouTube channel anywhere in the Phase 4 pack code', () => {
    for (const source of [packRulesSource, packCopySource, packMediaSource, jobsSource, ALL_MIGRATION_TEXT]) {
      expect(source).not.toMatch(/whatsapp/i);
    }
    expect(packRulesSource).toContain('YouTube is an auto channel in Phase 6, not here');
  });
});

describe('the AI never presses Post', () => {
  const FORBIDDEN = /graph\.facebook\.com|open\.tiktokapis|api\.pinterest|media_publish|content_publish|\/v5\/pins|pins\/create|instagram_graph/i;

  it('no Phase 4 file calls a Meta, TikTok or Pinterest posting address', () => {
    for (const source of [runDaySource, placementRunSource, functionSource, packRulesSource, packCopySource, packMediaSource, renderSource, jobsSource, changesSource, briefingSource, buddyThinkFunctionSource]) {
      expect(source).not.toMatch(FORBIDDEN);
    }
  });

  it('no Phase 4 file uses the old distribution adapters or the Daily Kit', () => {
    for (const source of [runDaySource, placementRunSource, functionSource, packCopySource, packMediaSource, jobsSource, changesSource]) {
      expect(source).not.toMatch(/distributionAdapters|automation-distribution|AutomationDistribution/);
    }
  });

  it('"I posted this" is the owner\'s own mark: one owner-only function, and no other write to a pack', () => {
    expect(ALL_MIGRATION_TEXT).toMatch(/REVOKE ALL ON FUNCTION public\.minds_mark_pack_posted\(uuid\) FROM PUBLIC, anon/);
    expect(ALL_MIGRATION_TEXT).toMatch(/GRANT EXECUTE ON FUNCTION public\.minds_mark_pack_posted\(uuid\) TO authenticated/);
    expect(jobsSource).not.toMatch(/from\('minds_packs'\)\s*\.update/);
    expect(jobsSource).toContain("rpc('minds_mark_pack_posted'");
  });

  it('the "I posted this" button only ever appears on a ready pack', () => {
    const base = {
      id: 'pack-1', channel: 'instagram', local_day: '2026-10-10', post_id: 'post-1', article_url: '/magazine/x',
      suggested_at_utc: '2026-10-10T13:00:00+00:00', suggested_label: 'Morning, US Eastern', caption: 'A calm routine.',
      pin_title: null, pin_description: null, video_path: null, product_ids: [], blocked_reason: null, posted_at: null,
      created_at: '2026-10-10T08:00:00Z',
    };
    const statuses = ['ready', 'blocked', 'posted_by_owner'] as const;
    const offered = statuses.map((status) => {
      const job = parsePackRow({ ...base, status, posted_at: status === 'posted_by_owner' ? '2026-10-10T15:00:00Z' : null, blocked_reason: status === 'blocked' ? 'video not made yet' : null }, {}, {});
      return job ? describePackJob(job).canMarkPosted : null;
    });
    expect(offered).toEqual([true, false, false]);
  });
});

describe('captions: four pieces, pairwise different, clean', () => {
  it('the good fixture is allowed by the Auditor', () => {
    expect(auditCopy(GOOD_COPY, SHOP)).toMatchObject({ verdict: 'allow', blockedChannels: [] });
  });

  it('the four captions for one article are pairwise different', () => {
    const keys = [GOOD_COPY.instagram, GOOD_COPY.tiktok, GOOD_COPY.facebook, GOOD_COPY.pinterest.title].map(sameTextKey);
    expect(new Set(keys).size).toBe(4);
  });

  it('an Auditor fixture with Instagram equal to TikTok fails, and TikTok is the channel named', () => {
    const copy = { ...GOOD_COPY, tiktok: GOOD_COPY.instagram };
    const verdict = auditCopy(copy, SHOP);
    expect(verdict.verdict).toBe('block');
    expect(verdict.blockedChannels).toContain('tiktok');
  });

  it('no dash, no country name, no non-US money, no medical promise in an allowed fixture', () => {
    const text = [GOOD_COPY.instagram, GOOD_COPY.tiktok, GOOD_COPY.facebook, GOOD_COPY.pinterest.title, GOOD_COPY.pinterest.description].join(' ');
    expect(text).not.toMatch(/[\u2014\u2013]/);
    expect(text).not.toMatch(COUNTRY_WORDS);
    expect(text).not.toMatch(/\u00a3|\u20ac|\u20a6|\bNGN\b|\bGBP\b|\bEUR\b/);
  });

  it('the Auditor blocks an em dash, a country name, and a cure claim', () => {
    expect(auditCopy({ ...GOOD_COPY, instagram: 'Calm steps \u2014 for dry skin.' }, SHOP).blockedChannels).toContain('instagram');
    expect(auditCopy({ ...GOOD_COPY, facebook: 'Made for dry skin in Lagos, with calm steps.' }, SHOP).blockedChannels).toContain('facebook');
    expect(auditCopy({ ...GOOD_COPY, tiktok: 'This cures dry skin overnight with one calm order of steps.' }, SHOP).blockedChannels).toContain('tiktok');
  });

  it('the copy checker keeps the same rule in the database: every checked word is in the migration too', () => {
    expect(ALL_MIGRATION_TEXT).toMatch(/nigeria\|nigerian\|lagos\|abuja\|naira/);
    expect(ALL_MIGRATION_TEXT).toMatch(/\\mWAT\\M/);
  });
});

describe('products: at most three per pack, digital first', () => {
  it('the cap is three, and a fourth product is refused', () => {
    expect(PACK_PRODUCT_CAP).toBe(3);
    expect(productProblem(['a', 'b', 'c', 'd'])).toBe('at most 3 products on a pack');
    expect(ALL_MIGRATION_TEXT).toMatch(/cardinality\(product_ids\) <= 3/);
    expect(ALL_MIGRATION_TEXT).toMatch(/at most 3 products on a pack/);
  });

  it('the copy writer is offered at most three products, digital ones first', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({ id: `x${index}`, name: `Item ${index}`, isDigital: index % 2 === 0, priceUsd: 4 }));
    const chosen = chooseProductsForCopy(many);
    expect(chosen).toHaveLength(3);
    expect(chosen.every((product) => product.isDigital)).toBe(true);
  });
});

describe('publishing times: UTC, plain labels, top-country windows only', () => {
  it('every window label names only a top-country region (US, UK, Ireland, Australia, New Zealand or Singapore)', () => {
    for (const window of TIME_WINDOWS) {
      expect(window.label, window.id).toMatch(/US|UK and Ireland|Australia|New Zealand|Singapore/);
      expect(window.label, window.id).not.toMatch(COUNTRY_WORDS);
    }
  });

  it('each channel offers only windows that exist', () => {
    for (const channel of PACK_CHANNELS) {
      for (const id of CHANNEL_WINDOWS[channel]) expect(TIME_WINDOWS.some((window) => window.id === id)).toBe(true);
    }
  });

  it('the suggested time is stored as UTC (ends in Z) with the plain label', () => {
    for (const channel of PACK_CHANNELS) {
      const suggestion = suggestedTimeFor(channel, '2026-10-10');
      expect(suggestion?.atUtc.endsWith('Z')).toBe(true);
      expect(suggestion?.label).toMatch(/US|UK and Ireland|Australia|New Zealand|Singapore/);
    }
  });

  it('the time picker never uses the owner\'s clock or a country name in its labels', () => {
    expect(packCopySource).not.toMatch(/Africa\/Lagos|Lagos|Nigeria|\bWAT\b/);
  });
});

describe('video: a real MP4 or an honest block, never a fake address', () => {
  it('with no MP4 the pack is blocked with "video not made yet", and no address is invented', () => {
    const plan = planPackMedia({ coverImage: '/assets/images/guide.webp', copyText: GOOD_COPY.instagram, mp4Path: null });
    expect(plan).toMatchObject({ status: 'blocked', reason: VIDEO_NOT_MADE_REASON, imagePath: '/assets/images/guide.webp' });
    expect(plan.chunks.length).toBeGreaterThan(0);
  });

  it('the caption chunks are at most three, each short, and burned-in ready', () => {
    const chunks = captionChunks(GOOD_COPY.instagram);
    expect(chunks.length).toBeLessThanOrEqual(3);
    for (const chunk of chunks) expect(chunk.replace(/\n/g, ' ').length).toBeLessThanOrEqual(60);
  });

  it('the renderer carries no test watermark, no country name, and a voice track (never silent)', () => {
    expect(renderSource).not.toMatch(/TEST ONLY|NOT FOR POSTING/);
    expect(renderSource).not.toMatch(/nigeria|lagos|naira/i);
    expect(renderSource).not.toContain("'-an'");
    expect(renderSource).toContain("'-c:a', 'aac'");
    expect(renderSource).toMatch(/PACK_VIDEO = Object\.freeze\(\{ width: 1080, height: 1920, fps: 30, seconds: 10/);
  });
});

describe('the pack write door and the schedule', () => {
  it('the one pack writer checks Takeover and Kill, and replaces a row only when the owner has not posted it', () => {
    const save = ALL_MIGRATION_TEXT.slice(ALL_MIGRATION_TEXT.indexOf('FUNCTION public.minds_save_pack('));
    expect(save).toContain('PERFORM public.minds_assert_can_act();');
    expect(save).toMatch(/ON CONFLICT \(owner_id, channel, local_day, post_id\) DO UPDATE/);
    expect(save).toMatch(/WHERE public\.minds_packs\.status <> 'posted_by_owner'/);
  });

  it('the daily timer is code only: the cron line stays commented out in the migration', () => {
    const daily = MIGRATIONS[Object.keys(MIGRATIONS).find((path) => path.includes('20261010090000')) ?? ''] ?? '';
    expect(daily).toContain('minds_queue_daily_run');
    expect(daily).not.toMatch(/^\s*SELECT cron\.schedule/m);
    expect(daily).toMatch(/--\s*SELECT cron\.schedule/);
  });

  it('every Phase 4 migration is additive and unapplied in this repository', () => {
    expect(PHASE4_MIGRATION_NAMES.sort()).toEqual([
      '20261010090000_minds_daily_run.sql',
      '20261010100000_minds_packs.sql',
      '20261010110000_minds_pack_posted.sql',
    ]);
    expect(ALL_MIGRATION_TEXT).not.toMatch(/\bDROP TABLE\b/i);
  });
});

describe('Your jobs and the briefing: real rows, honest about empty', () => {
  it('the Changes screen reads the owner\'s pack rows, not a fixed list', () => {
    expect(changesSource).toContain('listPackJobs()');
    expect(jobsSource).toContain(".from('minds_packs')");
  });

  it('a day with a ready pack is not quiet, and a day with none is quiet with the same words as before', () => {
    const base: BriefingFacts = {
      articles: { ok: true, count: 0, titles: [] },
      orders: { ok: true, paidCount: 0, usdTotal: 0 },
      views: { ok: true, count: 0 },
      failures: { ok: true, count: 0, codes: [] },
      packs: { ok: true, rows: [] },
    };
    expect(buildBriefing(base, new Date('2026-10-10T12:00:00Z'), '2026-10-10T08:00:00Z', false)).toMatchObject({ quiet: true, text: 'Quiet since you left.' });
    const withPack = buildBriefing(
      { ...base, packs: { ok: true, rows: [{ channel: 'instagram', status: 'ready', articleTitle: 'Night Routine', blockedReason: null }] } },
      new Date('2026-10-10T12:00:00Z'),
      '2026-10-10T08:00:00Z',
      false,
    );
    expect(withPack.quiet).toBe(false);
  });
});

describe('the earlier promises still hold', () => {
  it('/buddy/controls still redirects to /buddy', () => {
    const config = JSON.parse(vercelConfig) as { redirects: { source: string; destination: string; permanent: boolean }[] };
    expect(config.redirects).toContainEqual({ source: '/buddy/controls', destination: '/buddy', permanent: false });
  });
});
