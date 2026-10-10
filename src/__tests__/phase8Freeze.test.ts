// @vitest-environment node
// Phase 8 freeze. Most checks call the real functions with small local fixtures and fake senders, fake hub and fake
// voice. Wiring checks read the source. Nothing here reaches a live door, a live database, a live voice or a phone.
// Nothing here merges, deploys, or applies a migration.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';
import { RSS_DOORS, WEBSUB_HUB, sendRssPing, sentLead, sentVerb } from '../../supabase/functions/_shared/rssHub';
import { planSaleNotables } from '../../supabase/functions/_shared/notableSources';
import { BUZZ_KINDS, shouldBuzz } from '../../supabase/functions/_shared/notablePush';
import { neverListLine, routeMessage } from '../../supabase/functions/_shared/buddyRouter';
import { AUDITOR_REFUSAL, WAIT_LINE, parseControlRequest } from '../../supabase/functions/_shared/buddyControls';
import {
  BUDDY_GEMINI_MODEL,
  NO_KEY_MESSAGE,
  RUN_DAY_OFF_LINE,
  RUN_DAY_ON_LINE,
  handleBuddyThink,
  type BuddyThinkDeps,
} from '../../supabase/functions/_shared/buddyThink';
import { PLACEMENT_MAX_PRODUCTS } from '../../supabase/functions/_shared/productPlacement';
import { mp4HasAudioTrack, MAX_VOICE_SECONDS } from '../../scripts/pack-video.mjs';
import { narrate } from '../../scripts/pack-voice.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: the runner scripts are plain Node modules, imported here for their real checks.
import { checkVideo, VIDEO_NO_SOUND_NOTE } from '../../scripts/save-pack-media.mjs';
import { wavBytes } from './support/wav';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const readBytes = (file: string) => new Uint8Array(readFileSync(join(ROOT, file)));

const GATED = ['instagram', 'tiktok', 'facebook', 'pinterest'];
const RSS_FOUR = ['flipboard', 'google_news', 'microsoft_start', 'smartnews'];
const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';
const FAKE_KEY = 'FAKE-GEMINI-KEY-NOT-REAL-PHASE8';
// Owner-facing copy must avoid these words (the Phase 8 brief).
const FORBIDDEN_COPY = /autonomy|control tower|orchestration|\brpc\b|payload|dispatch|daily kit|adapter/i;
const PHASE8_MIGRATIONS = [
  'supabase/migrations/20261013000000_minds_paused_doors.sql',
  'supabase/migrations/20261014000000_door_posts_rss_four.sql',
];
// The files Phase 8 added or changed for the owner's business: no new Buddy, day run or door table.
const PHASE8_OWNER_FILES = [
  'supabase/functions/_shared/rssHub.ts',
  'supabase/functions/_shared/buddyControls.ts',
  'supabase/functions/_shared/buddyOrders.ts',
  'supabase/functions/_shared/buddyThink.ts',
  'supabase/functions/_shared/buddyRouter.ts',
];

/** Every non-test source file under the folders the owner's business runs from. */
function sourceFiles(folders: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const path = join(dir, name);
      if (statSync(join(ROOT, path)).isDirectory()) walk(path);
      else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\./.test(name)) out.push(relative(ROOT, join(ROOT, path)));
    }
  };
  folders.forEach(walk);
  return out;
}

/** Only the parts of the Buddy ports a routed request touches. Other calls are not reached by these tests. */
function thinkDeps(overrides: Partial<BuddyThinkDeps> = {}) {
  const saved: string[] = [];
  const base = {
    keyConfigured: async () => true,
    readKey: async () => FAKE_KEY,
    readSecret: async (name: string) => (name === 'gemini_api_key' ? (await base.readKey()) : null),
    allowCall: async () => true,
    askGemini: vi.fn(async () => ({ ok: true as const, text: 'unused' })),
    recordProbe: async () => {},
    loadChat: async (id: string) => (id === CHAT_ID ? { id, title: null } : null),
    loadHistory: async () => [],
    saveMessage: async (_chatId: string, _role: string, _kind: string, content: string) => {
      saved.push(content);
      return true;
    },
    touchChat: async () => {},
    now: () => new Date('2026-10-10T12:00:00Z'),
    loadPendingOrder: async () => ({ ok: true as const, instruction: null }),
    saveOrder: vi.fn(async () => true),
    readTakeover: async () => false as boolean | null,
    applyControl: vi.fn(async () => true),
    readSiteFacts: async () => ({ articles: { ok: true, total: 0, items: [] }, products: { ok: true, total: 0, items: [] } }),
    readStateFacts: async () => ({
      takeover: false,
      killScope: 'none',
      orders: { ok: true, total: 0, items: [] },
      log: { ok: true, rows: [] },
      doors: { ok: true, rows: [] },
      notable: { ok: true, rows: [] },
    }),
    ...overrides,
  };
  return { deps: base as unknown as BuddyThinkDeps, base, saved };
}

describe('Phase 8 freeze: Takeover is off by default, and the Phase 8 migrations never turn it on', () => {
  it('the saved Takeover switch defaults to off', () => {
    expect(read('supabase/migrations/20261009140000_minds_controls.sql')).toMatch(/takeover boolean NOT NULL DEFAULT false/);
  });

  it('no Phase 8 migration sets Takeover to true, in a default or in a seed', () => {
    for (const file of PHASE8_MIGRATIONS) {
      const sql = read(file);
      expect(sql).not.toMatch(/takeover[^;]*\btrue\b/i);
    }
    const seedFiles = sourceFiles(['supabase']).filter((file) => /seed/i.test(file));
    for (const file of seedFiles) expect(read(file)).not.toMatch(/takeover[^;\n]*\btrue\b/i);
  });

  it('a run request with Takeover off waits, and a run request with Takeover on starts', async () => {
    const off = thinkDeps({ readTakeover: async () => false });
    const offResult = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Run today' }, off.deps);
    expect(offResult.body).toMatchObject({ ok: true, route: 'run_day', reply: RUN_DAY_OFF_LINE });
    const on = thinkDeps({ readTakeover: async () => true });
    const onResult = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Run today' }, on.deps);
    expect(onResult.body).toMatchObject({ ok: true, route: 'run_day', reply: RUN_DAY_ON_LINE });
  });

  it('a pause or stop request with Takeover off is saved as waiting, and nothing is changed', async () => {
    const { deps, base } = thinkDeps({ readTakeover: async () => false });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Pause the Telegram door' }, deps);
    expect(result.body).toMatchObject({ ok: true, route: 'control', reply: WAIT_LINE });
    expect(base.saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Pause the Telegram door', null);
    expect(base.applyControl).not.toHaveBeenCalled();
  });

  it('with Takeover on, a pause request is carried out, and the Auditor is still refused', async () => {
    const { deps, base } = thinkDeps({ readTakeover: async () => true });
    await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Pause the Telegram door' }, deps);
    expect(base.applyControl).toHaveBeenCalledWith({ kind: 'pause_door', door: 'telegram' });
    expect(parseControlRequest('Stop the Auditor')).toEqual({ ok: false, refusal: AUDITOR_REFUSAL });
  });
});

describe('Phase 8 freeze: Buddy thinks with Gemini, and the never-list still blocks', () => {
  it('Buddy uses the Gemini flash model the brief names', () => {
    expect(BUDDY_GEMINI_MODEL).toBe('gemini-3.8-flash');
  });

  it('an ordinary owner message goes to Gemini when a key is saved', async () => {
    const { deps, base } = thinkDeps();
    await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'What sold today?' }, deps);
    expect(base.askGemini).toHaveBeenCalled();
  });

  it('with no key, Buddy gives one honest line, never a made-up answer, and does not call Gemini', async () => {
    const { deps, base } = thinkDeps({ keyConfigured: async () => false, readKey: async () => null });
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'What sold today?' }, deps);
    expect(base.askGemini).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).toContain(NO_KEY_MESSAGE);
    expect(NO_KEY_MESSAGE).not.toContain('\n');
  });

  it('the never-list still blocks shop products, ads, reader replies and full rewrites', () => {
    expect(neverListLine('Create a new shop product for me')).toMatch(/does not create shop products/);
    expect(neverListLine('Buy ads for this post')).toMatch(/does not spend money or buy ads/);
    expect(neverListLine('Reply to the readers as me')).toMatch(/does not reply to readers as you/);
    expect(neverListLine('Rewrite the whole article')).toMatch(/one or two sentences/);
    expect(routeMessage('Create a new shop product for me', null).kind).not.toBe('order');
  });

  it('Buddy never creates a shop product, and never places more than three products on an article', () => {
    expect(PLACEMENT_MAX_PRODUCTS).toBe(3);
    expect(neverListLine('add a product to the shop')).toMatch(/does not create shop products/);
  });
});

describe('Phase 8 freeze: twenty doors, four gated, sixteen auto', () => {
  it('the registry lists sixteen auto doors, and all sixteen are open to the day run', () => {
    expect(DOOR_IDS).toHaveLength(16);
    expect(OPEN_DOORS).toHaveLength(16);
    expect([...OPEN_DOORS].sort()).toEqual([...DOOR_IDS].sort());
  });

  it('the auto doors include the four RSS doors: flipboard, google_news, microsoft_start, smartnews', () => {
    for (const door of RSS_FOUR) {
      expect(DOOR_IDS).toContain(door);
      expect(OPEN_DOORS).toContain(door);
    }
    expect([...RSS_DOORS].sort()).toEqual([...RSS_FOUR].sort());
  });

  it('the four gated channels are not doors, so nothing sends to them', () => {
    for (const channel of GATED) {
      expect(DOOR_IDS as readonly string[]).not.toContain(channel);
      expect(OPEN_DOORS as readonly string[]).not.toContain(channel);
    }
  });

  it('an RSS door pings the hub with the feed address (fake hub), and the log says pinged, never posted', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fakeHub = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(null, { status: 204 });
    };
    const feed = 'https://lixxonstudio.example/rss.xml';
    const result = await sendRssPing(feed, fakeHub as typeof fetch);
    expect(result).toEqual({ ok: true, externalRef: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(WEBSUB_HUB);
    expect(calls[0].body).toContain('hub.mode=publish');
    expect(sentLead('flipboard', 'Flipboard')).toBe('RSS updated and pinged for Flipboard');
    expect(sentVerb('google_news')).toBe('pinged');
    expect(sentLead('smartnews', 'SmartNews')).not.toMatch(/posted/i);
  });

  it('a gated channel has no send in the code the day run uses', () => {
    const dayRunFiles = sourceFiles(['supabase/functions/_shared', 'supabase/functions/minds-run-placement']);
    for (const file of dayRunFiles) {
      if (file.includes('distributionAdapters') || file.includes('automationKeyChecks') || file.includes('automationAlerts')) continue;
      const text = read(file);
      for (const channel of GATED) {
        expect(text, `${file} must not send to ${channel}`).not.toMatch(new RegExp(`case\\s+["']${channel}["']\\s*:\\s*\\{?\\s*[\\s\\S]{0,40}send`, 'i'));
      }
    }
  });
});

describe('Phase 8 freeze: a sale is a notable event, and an empty day gives none', () => {
  it('a paid order fixture gives one sale notable, in USD', () => {
    const plans = planSaleNotables([{ id: 'ord_phase8_fixture_1', amount: 24, currency: 'USD' }]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ kind: 'sale', mind: 'analyst', title: 'Paid order: USD 24.00.' });
  });

  it('an empty day gives no sale notable', () => {
    expect(planSaleNotables([])).toEqual([]);
  });

  it('a heartbeat never buzzes the owner, and a sale does', () => {
    expect(BUZZ_KINDS).not.toContain('heartbeat');
    expect(shouldBuzz('heartbeat')).toBe(false);
    expect(shouldBuzz('sale')).toBe(true);
  });
});

describe('Phase 8 freeze: pack videos have sound, and a silent MP4 is refused', () => {
  it('the voiced fixture has an audio track, and the silent fixture does not', () => {
    expect(mp4HasAudioTrack(readBytes('src/__tests__/fixtures/pack-media/tiny-voiced.mp4'))).toBe(true);
    expect(mp4HasAudioTrack(readBytes('src/__tests__/fixtures/pack-media/tiny.mp4'))).toBe(false);
  });

  it('the saver accepts a voiced MP4 and refuses a silent one with the owner-facing reason', () => {
    expect(checkVideo(readBytes('src/__tests__/fixtures/pack-media/tiny-voiced.mp4'))).toEqual({ ok: true });
    expect(checkVideo(readBytes('src/__tests__/fixtures/pack-media/tiny.mp4'))).toEqual({ ok: false, reason: 'no_audio' });
    expect(VIDEO_NO_SOUND_NOTE).toContain('video has no sound yet');
  });

  it('the Gemini voice is tried first: when it answers, no local program runs', async () => {
    const dir = join(tmpdir(), `p8-freeze-${Date.now()}`);
    const { mkdirSync, rmSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const runCommand = vi.fn(async () => ({ code: 0 }));
    const fetchImpl = vi.fn(async () => {
      const data = Buffer.from(wavBytes(2)).toString('base64');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data } }] } }] }), { status: 200 });
    });
    const result = await narrate({
      chunks: ['Calm routine tonight.'],
      outPath: join(dir, 'voice.wav'),
      geminiKey: FAKE_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      espeak: 'espeak-ng',
      runCommand,
    });
    expect(result).toMatchObject({ ok: true, voice: 'gemini' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(runCommand).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
    rmSync(dir, { recursive: true, force: true });
  });

  it('with no voice from any source, the answer is no_voice, and the length limit is written down', async () => {
    const none = await narrate({ chunks: ['Calm routine tonight.'], outPath: join(ROOT, 'unused.wav'), geminiKey: null, espeak: null });
    expect(none).toMatchObject({ ok: false, reason: 'no_voice' });
    expect(MAX_VOICE_SECONDS).toBe(12);
  });
});

describe('Phase 8 freeze: the briefing keeps its seven sections', () => {
  it('the briefing source names the seven sections, in order', () => {
    const source = read('supabase/functions/_shared/buddyBriefing.ts');
    const ids = ['since', 'went_out', 'money', 'minds', 'problems', 'jobs', 'next'];
    let at = -1;
    for (const id of ids) {
      const found = source.indexOf(`id: "${id}"`);
      expect(found, `section ${id}`).toBeGreaterThan(at);
      at = found;
    }
    expect(source).toContain('Quiet since you left.');
  });
});

describe('Phase 8 freeze: the hard no list', () => {
  it('no Instagram, TikTok, Facebook or Pinterest sender is wired to the day run or to Buddy', () => {
    const buddyAndRun = [
      'supabase/functions/_shared/runDoors.ts',
      'supabase/functions/_shared/buddyThink.ts',
      'supabase/functions/_shared/buddyRouter.ts',
      'supabase/functions/_shared/buddyControls.ts',
      'supabase/functions/_shared/rssHub.ts',
      'supabase/functions/minds-run-placement/index.ts',
    ];
    for (const file of buddyAndRun) {
      const text = read(file);
      expect(text, file).not.toMatch(/graph\.facebook|api\.pinterest|open\.tiktokapis|instagram\.com\/api/);
      expect(text, file).not.toMatch(/whatsapp/i);
      expect(text, file).not.toContain('distributionAdapters');
    }
  });

  it('no paid voice, buffer, or social scheduling service is called anywhere in the owner code', () => {
    for (const file of sourceFiles(['supabase/functions', 'scripts'])) {
      expect(read(file), file).not.toMatch(/elevenlabs|api\.buffer\.com|upload-post|ayrshare/i);
    }
  });

  it('the owner-facing Phase 8 copy avoids the forbidden words (comments excluded)', () => {
    for (const file of [...PHASE8_OWNER_FILES, 'scripts/pack-voice.mjs']) {
      const code = read(file)
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*|import\s|export\s+\{[^}]*\}\s+from)/.test(line))
        .join('\n');
      const strings = code.match(/"[^"\n]*"|`[^`\n]*`/g) ?? [];
      for (const literal of strings) expect(literal, file).not.toMatch(FORBIDDEN_COPY);
    }
  });

  it('no Nigeria, Naira or Lagos appears in the new Phase 8 public fixtures or the new owner code', () => {
    const newFiles = [
      'supabase/functions/_shared/rssHub.ts',
      'scripts/pack-voice.mjs',
      'src/__tests__/packVoice.test.ts',
      'src/__tests__/support/wav.ts',
      'src/__tests__/fixtures/pack-media/tiny-voiced.mp4',
      ...PHASE8_MIGRATIONS,
    ];
    for (const file of newFiles) {
      const text = new TextDecoder('latin1').decode(readBytes(file));
      expect(text, file).not.toMatch(/nigeria|naira|lagos|abuja/i);
      if (!file.endsWith('.mp4') && !file.endsWith('.png')) expect(text, file).not.toContain('\u2014');
    }
  });

  it('the Phase 8 fixture folders hold no em dash and no Nigeria in any text file', () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(ROOT, dir)).flatMap((name) => {
        const path = join(dir, name);
        return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
      });
    for (const file of walk('src/__tests__/fixtures').filter((path) => /\.(txt|md|json|ass|srt|vtt|xml|csv)$/i.test(path))) {
      const text = read(file);
      expect(text, file).not.toContain('\u2014');
      expect(text, file).not.toMatch(/nigeria|naira|lagos/i);
    }
  });
});

describe('Phase 8 freeze: the owner pays nothing, and secrets are not echoed', () => {
  it('the Gemini voice path talks only to the Gemini API host', () => {
    const voice = read('scripts/pack-voice.mjs');
    expect(voice).toContain("endpoint: 'https://generativelanguage.googleapis.com/v1beta/models'");
    expect(voice).not.toMatch(/https:\/\/(?!generativelanguage\.googleapis\.com)[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it('the saver and the voice code never print or store the Gemini key', () => {
    for (const file of ['scripts/pack-voice.mjs', 'scripts/save-pack-media.mjs', 'scripts/pack-video.mjs']) {
      const text = read(file);
      expect(text, file).not.toMatch(/console\.log\([^)]*(geminiKey|apiKey|secret|FAKE_KEY)/i);
      expect(text, file).not.toMatch(/process\.stdout\.write\([^)]*(geminiKey|apiKey)/i);
    }
  });

  it('the RSS ping tests use a fake hub (no test reaches the real hub)', () => {
    expect(read('src/__tests__/rssDoors.test.ts')).toMatch(/fetchImpl|vi\.fn|fakeHub|async \(/);
    expect(read('src/__tests__/packVoice.test.ts')).not.toMatch(/fetch\((?!\s*\$?\{?\s*url)/);
  });
});

describe('Phase 8 freeze: the screens and feeds that must not break are still wired', () => {
  it('the podcast feed route and the Buddy and Connections surfaces are still in place', () => {
    expect(read('vercel.json')).toContain('"/podcast.xml"');
    expect(read('src/__tests__/buddyChangesScreen.test.tsx')).toContain('Show the paragraph');
    expect(read('src/__tests__/buddyJobsScreen.test.tsx')).toContain('Your jobs');
  });
});
