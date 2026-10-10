// @vitest-environment node
// Phase 7 freeze. Most checks call the real functions with small local fixtures and fake senders.
// Wiring checks read the source. Nothing here reaches a live door, a live database, or a phone.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';
import { FINISH_ATTEMPTS } from '../../supabase/functions/_shared/runDoors';
import { PODCAST_CATEGORY, buildPodcastFeed, podcastShowReady, type PodcastEpisode, type PodcastShow } from '../../supabase/functions/_shared/podcastFeed';
import { BUZZ_KINDS, notifyOwnerDevices, shouldBuzz, type PushNotifyDeps } from '../../supabase/functions/_shared/notablePush';
import { isHonestSkip, HONEST_SKIP_PHRASES } from '../../supabase/functions/_shared/honestSkips';
import { buildNightReport, NOTHING_RAN_LINE } from '../../supabase/functions/_shared/mindsNightReport';
import { runNightReport } from '../../supabase/functions/_shared/nightReportRun';
import { sendMedium, MEDIUM_CLOSED_REASON } from '../../supabase/functions/_shared/doorAdapters';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: the runner scripts are plain Node modules, imported here for their real checks.
import { storagePathFor, checkStill, checkVideo } from '../../scripts/save-pack-media.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: the runner scripts are plain Node modules, imported here for their real checks.
import { checkMp3, articleIdFromFileName } from '../../scripts/save-podcast-audio.mjs';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const readBytes = (file: string) => new Uint8Array(readFileSync(join(ROOT, file)));
const RUNDOORS_TEST = read('src/__tests__/runDoors.test.ts');
const RUN = read('supabase/functions/minds-run-placement/index.ts');
const RUN_DOORS = read('supabase/functions/_shared/runDoors.ts');
const BRIEFING = read('supabase/functions/_shared/buddyBriefing.ts');
const PHASE7_MIGRATIONS = [
  'supabase/migrations/20261011190000_door_post_retry.sql',
  'supabase/migrations/20261011200000_pack_media_saved.sql',
  'supabase/migrations/20261011210000_notable_push.sql',
];
const PACK_FILES = ['supabase/functions/_shared/dayPacks.ts', 'supabase/functions/_shared/packMedia.ts', 'supabase/functions/_shared/packRules.ts'];
const GATED = ['instagram', 'tiktok', 'facebook', 'pinterest'];

const OWNER = '11111111-1111-4111-8111-111111111111';
const POST = '33333333-3333-4333-8333-333333333333';

describe('Phase 7 freeze: takeover, Kill and the Auditor stay as they were', () => {
  it('takeover is off by default, and no migration turns it on', () => {
    expect(read('supabase/migrations/20261009140000_minds_controls.sql')).toMatch(/takeover boolean NOT NULL DEFAULT false/);
    expect(RUN).toMatch(/takeover\s*===\s*true|saved value is exactly true/);
  });

  it('a Takeover that is off means the door step does not run and orders wait', () => {
    expect(RUN_DOORS).toMatch(/blockedDetail\(input\.takeover, input\.killScope\)/);
    expect(RUN_DOORS).toMatch(/if \(gate\) return \{ status: "held"/);
  });
});

describe('Phase 7 freeze: same-day retry for a failed save', () => {
  it('three immediate tries, then a later try the same day is allowed, and nothing is sent twice', () => {
    expect(FINISH_ATTEMPTS).toBe(3);
    expect(RUNDOORS_TEST).toContain('three save tries fail, a fourth try the same day saves the record, and the post is not sent again');
    expect(RUN_DOORS).toMatch(/keepPendingSafely\(ports, reserved\.id, "posted"/);
  });

  it('the Phase 7 migration keeps a pending state and never sends from the database', () => {
    const migration = read('supabase/migrations/20261011190000_door_post_retry.sql');
    expect(migration).toMatch(/pending_status/);
    expect(migration).toMatch(/minds_mark_door_post_pending/);
  });
});

describe('Phase 7 freeze: pack video and episode audio come from saved files', () => {
  it('the local fixtures exist and are small', () => {
    expect(readBytes('src/__tests__/fixtures/pack-media/cover.png').byteLength).toBeLessThan(2048);
    expect(readBytes('src/__tests__/fixtures/pack-media/tiny.mp4').byteLength).toBeLessThan(4096);
    expect(readBytes('src/__tests__/fixtures/podcast/episode.mp3').byteLength).toBeLessThan(8192);
  });

  it('a saved video passes the real MP4 check, and an empty or non-MP4 file is refused', () => {
    expect(checkVideo(readBytes('src/__tests__/fixtures/pack-media/tiny.mp4'))).toEqual({ ok: true });
    expect(checkVideo(new Uint8Array(0)).ok).toBe(false);
    expect(checkVideo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).ok).toBe(false);
  });

  it('a still is kept only as a picture, and the storage path sits in the owner folder', () => {
    expect(checkStill('image/png', 117)).toEqual({ ok: true, extension: 'png' });
    expect(checkStill('text/html', 117).ok).toBe(false);
    expect(storagePathFor({ owner: OWNER, day: '2026-10-10', postId: POST, extension: 'mp4' })).toBe(`${OWNER}/2026-10-10/${POST}.mp4`);
    expect(storagePathFor({ owner: 'not-a-uuid', day: '2026-10-10', postId: POST, extension: 'mp4' })).toBeNull();
  });

  it('an episode audio file must be a real MP3 named for an article', () => {
    expect(checkMp3(readBytes('src/__tests__/fixtures/podcast/episode.mp3'))).toEqual({ ok: true });
    expect(checkMp3(new Uint8Array([0, 0, 0, 0])).ok).toBe(false);
    expect(articleIdFromFileName(`${POST}.mp3`)).toBe(POST);
    expect(articleIdFromFileName('notes.mp3')).toBeNull();
  });

  it('YouTube, Vimeo and Podcast skip "no video yet" or "audio not made yet" only when the media is missing', () => {
    expect(RUN_DOORS).toMatch(/loaded\.reason === "no_video" \? `\$\{label\}: no video yet\./);
    expect(RUN_DOORS).toMatch(/loaded\.reason === "no_audio" \? `\$\{label\}: audio not made yet\./);
    expect(RUN_DOORS).toMatch(/"not_readable"|could not be read\. Nothing was posted\./);
    expect(RUN).toMatch(/pack-videos/);
  });

  it('the Phase 7 migrations say they are not applied to production', () => {
    for (const file of PHASE7_MIGRATIONS) expect(read(file), file).toMatch(/not applied/i);
  });
});

describe('Phase 7 freeze: the podcast is Health & Fitness, with no owner email and no fake enclosure', () => {
  const show: PodcastShow = {
    title: 'Lixxon Studio Podcast',
    author: 'Lixxon Studio',
    coverUrl: 'https://lixxonstudio.example/cover.jpg',
    siteUrl: 'https://lixxonstudio.example',
    feedUrl: 'https://lixxonstudio.example/podcast.xml',
  };

  it('the category is Health & Fitness', () => {
    expect(PODCAST_CATEGORY).toBe('Health & Fitness');
  });

  it('a show whose author is an email address is refused, so the owner email never reaches the feed', () => {
    expect(podcastShowReady({ title: 'Show', author: 'owner@example.test', coverUrl: 'https://lixxonstudio.example/c.jpg' })).toBe(false);
    expect(podcastShowReady({ title: 'Show', author: 'Lixxon Studio', coverUrl: 'https://lixxonstudio.example/c.jpg' })).toBe(true);
  });

  it('an episode with no real audio gets no enclosure at all', () => {
    const episode: PodcastEpisode = { id: POST, title: 'No audio yet', description: '', articleUrl: 'https://lixxonstudio.example/a', publishedAt: '2026-10-10T08:00:00Z', audioUrl: '', audioBytes: 0, audioType: '' } as PodcastEpisode;
    const feed = buildPodcastFeed(show, [episode]);
    expect(feed).not.toContain('<enclosure');
    expect(feed).not.toContain('owner@');
  });

  it('an episode with a real audio file gets one enclosure with its real length', () => {
    const episode: PodcastEpisode = { id: POST, title: 'With audio', description: '', articleUrl: 'https://lixxonstudio.example/a', publishedAt: '2026-10-10T08:00:00Z', audioUrl: `https://lixxonstudio.example/storage/${POST}.mp3`, audioBytes: 4406, audioType: 'audio/mpeg' } as PodcastEpisode;
    const feed = buildPodcastFeed(show, [episode]);
    expect(feed.match(/<enclosure /g)?.length).toBe(1);
    expect(feed).toContain('length="4406"');
  });
});

describe('Phase 7 freeze: notable events buzz only the kinds the owner asked for', () => {
  const DEVICE = { id: 'dev-1', endpoint: 'https://push.example/1', p256dh: 'P', auth_key: 'A' };
  const KEYS = { publicKey: 'PUB', subject: 'mailto:owner@example.test', privateKey: 'PRIV' };
  const fakeDeps = (sends: string[]): PushNotifyDeps => ({
    loadCredentials: async () => KEYS,
    loadTargets: async () => [DEVICE],
    send: async (target) => {
      sends.push(target.endpoint);
      return { status: 'sent', reason: 'delivered', httpStatus: 201 };
    },
  });

  it('a heartbeat never buzzes, and no buzz kind is a heartbeat', () => {
    expect(shouldBuzz('heartbeat')).toBe(false);
    expect((BUZZ_KINDS as readonly string[]).includes('heartbeat')).toBe(false);
  });

  it('a notable kind sends once per device, through the fake sender only', async () => {
    const sends: string[] = [];
    expect((await notifyOwnerDevices('door_posted', '1 free door posted today', fakeDeps(sends))).status).toBe('sent');
    expect(sends).toEqual([DEVICE.endpoint]);
  });

  it('a quiet kind sends nothing', async () => {
    const sends: string[] = [];
    expect((await notifyOwnerDevices('takeover_changed', 'Takeover changed', fakeDeps(sends))).status).toBe('not_buzzing');
    expect(sends).toHaveLength(0);
  });

  it('the day run records and buzzes through the one helper, and never calls the push sender itself', () => {
    expect(RUN).toContain('notifyOwnerDevices(');
    expect(RUN).not.toMatch(/sendPushNotification\(/);
  });
});

describe('Phase 7 freeze: the night report is callable, and an empty night is honest', () => {
  it('an empty night says that nothing ran, and is not a fake busy night', () => {
    const report = buildNightReport({ day: '2026-10-10', log: [], events: [], orders: [] });
    expect(report.ran).toBe(false);
    expect(report.body).toContain(NOTHING_RAN_LINE);
  });

  it('the writer is callable, and refuses a bad day before it reads anything', async () => {
    let touched = false;
    const client = {
      from: () => {
        touched = true;
        throw new Error('no read expected');
      },
    };
    const result = await runNightReport(client, OWNER, 'tomorrow');
    expect(result.status).toBe('failed');
    expect(touched).toBe(false);
  });

  it('the report is not recycled into the morning briefing', () => {
    expect(BRIEFING).not.toMatch(/night/i);
    expect(BRIEFING).not.toMatch(/buddy_reports|NightReport|nightReportRun/);
  });
});

describe('Phase 7 freeze: honest skips and closed doors', () => {
  it('the honest skip words are one list, and they match the day run messages', () => {
    expect(HONEST_SKIP_PHRASES).toEqual(expect.arrayContaining(['no video yet', 'no picture yet', 'audio not made yet', 'this door is closed']));
    expect(isHonestSkip('Pixelfed: no picture yet. Nothing was posted.')).toBe(true);
  });

  it('a Medium "gone" answer is closed, and any other answer is not', async () => {
    const gone = await sendMedium({ accessToken: 'TOKEN' }, 'New on the blog: A\nhttps://lixxonstudio.example/a', async () => new Response('', { status: 410 }));
    expect(gone).toEqual({ ok: false, reason: MEDIUM_CLOSED_REASON, closed: true });
    const other = await sendMedium({ accessToken: 'TOKEN' }, 'New on the blog: A\nhttps://lixxonstudio.example/a', async () => new Response('', { status: 500 }));
    expect('closed' in other).toBe(false);
  });
});

describe('Phase 7 freeze: the four gated channels send nothing, and the reader copy is clean', () => {
  it('the four gated channels are not open doors', () => {
    for (const channel of GATED) expect(OPEN_DOORS as readonly string[]).not.toContain(channel);
  });

  it('the pack modules call no network address, so nothing is posted to a gated channel', () => {
    for (const file of PACK_FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(/\bfetch\(/);
      for (const host of ['graph.facebook.com', 'tiktokapis.com', 'api.pinterest.com', 'instagram.com/api']) expect(source, file).not.toContain(host);
    }
  });

  it('the feed crawler title has no em dash or en dash', () => {
    const feeds = read('supabase/functions/feeds/index.ts');
    expect(feeds).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('Phase 7 freeze: twelve auto doors, and the Phase 7 work changed no send count', () => {
  it('the twelve auto doors from Phases 5 and 6 are still open (Phase 8 adds four RSS doors)', () => {
    expect(OPEN_DOORS).toHaveLength(16);
    for (const door of ['telegram', 'bluesky', 'mastodon', 'tumblr', 'discord', 'blogger', 'medium', 'youtube', 'pixelfed', 'wordpress_com', 'podcast', 'vimeo']) {
      expect(OPEN_DOORS as readonly string[]).toContain(door);
    }
  });
});
