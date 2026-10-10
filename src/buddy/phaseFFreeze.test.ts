// @vitest-environment node
// Phase F freeze. One group per section of the Phase F lock list (PHASE_F_INVENTORY.md).
// Behaviour is checked through the real pure functions wherever one exists. Source checks are used only for copy
// strings and file-level rules that have no function. No network, no live keys, no live brain, no live door, no
// live push, no database. Nothing here merges, deploys, or applies a migration. If a lock breaks, this file fails.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORDERS, REFUSAL_LINE, gateOrder, refusedRequest } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { routeMessage } from '../../supabase/functions/_shared/buddyRouter';
import { BRIEFING_NOTABLE_KINDS, QUIET_LINE, buildBriefing, type BriefingFacts } from '../../supabase/functions/_shared/buddyBriefing';
import { planWeekNotables, weekDirection, CANNOT_SEE_LAST_WEEK, VIEW_FLOOR } from '../../supabase/functions/_shared/buddyWeek';
import { BUZZ_KINDS } from '../../supabase/functions/_shared/notablePush';
import { BRAIN_IDS, BRAIN_SLOTS, tryableBrains } from '../../supabase/functions/_shared/brains';
import { DOOR_IDS, DOORS, doorStatus, isDoorId } from '../../supabase/functions/_shared/doorRegistry';
import { DOOR_MEDIA, OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';
import { RSS_DOORS } from '../../supabase/functions/_shared/rssHub';
import { HOWTO_DOORS, brainHowToReply, howToDoor } from '../../supabase/functions/_shared/buddyHowTo';
import { TOP_COUNTRIES } from '../../supabase/functions/_shared/packCopy';
import { copyProblem, PACK_PRODUCT_CAP } from '../../supabase/functions/_shared/packRules';
import {
  PLACEMENT_MAX_PRODUCTS,
  PLACEMENT_MAX_SENTENCES,
  PLACEMENT_MAX_WORDS,
  auditPlacement,
  digitalFirst,
  type ShopProduct,
} from '../../supabase/functions/_shared/productPlacement';
import { PROPOSAL_KINDS, LIVING_MINDS } from '../../supabase/functions/_shared/buddyLivingMinds';
import { AUDITOR_REFUSAL, CONTROL_MINDS, parseControlRequest } from '../../supabase/functions/_shared/buddyControls';
import { TAKEOVER_OFF_DETAIL, planDayRun } from '../../supabase/functions/_shared/runDay';
import { DEFAULT_VIBE, VIBES } from './buddyVibes';
import { KILL_OPTIONS, MIND_KEYS, MINDS } from './minds/mindRoster';
import { HIDDEN_DISPLAY_CURRENCIES } from '../lib/money';
import { LAGOS_TIME_ZONE } from '../lib/articleIntake';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const exists = (file: string) => existsSync(join(ROOT, file));
const sorted = (values: readonly string[]) => [...values].sort();
const NOW = new Date('2026-10-10T12:00:00Z');
const SINCE = '2026-10-09T12:00:00Z';

// Every product file under the given folders (no tests, no declaration files).
function productFiles(dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    const full = join(ROOT, dir);
    if (!existsSync(full)) return;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\.|__tests__|\.d\.ts$/.test(entry.name)) out.push(rel);
    }
  };
  dirs.forEach(walk);
  return out;
}
const SCREEN_DIRS = ['src/admin', 'src/buddy', 'src/components', 'src/pages'];

// An empty briefing where every source was read and found nothing.
function emptyFacts(overrides: Partial<BriefingFacts> = {}): BriefingFacts {
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
    weeks: { ok: true, thisWeek: { views: 0, paid: 0 }, lastWeek: { views: 0, paid: 0 } },
    commentsWaiting: { ok: true, count: 0 },
    refundsOpen: { ok: true, count: 0 },
    cartsAbandoned: { ok: true, count: 0 },
    ...overrides,
  };
}

describe('Phase F freeze: Buddy', () => {
  it('only Buddy talks: no mind has a chat route or a chat box', () => {
    expect(read('src/App.tsx')).not.toMatch(/mind[-_]?chat|chat[-_]?with[-_]?mind/i);
    expect(read('src/admin/pages/AdminMinds.tsx')).not.toMatch(/<textarea/);
  });

  it('asking about a mind answers from the daily log, not a guess', () => {
    expect(routeMessage('How is the Analyst doing?', null)).toEqual({ kind: 'mind_log', mind: 'analyst' });
    expect(routeMessage('What is the Executioner doing?', null)).toEqual({ kind: 'mind_log', mind: 'executioner' });
  });

  it('order lines say waiting when Takeover is off, and nothing runs', () => {
    expect(TAKEOVER_OFF_DETAIL).toBe('Takeover is off. Nothing runs. Your orders stay waiting.');
    const plan = planDayRun({ localDay: '2026-10-10', trigger: 'owner', takeover: false, killScope: 'none', waiting: [] });
    expect(JSON.stringify(plan)).toContain('Your orders stay waiting.');
  });

  it('greeting has Continue; new chat and past chats exist', () => {
    expect(read('src/buddy/BuddyGreeting.tsx')).toContain('Continue');
    const chat = read('src/buddy/BuddyChat.tsx');
    expect(chat).toContain('New chat');
    expect(chat).toContain('Past chats');
  });

  it('four looks: Noir Gold default, Ivory Silk, Velvet Opera, Porcelain, in that order', () => {
    expect(VIBES.map((vibe) => vibe.id)).toEqual(['noir-gold', 'ivory-silk', 'velvet-opera', 'porcelain']);
    expect(VIBES.map((vibe) => vibe.name)).toEqual(['Noir Gold', 'Ivory Silk', 'Velvet Opera', 'Porcelain']);
    expect(DEFAULT_VIBE).toBe('noir-gold');
  });

  it('Buddy look ignores the magazine light and dark setting', () => {
    for (const file of productFiles(['src/buddy'])) {
      expect(read(file), file).not.toMatch(/useTheme|ThemeContext|ThemeProvider|prefers-color-scheme/);
    }
  });

  it('hear-Buddy exists and is off unless the owner turns it on', () => {
    expect(read('src/buddy/buddySettingsStore.ts')).toMatch(/DEFAULT_SETTINGS: BuddySettings = \{ vibe: DEFAULT_VIBE, speakReplies: false \}/);
    // The owner turns it on with a switch in Buddy's settings. Buddy never forces audio.
    expect(read('src/buddy/BuddySettings.tsx')).toContain('checked={draft.speakReplies}');
  });

  it('today is one briefing thread; night reports are a separate path', () => {
    expect(read('supabase/functions/_shared/buddyBriefing.ts')).not.toMatch(/mindsNightReport|nightReport/);
    expect(read('src/buddy/BuddyReports.tsx')).toContain('Night report');
  });

  it('briefing is quiet only when every source was read and empty', () => {
    const quiet = buildBriefing(emptyFacts(), NOW, SINCE, false);
    expect(quiet.quiet).toBe(true);
    expect(quiet.text).toContain(QUIET_LINE);
    // One source that could not be read means the day is not quiet.
    expect(buildBriefing(emptyFacts({ orders: { ok: false, paidCount: 0, usdTotal: 0 } }), NOW, SINCE, false).quiet).toBe(false);
  });

  // buildBriefing treats an omitted optional source as read. The one real caller must pass every source; this pins that.
  it('the briefing reader passes every source, so a day is never quiet on a source it did not read', () => {
    const reader = read('supabase/functions/buddy-think/index.ts');
    for (const key of ['minds', 'waiting', 'applied', 'gaps', 'packs', 'doors', 'notables', 'messages', 'weeks', 'commentsWaiting', 'refundsOpen', 'cartsAbandoned']) {
      expect(reader, key).toMatch(new RegExp(`\\b${key}:`));
    }
  });

  it('briefing has many sections, not one blob', () => {
    const busy = buildBriefing(emptyFacts({ messages: { ok: true, count: 2 }, views: { ok: true, count: 9 } }), NOW, SINCE, false);
    expect(busy.quiet).toBe(false);
    expect(busy.sections.length).toBeGreaterThan(1);
  });

  it('notable kinds are exactly the briefing list, and include door_failed', () => {
    expect([...BRIEFING_NOTABLE_KINDS]).toEqual([
      'takeover_changed', 'kill_changed', 'week_up', 'week_down', 'door_posted', 'sale', 'product_click',
      'traffic_new_kind', 'auditor_blocked', 'order_blocked', 'pack_ready', 'door_failed', 'mind_failed',
    ]);
  });

  it('messages, comments waiting, refunds and carts are counts only, never a name, email or body', () => {
    // The field names of the briefing input. A name, email or body field would show up here.
    const block = read('supabase/functions/_shared/buddyBriefing.ts').split('export interface BriefingFacts {')[1].split('\n}\n')[0];
    const fieldNames = [...block.matchAll(/^\s+(\w+)\??:/gm)].map((match) => match[1]);
    expect(fieldNames).toEqual(expect.arrayContaining(['messages', 'commentsWaiting', 'refundsOpen', 'cartsAbandoned']));
    for (const name of fieldNames) expect(name, name).not.toMatch(/name|email|body|address|text|reason|item/i);
    // The count-only input of a message, with a count and nothing else.
    const withMessages = buildBriefing(emptyFacts({ messages: { ok: true, count: 3 } }), NOW, SINCE, false);
    expect(JSON.stringify(withMessages)).toMatch(/3/);
  });

  it('a next-move line and "There is a message for you" exist in the briefing', () => {
    const briefing = read('supabase/functions/_shared/buddyBriefing.ts');
    expect(briefing).toContain('Your next move');
    expect(briefing).toContain('There is a message for you');
  });

  it('chief of staff: Takeover off means nothing changes; on means allowed work, and Buddy says so', () => {
    expect(read('supabase/functions/_shared/buddyThink.ts')).toContain(
      'Takeover decides what the site can change. Takeover off: nothing on the site changes, and you say so. Takeover on: the minds may do the work they are already allowed to do',
    );
  });

  it('show-the-paragraph path exists; the owner writes it and Buddy does not rewrite the article', () => {
    expect(read('src/buddy/BuddyChanges.tsx')).toContain('Show the paragraph');
  });

  it('Buddy never replies to readers; the refusal line names the never-list', () => {
    expect(REFUSAL_LINE).toBe(
      'Buddy will not do that. Refunds, deletes, emails to your list, replies to readers, price changes, and posting or publishing stay with you. Nothing was filed or changed.',
    );
  });

  it('the closed five order kinds, and nothing else', () => {
    expect([...ALLOWED_ORDERS]).toEqual(['run_today', 'pause_resume_free_door', 'kill_or_start_mind', 'product_line_apply', 'mind_work']);
  });

  it('a question is answered as a question: not refused, not filed', () => {
    expect(gateOrder('mind_work', 'What is the Executioner doing?')).toEqual({ ok: false, line: null });
    expect(refusedRequest('Why did the refund fail?')).toBe(false);
    expect(refusedRequest('Did you delete the old one?')).toBe(false);
  });

  it('refuses the never-list requests in plain words', () => {
    expect(refusedRequest('Refund the last order')).toBe(true);
    expect(refusedRequest('Delete that post')).toBe(true);
    expect(refusedRequest('Email my readers the new guide')).toBe(true);
    expect(refusedRequest('Reply to the reader who wrote in')).toBe(true);
    expect(refusedRequest('Change the price of the kit')).toBe(true);
  });

  // Phase F slice 6: the Phase E report left this open (owner decision B). It is now refused. It is a tiny gate fix.
  it('"Delete the old one" and "Erase it" are refused by the gate, with the refusal line', () => {
    expect(gateOrder('mind_work', 'Delete the old one')).toEqual({ ok: false, line: REFUSAL_LINE });
    expect(gateOrder('mind_work', 'Erase it')).toEqual({ ok: false, line: REFUSAL_LINE });
    expect(refusedRequest('Trash them all')).toBe(true);
  });

  it('an unnamed swap is filed for the Executioner; a named mind is respected', () => {
    expect(routeMessage('Swap the rose print onto the spring guide', null)).toEqual({
      kind: 'order', mind: 'executioner', instruction: 'Swap the rose print onto the spring guide', resolvesPending: false,
    });
    expect(routeMessage('Ask the Analyst to swap the rose print onto the spring guide', null)).toMatchObject({ kind: 'order', mind: 'analyst' });
    expect(routeMessage('Swap the rose print with the Executioner', null)).toMatchObject({ kind: 'order', mind: 'executioner' });
  });

  it('with Takeover off, a mind kill or start is waiting, not done', () => {
    expect(read('supabase/functions/_shared/buddyControls.ts')).toContain('Takeover is off, so nothing has changed. It is waiting for you.');
  });

  it('phone buzz kinds = briefing kinds plus job_finished', () => {
    expect(sorted(BUZZ_KINDS)).toEqual(sorted([...new Set([...BRIEFING_NOTABLE_KINDS, 'job_finished'])]));
  });

  it('the push link goes to /buddy', () => {
    expect(read('supabase/functions/_shared/notablePush.ts') + read('supabase/functions/_shared/notablePushServer.ts')).toMatch(/NOTIFICATION_URL = "\/buddy"/);
  });

  it('missing VAPID is a skip (not_configured) that the server retries, never a fake sent', () => {
    expect(read('supabase/functions/_shared/notablePushServer.ts')).toMatch(/RETRYABLE_NOTES: readonly string\[\] = \["pending", "failed", "no_device", "not_configured"\]/);
  });

  it('the server flush exists, so a closed Minds tab cannot drop a buzz', () => {
    expect(read('supabase/functions/buddy-night-clock/index.ts')).toContain('flushUnpushedNotables(servicePushPorts(sb))');
    expect(read('supabase/functions/minds-run-placement/index.ts')).toContain('flushUnpushedNotables(servicePushPorts(sb), Date.now(), owner)');
  });
});

describe('Phase F freeze: Minds and Admin', () => {
  it('keys are analyst, strategist, ceo, executioner, auditor; Buddy is the sixth card and the only voice', () => {
    expect([...MIND_KEYS]).toEqual(['analyst', 'strategist', 'ceo', 'executioner', 'auditor']);
    expect(MINDS.map((mind) => mind.key)).toEqual([...MIND_KEYS]);
  });

  it('Analyst: week vs week, a floor so 0 to 1 is never a spike, and cannot-see when a count is unread', () => {
    // 0 to 1 is not a spike.
    expect(planWeekNotables({ ok: true, thisWeek: { views: 1, paid: 0 }, lastWeek: { views: 0, paid: 0 } }, '2026-10-10')).toEqual([]);
    expect(VIEW_FLOOR).toBeGreaterThan(1);
    // A real rise past the floor is a notable.
    const up = planWeekNotables({ ok: true, thisWeek: { views: 50, paid: 0 }, lastWeek: { views: 20, paid: 0 } }, '2026-10-10');
    expect(up.map((plan) => plan.kind)).toEqual(['week_up']);
    // Unread counts: no notable, and the sentence says so.
    expect(planWeekNotables({ ok: false, thisWeek: { views: 50, paid: 0 }, lastWeek: { views: 20, paid: 0 } }, '2026-10-10')).toEqual([]);
    expect(CANNOT_SEE_LAST_WEEK).toBe('I cannot see last week yet.');
    expect(weekDirection(1, 0)).toBe('up');
  });

  it('Strategist suggests and never publishes; CEO sorts waiting work', () => {
    expect(PROPOSAL_KINDS).toContain('suggest');
    expect(PROPOSAL_KINDS).toContain('sort');
    expect(PROPOSAL_KINDS).not.toContain('publish');
    expect(read('supabase/functions/_shared/buddyLivingMinds.ts')).toContain('Use kind "suggest".');
    expect(read('supabase/functions/_shared/buddyLivingMinds.ts')).toContain('Use kind "sort".');
  });

  it('Executioner packs and sends free doors only; nothing while Takeover is off; never the four hand doors', () => {
    const exec = MINDS.find((mind) => mind.key === 'executioner');
    expect(exec?.job).toContain('Never posts the four you post by hand.');
    for (const door of ['instagram', 'tiktok', 'facebook', 'pinterest']) expect(OPEN_DOORS).not.toContain(door);
    expect(planDayRun({ localDay: '2026-10-10', trigger: 'owner', takeover: false, killScope: 'none', waiting: [] }).detail).toBe(TAKEOVER_OFF_DETAIL);
  });

  it('Auditor checks before a change; no other mind can switch it off; Buddy refuses "turn off the Auditor"', () => {
    expect([...CONTROL_MINDS]).not.toContain('auditor');
    expect(AUDITOR_REFUSAL).toBe('The Auditor stays on. It checks every change, so Buddy will not switch it off.');
    expect(parseControlRequest('turn off the Auditor')).toMatchObject({ ok: false, refusal: AUDITOR_REFUSAL });
  });

  it('Takeover default is false in the schema', () => {
    expect(read('supabase/migrations/20261009140000_minds_controls.sql')).toMatch(/takeover boolean NOT NULL DEFAULT false/);
  });

  it('kill options are none, all, and each of the five minds, and nothing else', () => {
    expect(KILL_OPTIONS.map((option) => option.value)).toEqual(['none', 'all', ...MIND_KEYS]);
  });

  it('there is no AdminAI.tsx, and no Admin AI import anywhere in admin', () => {
    expect(exists('src/admin/pages/AdminAI.tsx')).toBe(false);
    for (const file of productFiles(['src/admin'])) expect(read(file), file).not.toMatch(/AdminAI\b/);
  });

  it('Distribution address goes to Minds', () => {
    expect(read('src/admin/AdminApp.tsx')).toContain("case 'admin-automation-distribution':\n        return <RetiredDistributionRedirect />;");
  });

  it('Video look is a small screen: linked in the nav, three bounded values, and honest about what the pack video uses', () => {
    expect(exists('src/admin/pages/AutomationVideoLook.tsx')).toBe(true);
    expect(read('src/admin/AdminLayout.tsx')).toContain("route: { name: 'admin-automation-video-look' }");
    expect(read('src/lib/videoLook.ts')).toMatch(/LOOK_SCOPE_NOTE/);
  });

  it('the daily log table and writer exist; the writer is the run path', () => {
    expect(read('supabase/migrations/20261009160000_minds_daily_log.sql')).toMatch(/minds_daily_log/);
    expect(read('supabase/functions/minds-run-placement/index.ts')).toMatch(/from\("minds_daily_log"\)/);
  });

  it('living Analyst, Strategist and CEO are the three living minds', () => {
    expect([...LIVING_MINDS]).toEqual(['analyst', 'strategist', 'ceo']);
  });

  // The retry and the done rule are behaviour-tested in phaseEFreeze.test.ts (Phase E slice 3). This pins the source line.
  it('a living mind with a done row today is not run again', () => {
    expect(read('supabase/functions/_shared/buddyLivingMinds.ts')).toContain('if (context.doneToday?.includes(mind)) continue;');
  });

  it('Advisor stays CMS health, not a mind; Social Shares stay a read-only count with no send', () => {
    expect(exists('src/admin/pages/AdminAdvisor.tsx')).toBe(true);
    expect(read('src/admin/pages/AdminAdvisor.tsx')).not.toMatch(/buddy|mind/i);
    expect(read('src/admin/pages/AdminSocialShares.tsx')).not.toMatch(/\bsend|\bpost\(|fetch\(/i);
  });
});

describe('Phase F freeze: articles, shop, money, voice', () => {
  const shop: ShopProduct[] = [
    { id: 'p1', name: 'Rose Print Kit', isDigital: true, priceUsd: 12 },
    { id: 'p2', name: 'Paper Frame', isDigital: false, priceUsd: 8 },
    { id: 'p3', name: 'Ink Set', isDigital: false, priceUsd: 5 },
    { id: 'p4', name: 'Stencil Pack', isDigital: false, priceUsd: 6 },
  ];
  const line = (sentences: string[], productIds = ['p1']) => ({ paragraphIndex: 0, productIds, sentences });

  it('a pack carries at most three products', () => {
    expect(PACK_PRODUCT_CAP).toBe(3);
    expect(PLACEMENT_MAX_PRODUCTS).toBe(3);
    expect(auditPlacement(line(['The Rose Print Kit helps.'], ['p1', 'p2', 'p3', 'p4']), null, shop).reasons).toContain('too many products');
  });

  it('a product line is one or two sentences, and short: a third sentence or a long line is blocked', () => {
    expect(PLACEMENT_MAX_SENTENCES).toBe(2);
    expect(PLACEMENT_MAX_WORDS).toBe(60);
    expect(auditPlacement(line(['One.', 'Two.', 'Three.']), null, shop).reasons).toContain('too many sentences');
    expect(auditPlacement(line([`${'word '.repeat(70)}end.`]), null, shop).reasons).toContain('too long');
  });

  it('product lines have no dash, no country or city, and no non-USD money', () => {
    expect(auditPlacement(line(['The Rose Print Kit — a gift.']), null, shop).reasons).toContain('dash');
    expect(auditPlacement(line(['The Rose Print Kit is sold in Lagos.']), null, shop).reasons).toContain('country');
    expect(auditPlacement(line(['The Rose Print Kit costs 5000 NGN.']), null, shop).reasons).toContain('currency');
  });

  it('digital products lead the placement (digital first)', () => {
    expect(digitalFirst(['p2', 'p1'], shop)).toEqual(['p1', 'p2']);
  });

  it('the owner writes articles: the placement never creates a product', () => {
    expect(auditPlacement(line(['The Gold Foil Kit helps.'], ['p9']), null, shop).reasons).toContain('not in shop');
  });

  it('USD: NGN is hidden from display; reader copy with Naira, Nigeria, Lagos or WAT is refused', () => {
    expect(HIDDEN_DISPLAY_CURRENCIES).toContain('NGN');
    for (const text of ['Pay in naira now.', 'Price is 5000 NGN.', 'Ships from Nigeria.', 'Visit our Lagos shop.', 'Open WAT time.']) {
      expect(copyProblem(text), text).not.toBeNull();
    }
    expect(copyProblem('A clean line for readers.')).toBeNull();
  });

  it('no Nigeria, Lagos, WAT or Naira on any screen string (the internal Africa/Lagos clock stays)', () => {
    const offending: string[] = [];
    for (const file of productFiles(SCREEN_DIRS)) {
      for (const text of read(file).split('\n')) {
        if (/Africa\/Lagos|timeZone|import |LAGOS_TIME_ZONE|lagosDateKey/.test(text)) continue;
        if (/[Nn]aira|NGN|Nigeria/.test(text)) offending.push(`${file}: ${text.trim()}`);
        if (/['"`>][^'"`<]*\b(Lagos|WAT)\b/.test(text)) offending.push(`${file}: ${text.trim()}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it('the clock stays Africa/Lagos in code; the names are not renamed', () => {
    expect(LAGOS_TIME_ZONE).toBe('Africa/Lagos');
    expect(read('src/lib/articleIntake.ts')).toContain('lagosDateKey');
  });

  it('top countries for pack times are US, UK, CA, AU, IE, NZ, SG', () => {
    expect([...TOP_COUNTRIES]).toEqual(['US', 'UK', 'Canada', 'Australia', 'Ireland', 'New Zealand', 'Singapore']);
  });

  it('$0: no paid brain is tried; Cerebras and DeepSeek are skipped', () => {
    const skipped = BRAIN_SLOTS.filter((slot) => slot.access === 'skip').map((slot) => slot.id);
    expect(sorted(skipped)).toEqual(['cerebras', 'deepseek']);
    expect(tryableBrains().every((slot) => slot.access === 'free_no_card')).toBe(true);
  });
});

describe('Phase F freeze: doors', () => {
  it('the gated four are not auto doors: instagram, tiktok, facebook, pinterest', () => {
    for (const door of ['instagram', 'tiktok', 'facebook', 'pinterest']) expect(isDoorId(door)).toBe(false);
  });

  it('the gated pack carries caption, time, image, video and link, and Buddy never presses Post', () => {
    const migration = read('supabase/migrations/20261010100000_minds_packs.sql');
    for (const field of ['caption text', 'image_path text', 'video_path text', 'article_url text', 'suggested_at_utc timestamptz']) {
      expect(migration, field).toContain(field);
    }
    expect(migration).toContain("channel text NOT NULL CHECK (channel IN ('instagram', 'tiktok', 'facebook', 'pinterest'))");
    expect(read('src/buddy/BuddyChanges.tsx')).toContain('I posted this');
    expect(read('src/buddy/buddyJobs.ts')).toContain('The AI never posts.');
  });

  it('the 16 auto doors are exactly these, all open', () => {
    expect(sorted(DOOR_IDS)).toEqual(sorted([
      'telegram', 'discord', 'bluesky', 'mastodon', 'tumblr', 'blogger', 'medium', 'pixelfed', 'wordpress_com',
      'youtube', 'vimeo', 'podcast', 'flipboard', 'google_news', 'microsoft_start', 'smartnews',
    ]));
    expect(DOOR_IDS.length).toBe(16);
    expect(sorted(OPEN_DOORS)).toEqual(sorted(DOOR_IDS));
  });

  it('the RSS four are ping-hub doors with no login field, and the ping is the product', () => {
    expect(sorted(RSS_DOORS)).toEqual(sorted(['flipboard', 'google_news', 'microsoft_start', 'smartnews']));
    for (const door of RSS_DOORS) expect(DOORS[door].fields, door).toEqual([]);
    expect(read('supabase/functions/_shared/rssHub.ts')).toContain('export const WEBSUB_HUB = "https://pubsubhubbub.appspot.com/";');
  });

  it('skip when required media is missing: YouTube and Vimeo need video, podcast needs audio, Pixelfed needs image', () => {
    expect(DOOR_MEDIA.youtube).toBe('video');
    expect(DOOR_MEDIA.vimeo).toBe('video');
    expect(DOOR_MEDIA.podcast).toBe('audio');
    expect(DOOR_MEDIA.pixelfed).toBe('image');
  });

  it('connections show door details and a status with no saved value in it', () => {
    const status = doorStatus('telegram', new Set());
    expect(Object.keys(status).join(' ')).not.toMatch(/value|token|secret/i);
    for (const door of DOOR_IDS) for (const field of DOORS[door].fields) expect(field.label.length).toBeGreaterThan(0);
  });

  it('the connection test does not publish: its only POSTs are a sign-in and a token refresh', () => {
    const source = read('supabase/functions/_shared/doorConnectionTests.ts');
    expect(source.match(/method: "POST"/g)?.length).toBe(2);
    expect(source).toContain('com.atproto.server.createSession');
    expect(source).toContain('https://oauth2.googleapis.com/token');
    // No URL in the test calls a publish or upload endpoint.
    const urls = [...source.matchAll(/["'`]https?:\/\/[^"'`]+["'`]/g)].map((match) => match[0]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => /statuses|createRecord|\/videos|\/posts|upload|submit|publish/i.test(url))).toEqual([]);
  });

  it('the how-to covers every open door, and every brain (a skipped brain says it is skipped)', () => {
    expect(sorted(HOWTO_DOORS)).toEqual(sorted(OPEN_DOORS));
    for (const slot of BRAIN_SLOTS) {
      const reply = brainHowToReply(slot.id);
      expect(reply.trim().length, slot.id).toBeGreaterThan(0);
      if (slot.access === 'skip') expect(reply, slot.id).toMatch(/skips this brain/);
      else expect(reply, slot.id).not.toMatch(/skips this brain/);
    }
    expect(BRAIN_IDS.length).toBe(8);
  });

  it('no WhatsApp, Feedly, X or 21st door in the door registry, the posting code, or the how-to', () => {
    for (const file of ['supabase/functions/_shared/doorRegistry.ts', 'supabase/functions/_shared/doorPosts.ts', 'supabase/functions/_shared/rssHub.ts']) {
      expect(read(file), file).not.toMatch(/whatsapp|feedly|\b21st\b/i);
    }
    expect(howToDoor('how do I connect whatsapp')).toBeNull();
  });
});

describe('Phase F freeze: video, night, brains', () => {
  it('the pack is 1080 x 1920, with captions and a voice track', () => {
    expect(read('scripts/pack-video.mjs')).toMatch(/PACK_VIDEO = Object\.freeze\(\{ width: 1080, height: 1920,/);
    expect(read('scripts/pack-video.mjs')).toContain('A voice track is required: there is no silent output.');
    expect(read('scripts/pack-video.mjs')).toContain('export function buildAssText');
  });

  it('packs are never silent: the render has no -an flag', () => {
    expect(read('scripts/pack-video.mjs')).not.toMatch(/'-an'|"-an"/);
  });

  it('voice falls back to a local espeak', () => {
    expect(read('scripts/pack-voice.mjs')).toMatch(/espeak-ng/);
  });

  it('night writer and night clock are in config.toml, and night is not morning', () => {
    const config = read('supabase/config.toml');
    expect(config).toContain('[functions.buddy-night-report]');
    expect(config).toContain('[functions.buddy-night-clock]');
    expect(read('supabase/functions/_shared/mindsNightReport.ts')).not.toMatch(/morning briefing/i);
  });

  it('the 08:00 Lagos daily clock is in code: 0 7 * * * UTC, and the scheduler is in config', () => {
    expect(read('supabase/migrations/20261006100000_automation_daily_orchestration.sql')).toContain("'0 7 * * *'");
    expect(read('supabase/config.toml')).toContain('[functions.automation-scheduler]');
  });

  it('the minds daily-run cron line stays a comment (owner decision A: the run starts when the owner asks Buddy to run today, with Takeover on)', () => {
    expect(read('supabase/migrations/20261010090000_minds_daily_run.sql')).toMatch(/^-- SELECT cron\.schedule\('minds-daily-run'/m);
  });

  it('eight slots: try six, skip two, Gemini first', () => {
    expect(BRAIN_IDS.length).toBe(8);
    expect(BRAIN_SLOTS[0].id).toBe('gemini');
    expect(tryableBrains().length).toBe(6);
  });

  it('no GitHub, Bytez or Mistral workhorse brain', () => {
    expect(BRAIN_IDS.join(' ')).not.toMatch(/github|bytez|mistral/i);
  });

  // 429 → next, and status = any tryable brain, are behaviour-tested in phaseAFreeze.test.ts and phaseDFreeze.test.ts.
  it('the probe is askBrains, and status counts any tryable brain', () => {
    expect(read('supabase/functions/_shared/buddyThink.ts')).toContain('askBrains(');
    expect(read('supabase/functions/_shared/brains.ts')).toMatch(/anyTryableBrainConfigured/);
  });
});

describe('Phase F freeze: nothing shipped that should not be', () => {
  it('no stub markers in product code', () => {
    const hits: string[] = [];
    for (const file of productFiles(['supabase/functions', 'src/buddy', 'src/admin'])) {
      if (/not implemented|NOT_IMPLEMENTED|\bstub\b/i.test(read(file))) hits.push(file);
    }
    expect(hits).toEqual([]);
  });

  it('the day-run log writes through doorLogAction (no fake "posted" wording)', () => {
    expect(read('supabase/functions/minds-run-placement/index.ts')).toContain('doorLogAction(');
  });

  it('no owner-facing text says "later phase": there is no later phase after Phase F', () => {
    const hits: string[] = [];
    for (const file of productFiles(['supabase/functions', 'src/buddy', 'src/admin', 'src/components'])) {
      if (/later phase/i.test(read(file))) hits.push(file);
    }
    expect(hits).toEqual([]);
  });

  it('no unwired client aggregate is left: mindRun.ts is gone', () => {
    expect(exists('src/buddy/minds/mindRun.ts')).toBe(false);
  });

  it('the minds and Buddy\'s probe walk the brain chain (askBrains), not one brain', () => {
    expect(read('supabase/functions/_shared/mindThink.ts')).toContain('askBrains(');
    expect(read('supabase/functions/_shared/buddyThink.ts')).toContain('askBrains(');
  });

  it('the legacy distribution function has no WhatsApp, and sends only Telegram and the owner test email', () => {
    const handler = read('supabase/functions/automation-distribution/handler.ts');
    expect(handler).not.toMatch(/whatsapp/i);
    expect(handler).toContain('This provider is manual-kit only in the current verified sender set.');
    expect(handler).toContain('if (body.channel !== "telegram")');
    expect(handler).toMatch(/Only an active owner or founder can use a distribution sender\./);
  });

  it('the Buddy entry points exist: the Minds page links to /buddy, and the install panel lists Buddy', () => {
    expect(read('src/admin/pages/AdminMinds.tsx')).toContain('href="/buddy"');
    expect(read('src/components/PwaInstallPanel.tsx')).toContain("href: '/buddy'");
  });

  it('there is no Phase G: no later phase report or freeze is in the tree', () => {
    expect(exists('PHASE_G_REPORT.md')).toBe(false);
    expect(exists('src/buddy/phaseGFreeze.test.ts')).toBe(false);
  });

  it('the go-live checklist exists and says the agent does not merge or deploy', () => {
    expect(read('GO_LIVE.md')).toMatch(/agent does not/i);
  });
});
