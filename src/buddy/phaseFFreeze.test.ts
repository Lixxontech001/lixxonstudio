// @vitest-environment node
// Phase F freeze. One group per section of the Phase F lock list (see PHASE_F_INVENTORY.md).
// Imports the real constants where they exist, and uses source checks only where no constant exists.
// No network, no live keys, no live brain, no live door, no live push, no database. Nothing here merges,
// deploys, or applies a migration. If a lock breaks, this file fails the build.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORDERS, REFUSAL_LINE, gateOrder, refusedRequest } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { routeMessage } from '../../supabase/functions/_shared/buddyRouter';
import { BRIEFING_NOTABLE_KINDS, QUIET_LINE } from '../../supabase/functions/_shared/buddyBriefing';
import { BUZZ_KINDS } from '../../supabase/functions/_shared/notablePush';
import { BRAIN_IDS, BRAIN_SLOTS, tryableBrains } from '../../supabase/functions/_shared/brains';
import { DOOR_IDS, DOORS, doorStatus, isDoorId } from '../../supabase/functions/_shared/doorRegistry';
import { DOOR_MEDIA, OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';
import { RSS_DOORS } from '../../supabase/functions/_shared/rssHub';
import { HOWTO_DOORS, brainHowToReply, howToDoor } from '../../supabase/functions/_shared/buddyHowTo';
import { TOP_COUNTRIES } from '../../supabase/functions/_shared/packCopy';
import { PACK_PRODUCT_CAP } from '../../supabase/functions/_shared/packRules';
import { PROPOSAL_KINDS, LIVING_MINDS } from '../../supabase/functions/_shared/buddyLivingMinds';
import { VIEW_FLOOR } from '../../supabase/functions/_shared/buddyWeek';
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

// Walk a list of source directories and return every product file (no tests, no declaration files).
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

describe('Phase F freeze: Buddy', () => {
  it('only Buddy talks: no mind has a chat route or a chat box', () => {
    const app = read('src/App.tsx');
    expect(app).not.toMatch(/mind[-_]?chat|chat[-_]?with[-_]?mind/i);
    expect(read('src/admin/pages/AdminMinds.tsx')).not.toMatch(/<textarea/);
  });

  it('asking about a mind answers from the daily log, not a guess', () => {
    expect(routeLike('How is the Analyst doing?')).toEqual({ kind: 'mind_log', mind: 'analyst' });
    expect(routeLike('What is the Executioner doing?')).toEqual({ kind: 'mind_log', mind: 'executioner' });
  });

  it('the order lines show waiting, done or blocked; Takeover off says the orders stay waiting', () => {
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
  });

  it('today is one briefing thread; night reports are a separate path', () => {
    const briefing = read('supabase/functions/_shared/buddyBriefing.ts');
    expect(briefing).not.toMatch(/mindsNightReport|nightReport/);
    expect(read('src/buddy/BuddyReports.tsx')).toContain('Night report');
  });

  it('the briefing is quiet only when every source was read and empty, and says so in one line', () => {
    expect(QUIET_LINE).toBe('Quiet since you left.');
    expect(read('supabase/functions/_shared/buddyBriefing.ts')).toMatch(/Rule: say "quiet" only when every source was read/);
  });

  it('the briefing notable kinds include door_failed and the closed set is exact', () => {
    expect([...BRIEFING_NOTABLE_KINDS]).toEqual([
      'takeover_changed', 'kill_changed', 'week_up', 'week_down', 'door_posted', 'sale', 'product_click',
      'traffic_new_kind', 'auditor_blocked', 'order_blocked', 'pack_ready', 'door_failed', 'mind_failed',
    ]);
  });

  it('messages, comments, refunds and carts are counts only, never a reader name, email or body', () => {
    const briefing = read('supabase/functions/_shared/buddyBriefing.ts');
    expect(briefing).toMatch(/comments?/i);
    expect(briefing).toMatch(/refund/i);
    expect(briefing).toMatch(/cart/i);
    expect(briefing).not.toMatch(/\.(email|reader_name|body)\b/);
  });

  it('the briefing has a next-move line and a "message for you" line', () => {
    const briefing = read('supabase/functions/_shared/buddyBriefing.ts');
    expect(briefing).toContain('Your next move');
    expect(briefing).toContain('There is a message for you');
  });

  it('chief of staff: Takeover off means nothing changes and Buddy says so; on means allowed work, and Buddy says that too', () => {
    const think = read('supabase/functions/_shared/buddyThink.ts');
    expect(think).toContain('Takeover decides what the site can change. Takeover off: nothing on the site changes, and you say so.');
    expect(think).toContain('Takeover on: the minds may do the work they are already allowed to do');
  });

  it('show-the-paragraph path exists; the owner writes it and Buddy does not rewrite the article', () => {
    expect(read('src/buddy/BuddyChanges.tsx')).toContain('Show the paragraph');
  });

  it('Buddy never replies to readers; the refusal line names the never-list', () => {
    expect(REFUSAL_LINE).toBe(
      "Buddy will not do that. Refunds, deletes, emails to your list, replies to readers, price changes, and posting or publishing stay with you. Nothing was filed or changed.",
    );
  });

  it('the closed five order kinds, and nothing else', () => {
    expect([...ALLOWED_ORDERS]).toEqual(['run_today', 'pause_resume_free_door', 'kill_or_start_mind', 'product_line_apply', 'mind_work']);
  });

  it('a question about a held kind is answered as a question, not refused or filed', () => {
    expect(gateOrder('mind_work', 'What is the Executioner doing?')).toEqual({ ok: false, line: null });
    expect(refusedRequest('Why did the refund fail?')).toBe(false);
  });

  it('refuses the never-list requests in plain words', () => {
    expect(refusedRequest('Refund the last order')).toBe(true);
    expect(refusedRequest('Delete that post')).toBe(true);
    expect(refusedRequest('Email my readers the new guide')).toBe(true);
    expect(refusedRequest('Reply to the reader who wrote in')).toBe(true);
  });

  // Known open finding (Phase E report, GO_LIVE owner decision B). The Phase D gate lets this one through.
  // This test pins today's behaviour so the gap is visible. If the owner fixes the gate, this test fails
  // and must be flipped to expect a refusal.
  it('KNOWN GAP (owner decision B): "Delete the old one" passes the Phase D gate today', () => {
    expect(gateOrder('mind_work', 'Delete the old one')).toEqual({ ok: true, kind: 'mind_work' });
  });

  it('an unnamed swap is filed for the Executioner; a named mind is respected; no "Which mind?" for a swap', () => {
    expect(routeLike('Swap the rose print onto the spring guide')).toEqual({
      kind: 'order', mind: 'executioner', instruction: 'Swap the rose print onto the spring guide', resolvesPending: false,
    });
    expect(routeLike('Ask the Analyst to swap the rose print onto the spring guide')).toMatchObject({ kind: 'order', mind: 'analyst' });
    expect(routeLike('Swap the rose print with the Executioner')).toMatchObject({ kind: 'order', mind: 'executioner' });
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

  it('missing VAPID is a skip (not_configured), never a fake sent', () => {
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
    expect(read('src/admin/pages/AdminMinds.tsx')).toMatch(/Buddy/);
  });

  it('Analyst: week vs week, with a floor so 0 to 1 is never a spike', () => {
    expect(VIEW_FLOOR).toBeGreaterThan(1);
    expect(read('supabase/functions/_shared/buddyWeek.ts')).toContain('I cannot see last week yet.');
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
    expect(OPEN_DOORS).not.toContain('instagram');
    expect(OPEN_DOORS).not.toContain('tiktok');
    expect(OPEN_DOORS).not.toContain('facebook');
    expect(OPEN_DOORS).not.toContain('pinterest');
  });

  it('Auditor checks before a change; no other mind can switch it off; Buddy refuses to turn it off', () => {
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

  it('there is no AdminAI.tsx, and no 22-tab tower import', () => {
    expect(exists('src/admin/pages/AdminAI.tsx')).toBe(false);
    for (const file of productFiles(['src/admin'])) {
      expect(read(file), file).not.toMatch(/AdminAI\b/);
    }
  });

  it('Distribution address goes to Minds', () => {
    expect(read('src/admin/AdminApp.tsx')).toContain("case 'admin-automation-distribution':\n        return <RetiredDistributionRedirect />;");
  });

  it('Video look is a small screen (the page exists and is saved, not an editor)', () => {
    expect(exists('src/admin/pages/AutomationVideoLook.tsx')).toBe(true);
  });

  it('the daily log table and writer exist; the writer is the run path', () => {
    expect(read('supabase/migrations/20261009160000_minds_daily_log.sql')).toMatch(/minds_daily_log/);
    expect(read('supabase/functions/minds-run-placement/index.ts')).toMatch(/from\("minds_daily_log"\)/);
  });

  it('living Analyst, Strategist and CEO are the three living minds', () => {
    expect([...LIVING_MINDS]).toEqual(['analyst', 'strategist', 'ceo']);
  });

  it('a living mind with a done row today is not run again; a failed or empty one may retry the same local day', () => {
    const living = read('supabase/functions/_shared/buddyLivingMinds.ts');
    expect(living).toContain("if (context.doneToday?.includes(mind)) continue;");
    expect(living).toMatch(/doneToday\?: readonly LivingMind\[\]/);
  });

  it('Advisor stays CMS health, not a mind; Social Shares stay a read-only count with no send', () => {
    expect(exists('src/admin/pages/AdminAdvisor.tsx')).toBe(true);
    expect(read('src/admin/pages/AdminAdvisor.tsx')).not.toMatch(/buddy|mind/i);
    const shares = read('src/admin/pages/AdminSocialShares.tsx');
    expect(shares).not.toMatch(/\bsend|\bpost\(|fetch\(/i);
  });
});

describe('Phase F freeze: articles, shop, money, voice', () => {
  it('product cap is three, and the owner writes; copy is 1-2 sentence product lines', () => {
    expect(PACK_PRODUCT_CAP).toBe(3);
  });

  it('USD: NGN is hidden from display; the shop shows USD', () => {
    expect(HIDDEN_DISPLAY_CURRENCIES).toContain('NGN');
  });

  it('top countries are US, UK, CA, AU, IE, NZ, SG', () => {
    expect([...TOP_COUNTRIES]).toEqual(['US', 'UK', 'Canada', 'Australia', 'Ireland', 'New Zealand', 'Singapore']);
  });

  it('no Naira, Nigeria, Lagos or WAT on any screen string (internal Africa/Lagos clock stays)', () => {
    const offending: string[] = [];
    for (const file of productFiles(SCREEN_DIRS)) {
      for (const line of read(file).split('\n')) {
        if (/Africa\/Lagos|timeZone|import |LAGOS_TIME_ZONE|lagosDateKey/.test(line)) continue;
        if (/[Nn]aira|NGN|Nigeria/.test(line)) offending.push(`${file}: ${line.trim()}`);
        if (/['"`>][^'"`<]*\b(Lagos|WAT)\b/.test(line)) offending.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it('the clock stays Africa/Lagos in code; the names are not renamed', () => {
    expect(LAGOS_TIME_ZONE).toBe('Africa/Lagos');
    expect(read('src/lib/articleIntake.ts')).toContain('lagosDateKey');
  });
});

describe('Phase F freeze: doors', () => {
  it('the gated four are gated: instagram, tiktok, facebook, pinterest are not auto doors', () => {
    for (const door of ['instagram', 'tiktok', 'facebook', 'pinterest']) {
      expect(isDoorId(door)).toBe(false);
    }
  });

  it('the 16 auto doors are exactly these, in this set', () => {
    expect(sorted(DOOR_IDS)).toEqual(sorted([
      'telegram', 'discord', 'bluesky', 'mastodon', 'tumblr', 'blogger', 'medium', 'pixelfed', 'wordpress_com',
      'youtube', 'vimeo', 'podcast', 'flipboard', 'google_news', 'microsoft_start', 'smartnews',
    ]));
    expect(DOOR_IDS.length).toBe(16);
    expect(sorted(OPEN_DOORS)).toEqual(sorted(DOOR_IDS));
  });

  it('the RSS four are ping-hub doors, and none has a login field', () => {
    expect(sorted(RSS_DOORS)).toEqual(sorted(['flipboard', 'google_news', 'microsoft_start', 'smartnews']));
    for (const door of RSS_DOORS) {
      expect(DOORS[door].fields, door).toEqual([]);
    }
  });

  it('skips when required media is missing: YouTube and Vimeo need video, podcast needs audio, pixelfed needs image', () => {
    expect(DOOR_MEDIA.youtube).toBe('video');
    expect(DOOR_MEDIA.vimeo).toBe('video');
    expect(DOOR_MEDIA.podcast).toBe('audio');
    expect(DOOR_MEDIA.pixelfed).toBe('image');
  });

  it('connections show door details and never echo a secret value', () => {
    const status = doorStatus('telegram', new Set());
    expect(Object.keys(status).join(' ')).not.toMatch(/value|token|secret/i);
  });

  it('the connection test does not publish', () => {
    const test = read('supabase/functions/door-connection-test/index.ts');
    expect(test).not.toMatch(/sendTelegram|sendBluesky|sendMastodon|publishPost|postToDoor/);
  });

  it('the how-to covers every open door and every brain', () => {
    expect(sorted(HOWTO_DOORS)).toEqual(sorted(OPEN_DOORS));
    for (const brain of BRAIN_IDS) {
      expect(brainHowToReply(brain).trim().length, brain).toBeGreaterThan(0);
    }
  });

  it('no WhatsApp, Feedly, X or 21st door in the door registry or the posting code', () => {
    for (const file of ['supabase/functions/_shared/doorRegistry.ts', 'supabase/functions/_shared/doorPosts.ts', 'supabase/functions/_shared/rssHub.ts']) {
      expect(read(file), file).not.toMatch(/whatsapp|feedly|\b21st\b/i);
    }
    expect(howToDoor('set up whatsapp')).toBeNull();
  });
});

describe('Phase F freeze: video, night, brains', () => {
  it('the pack is 1080 x 1920 with captions and a voice track', () => {
    expect(read('scripts/pack-video.mjs')).toMatch(/PACK_VIDEO = Object\.freeze\(\{ width: 1080, height: 1920,/);
    expect(read('scripts/pack-video.mjs')).toContain('A voice track is required: there is no silent output.');
  });

  it('packs are never silent: the render has no -an flag', () => {
    expect(read('scripts/pack-video.mjs')).not.toMatch(/'-an'|"-an"/);
  });

  it('voice falls back to a local espeak', () => {
    expect(read('scripts/pack-voice.mjs')).toMatch(/espeak-ng/);
  });

  it('night writer and night clock are in config.toml; night is not morning', () => {
    const config = read('supabase/config.toml');
    expect(config).toContain('[functions.buddy-night-report]');
    expect(config).toContain('[functions.buddy-night-clock]');
    expect(read('supabase/functions/_shared/mindsNightReport.ts')).not.toMatch(/morning briefing/i);
  });

  it('eight slots: try six, skip two (cerebras, deepseek), Gemini first', () => {
    expect(BRAIN_IDS.length).toBe(8);
    expect(BRAIN_SLOTS[0].id).toBe('gemini');
    const skipped = BRAIN_SLOTS.filter((slot) => slot.access === 'skip').map((slot) => slot.id);
    expect(sorted(skipped)).toEqual(['cerebras', 'deepseek']);
    expect(tryableBrains().length).toBe(6);
  });

  it('no GitHub, Bytez or Mistral workhorse brain', () => {
    expect(BRAIN_IDS.join(' ')).not.toMatch(/github|bytez|mistral/i);
  });

  it('the probe is askBrains, and a 429 moves on to the next brain', () => {
    expect(read('supabase/functions/_shared/buddyThink.ts')).toContain('askBrains(');
    expect(read('supabase/functions/_shared/brainChain.ts')).toMatch(/429/);
  });

  it('the 08:00 Lagos daily clock is in code: 0 7 * * * UTC, and the scheduler is in config', () => {
    expect(read('supabase/migrations/20261006100000_automation_daily_orchestration.sql')).toContain("'0 7 * * *'");
    expect(read('supabase/config.toml')).toContain('[functions.automation-scheduler]');
  });

  it('the minds daily-run cron line stays a comment (owner decision A: the run starts on "run today" or Run)', () => {
    expect(read('supabase/migrations/20261010090000_minds_daily_run.sql')).toMatch(/^-- SELECT cron\.schedule\('minds-daily-run'/m);
  });

  it('brain status counts any tryable brain as configured', () => {
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

  it('the day-run log never says "Posted to" for a failed or skipped row', () => {
    const run = read('supabase/functions/minds-run-placement/index.ts');
    expect(run).toContain('doorLogAction(');
  });

  it('there is no Phase G: no later phase report or freeze is in the tree', () => {
    expect(exists('PHASE_G_REPORT.md')).toBe(false);
    expect(exists('src/buddy/phaseGFreeze.test.ts')).toBe(false);
  });

  it('the go-live checklist exists and the agent does not merge or deploy', () => {
    const golive = read('GO_LIVE.md');
    expect(golive).toMatch(/agent does not/i);
    expect(golive.length).toBeGreaterThan(200);
  });
});

// Calls the real router with no pending question. Kept as a helper so the lock lines read plainly.
function routeLike(text: string) {
  return routeMessage(text, null);
}
