import { describe, expect, it } from 'vitest';
import { runDoors, DOORS_NOTHING_CONNECTED_DETAIL, type AudioLoad, type DoorRunPorts, type DoorSendExtra, type ReserveResult, type VideoLoad } from '../../supabase/functions/_shared/runDoors';
import { KILL_BLOCK_DETAIL, TAKEOVER_OFF_DETAIL } from '../../supabase/functions/_shared/runDay';
import type { DoorArticle } from '../../supabase/functions/_shared/doorPosts';
import type { DoorSendResult } from '../../supabase/functions/_shared/doorAdapters';
import type { ArticleImageLoad } from '../../supabase/functions/_shared/articleImage';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const SITE = 'https://lixxonstudio.example';
const TOKEN = 'TOKEN-SECRET-VALUE';
const HOOK = 'https://discord.com/api/webhooks/1/HOOK-SECRET-VALUE';

const ARTICLE: DoorArticle = {
  id: 'post-1',
  title: 'Easy routine for dry skin',
  slug: 'easy-routine-dry-skin',
  publishedAt: new Date(NOW - DAY).toISOString(),
  coverImage: '/assets/covers/dry-skin.jpg',
};

const PICTURE: ArticleImageLoad = { ok: true, url: `${SITE}/assets/covers/dry-skin.jpg`, contentType: 'image/jpeg', bytes: 4, data: new Uint8Array([1, 2, 3, 4]).buffer };

const ALL_SECRETS: Record<string, string> = {
  telegram_bot_token: TOKEN,
  telegram_chat_id: '-100123',
  discord_webhook_url: HOOK,
};

const YOUTUBE_SECRETS: Record<string, string> = {
  youtube_client_id: 'YT-CLIENT',
  youtube_client_secret: 'YT-CLIENT-SECRET',
  youtube_refresh_token: 'YT-REFRESH-SECRET',
};
const VIMEO_SECRETS: Record<string, string> = { vimeo_access_token: 'VIMEO-TOKEN-SECRET' };
const PODCAST_SECRETS: Record<string, string> = {
  podcast_show_title: 'Lixxon Show',
  podcast_show_author: 'Lixxon Studio',
  podcast_cover_url: 'https://lixxonstudio.example/podcast-cover.jpg',
};

/** A real MP4 from a pack, and a real MP3 episode, as the loaders would return them. */
const VIDEO_OK: VideoLoad = { ok: true, data: new Uint8Array([0, 0, 0, 24]).buffer, contentType: 'video/mp4', bytes: 4 };
const AUDIO_OK: AudioLoad = { ok: true, path: 'post-1.mp3', bytes: 2048, contentType: 'audio/mpeg' };

const TWELVE_DOOR_SECRETS: Record<string, string> = {
  ...ALL_SECRETS,
  bluesky_handle: 'lixxon.bsky.social',
  bluesky_app_password: 'APP-PASS-SECRET',
  mastodon_instance_url: 'https://mastodon.example',
  mastodon_access_token: 'MASTO-TOKEN-SECRET',
  tumblr_consumer_key: 'TUMBLR-KEY',
  tumblr_consumer_secret: 'TUMBLR-CONSUMER-SECRET',
  tumblr_access_token: 'TUMBLR-ACCESS',
  tumblr_token_secret: 'TUMBLR-TOKEN-SECRET',
  tumblr_blog_name: 'lixxon',
  blogger_client_id: 'BLOGGER-CLIENT',
  blogger_client_secret: 'BLOGGER-CLIENT-SECRET',
  blogger_refresh_token: 'BLOGGER-REFRESH',
  blogger_blog_id: '1234567890',
  medium_integration_token: 'MEDIUM-TOKEN-SECRET',
  pixelfed_instance_url: 'https://pixelfed.example',
  pixelfed_access_token: 'PIXELFED-TOKEN-SECRET',
  wordpress_com_site: 'lixxon.wordpress.com',
  wordpress_com_access_token: 'WORDPRESS-TOKEN-SECRET',
  ...YOUTUBE_SECRETS,
  ...VIMEO_SECRETS,
  ...PODCAST_SECRETS,
};

/** A queued row, as the database would hold it. */
interface QueuedRow {
  door: string;
  day: string;
  status: 'queued' | 'posted' | 'failed';
  pendingStatus: 'posted' | 'failed' | null;
  externalRef: string | null;
  errorNote: string | null;
}

interface Harness {
  ports: DoorRunPorts;
  /** Every reserved row, by id. */
  rows: Map<string, QueuedRow>;
  /** Every markPending call, in order. */
  marks: Array<{ id: string; status: string; externalRef: string | null; errorNote: string | null }>;
  sent: Array<{ door: string; text: string }>;
  keys: Array<{ door: string; key: string }>;
  reserved: string[];
  finished: Array<{ id: string; status: string; externalRef: string | null; errorNote: string | null }>;
  logs: Array<{ door: string; outcome: string; detail: string }>;
  finishAttempts: Record<string, number>;
  /** Which doors were sent, and which kind of file each send got (null for text only). Kept apart from `sent`. */
  media: Array<{ door: string; kind: 'image' | 'video' | 'audio' | null }>;
  /** Every send's extra, as the door received it. */
  extras: Array<{ door: string; extra: DoorSendExtra }>;
  /** The cover addresses the picture loader was asked for. */
  loadedCovers: string[];
  /** The article ids the video and audio loaders were asked for. */
  loadedVideo: string[];
  loadedAudio: string[];
}

function harness(options: {
  secrets?: Record<string, string>;
  articles?: DoorArticle[];
  postedIds?: Record<string, string[]>;
  todayCount?: Record<string, number>;
  reserve?: (door: string) => ReserveResult;
  send?: (door: string) => DoorSendResult;
  /** Return true to make a save attempt fail. `attempt` counts from 1 for each row. */
  finishFail?: (id: string, attempt: number) => boolean;
  readSecretThrows?: boolean;
  reserveThrows?: boolean;
  sendThrows?: boolean;
  /** The picture loader. Default: a good JPEG. */
  loadImage?: (cover: string) => ArticleImageLoad;
  /** Makes the markPending write fail, as if the database were down. */
  markPendingFails?: boolean;
  /** The pack video loader. Default: a real MP4. */
  loadVideo?: (articleId: string) => VideoLoad;
  /** The episode audio loader. Default: a real MP3. */
  loadAudio?: (articleId: string) => AudioLoad;
} = {}): Harness {
  const finishAttempts: Record<string, number> = {};
  const secrets = options.secrets ?? ALL_SECRETS;
  const sent: Harness['sent'] = [];
  const keys: Harness['keys'] = [];
  const reserved: string[] = [];
  const finished: Harness['finished'] = [];
  const logs: Harness['logs'] = [];
  const media: Harness['media'] = [];
  const extras: Harness['extras'] = [];
  const loadedCovers: string[] = [];
  const loadedVideo: string[] = [];
  const loadedAudio: string[] = [];
  const rows = new Map<string, QueuedRow>();
  const marks: Harness['marks'] = [];
  const ports: DoorRunPorts = {
    readArticles: async () => options.articles ?? [ARTICLE],
    readPostedIds: async (door) => new Set(options.postedIds?.[door] ?? []),
    countToday: async (door) => options.todayCount?.[door] ?? 0,
    readSecret: async (name) => {
      if (options.readSecretThrows) throw new Error('vault');
      return secrets[name] ?? null;
    },
    reserve: async (door, articleId, localDay) => {
      if (options.reserveThrows) throw new Error('database');
      reserved.push(`${door}:${articleId}`);
      const result = options.reserve ? options.reserve(door) : { ok: true as const, id: `row-${door}` };
      if (result.ok) rows.set(result.id, { door, day: localDay, status: 'queued', pendingStatus: null, externalRef: null, errorNote: null });
      return result;
    },
    readPendingPosts: async (door, day) =>
      [...rows.entries()]
        .filter(([, row]) => row.door === door && row.day === day && row.status === 'queued')
        .map(([id, row]) => ({ id, pendingStatus: row.pendingStatus, externalRef: row.externalRef, errorNote: row.errorNote })),
    markPending: async (id, status, externalRef, errorNote) => {
      if (options.markPendingFails) throw new Error('mark');
      marks.push({ id, status, externalRef, errorNote });
      const row = rows.get(id);
      if (row) {
        row.pendingStatus = status;
        row.externalRef = externalRef;
        row.errorNote = errorNote;
      }
    },
    loadImage: async (cover) => {
      loadedCovers.push(cover);
      return options.loadImage ? options.loadImage(cover) : PICTURE;
    },
    loadVideo: async (articleId) => {
      loadedVideo.push(articleId);
      return options.loadVideo ? options.loadVideo(articleId) : VIDEO_OK;
    },
    loadAudio: async (articleId) => {
      loadedAudio.push(articleId);
      return options.loadAudio ? options.loadAudio(articleId) : AUDIO_OK;
    },
    send: async (door, _values, text, key, extra) => {
      if (options.sendThrows) throw new Error('send');
      sent.push({ door, text });
      media.push({ door, kind: extra.media ? extra.media.kind : null });
      extras.push({ door, extra });
      keys.push({ door, key });
      return options.send ? options.send(door) : { ok: true, externalRef: `ref-${door}` };
    },
    finish: async (id, status, externalRef, errorNote) => {
      finishAttempts[id] = (finishAttempts[id] ?? 0) + 1;
      if (options.finishFail?.(id, finishAttempts[id])) throw new Error('finish');
      finished.push({ id, status, externalRef, errorNote });
      const row = rows.get(id);
      if (row) {
        row.status = status;
        row.externalRef = externalRef;
        row.errorNote = errorNote;
      }
    },
    log: async (entry) => {
      logs.push(entry);
    },
    pause: async () => {},
  };
  return { ports, sent, keys, reserved, finished, logs, finishAttempts, media, extras, loadedCovers, loadedVideo, loadedAudio, rows, marks };
}

const DAY_INPUT = { localDay: '2026-10-10', takeover: true, killScope: 'none' as const, nowMs: NOW, siteOrigin: SITE };

describe('the door step is held when it is not allowed to run', () => {
  it('Takeover off: nothing is read, reserved, sent or logged', async () => {
    const h = harness();
    const result = await runDoors({ ...DAY_INPUT, takeover: false }, h.ports);
    expect(result).toEqual({ status: 'held', detail: TAKEOVER_OFF_DETAIL, posted: 0, outcomes: [] });
    expect(h.sent).toHaveLength(0);
    expect(h.reserved).toHaveLength(0);
  });

  it('Kill on all, or on the Executioner: held, nothing is sent', async () => {
    for (const killScope of ['all', 'executioner'] as const) {
      const h = harness();
      const result = await runDoors({ ...DAY_INPUT, killScope }, h.ports);
      expect(result.status).toBe('held');
      expect(result.detail).toBe(KILL_BLOCK_DETAIL);
      expect(h.sent).toHaveLength(0);
    }
  });

  it('the database refuses the reservation because Takeover went off: the step stops and nothing is sent', async () => {
    const h = harness({ reserve: () => ({ ok: false, reason: 'takeover_off' }) });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.status).toBe('held');
    expect(result.detail).toBe(TAKEOVER_OFF_DETAIL);
    expect(h.sent).toHaveLength(0);
  });
});

describe('a door posts only when it is fully connected', () => {
  it('nothing connected: nothing to do, with the plain Connections message', async () => {
    const h = harness({ secrets: {} });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.status).toBe('nothing_to_do');
    expect(result.detail).toBe(DOORS_NOTHING_CONNECTED_DETAIL);
    expect(h.sent).toHaveLength(0);
    expect(h.reserved).toHaveLength(0);
  });

  it('Telegram with only the token saved is not connected: it is not posted to', async () => {
    const h = harness({ secrets: { telegram_bot_token: TOKEN } });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'telegram')?.outcome).toBe('not_connected');
    expect(h.sent.some((item) => item.door === 'telegram')).toBe(false);
  });

  it('a connected door posts the newest article, records the reference, and logs it', async () => {
    const h = harness({ secrets: { discord_webhook_url: HOOK } });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.status).toBe('done');
    expect(result.posted).toBe(1);
    expect(h.sent).toEqual([{ door: 'discord', text: `New on the blog: Easy routine for dry skin\n${SITE}/blog/easy-routine-dry-skin` }]);
    expect(h.finished).toEqual([{ id: 'row-discord', status: 'posted', externalRef: 'ref-discord', errorNote: null }]);
    expect(h.logs).toEqual([{ door: 'discord', outcome: 'done', detail: 'Posted to Discord: "Easy routine for dry skin".' }]);
    expect(result.detail).toBe('Posted to Discord: "Easy routine for dry skin". Not connected yet: Telegram, Bluesky, Mastodon, Tumblr, Blogger, Medium, Pixelfed, WordPress.com, YouTube, Vimeo, Podcast.');
  });

  it('both connected doors can post on the same day, one article each', async () => {
    const h = harness();
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.posted).toBe(2);
    expect(h.sent.map((item) => item.door)).toEqual(['telegram', 'discord']);
    expect(result.detail).toContain('Not connected yet: Bluesky, Mastodon, Tumblr, Blogger, Medium, Pixelfed, WordPress.com, YouTube, Vimeo, Podcast.');
  });

  it('all twelve auto doors can post, in order, each with its own reserved row as the key', async () => {
    const h = harness({ secrets: TWELVE_DOOR_SECRETS });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.status).toBe('done');
    expect(result.posted).toBe(12);
    expect(h.sent.map((item) => item.door)).toEqual(['telegram', 'discord', 'bluesky', 'mastodon', 'tumblr', 'blogger', 'medium', 'pixelfed', 'wordpress_com', 'youtube', 'vimeo', 'podcast']);
    expect(h.keys.map((item) => item.key)).toEqual(h.sent.map((item) => `row-${item.door}`));
    expect(result.detail).not.toContain('Not connected yet');
  });

  it('only Pixelfed takes a picture, only YouTube and Vimeo take a video, only Podcast takes audio, and the link doors take none', async () => {
    const h = harness({ secrets: TWELVE_DOOR_SECRETS });
    await runDoors(DAY_INPUT, h.ports);
    const kinds = (kind: string) => h.media.filter((item) => item.kind === kind).map((item) => item.door);
    expect(kinds('image')).toEqual(['pixelfed']);
    expect(kinds('video')).toEqual(['youtube', 'vimeo']);
    expect(kinds('audio')).toEqual(['podcast']);
    expect(h.media.filter((item) => item.kind === null).map((item) => item.door)).toEqual(['telegram', 'discord', 'bluesky', 'mastodon', 'tumblr', 'blogger', 'medium', 'wordpress_com']);
  });

  it('Medium and WordPress.com get the same short line and link as the other link doors', async () => {
    const h = harness({ secrets: TWELVE_DOOR_SECRETS });
    await runDoors(DAY_INPUT, h.ports);
    const link = `${SITE}/blog/easy-routine-dry-skin`;
    expect(h.sent.find((item) => item.door === 'medium')?.text).toBe(`New on the blog: Easy routine for dry skin\n${link}`);
    expect(h.sent.find((item) => item.door === 'wordpress_com')?.text).toBe(`New on the blog: Easy routine for dry skin\n${link}`);
  });

  it('Pixelfed is picked from an article that has a picture, even when a newer article has none', async () => {
    const newer = { ...ARTICLE, id: 'post-2', slug: 'no-picture-yet', title: 'No picture yet', coverImage: null, publishedAt: new Date(NOW - DAY / 2).toISOString() };
    const h = harness({ secrets: { pixelfed_instance_url: 'https://pixelfed.example', pixelfed_access_token: 'PIXELFED-TOKEN-SECRET' }, articles: [newer, ARTICLE] });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'pixelfed')?.outcome).toBe('posted');
    expect(h.sent[0].text).toContain('Easy routine for dry skin');
    expect(h.loadedCovers).toEqual(['/assets/covers/dry-skin.jpg']);
  });

  it('Pixelfed with no article picture is skipped before anything is reserved, and says why', async () => {
    const h = harness({
      secrets: { pixelfed_instance_url: 'https://pixelfed.example', pixelfed_access_token: 'PIXELFED-TOKEN-SECRET' },
      articles: [{ ...ARTICLE, coverImage: null }],
    });
    const result = await runDoors(DAY_INPUT, h.ports);
    const outcome = result.outcomes.find((item) => item.door === 'pixelfed');
    expect(outcome?.outcome).toBe('skipped');
    expect(outcome?.detail).toBe('Pixelfed: no new article with a picture to post yet.');
    expect(h.reserved).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('Pixelfed with a picture that cannot be used is skipped before anything is reserved, and nothing is sent', async () => {
    const h = harness({
      secrets: { pixelfed_instance_url: 'https://pixelfed.example', pixelfed_access_token: 'PIXELFED-TOKEN-SECRET' },
      loadImage: () => ({ ok: false, reason: 'not_an_image' }),
    });
    const result = await runDoors(DAY_INPUT, h.ports);
    const outcome = result.outcomes.find((item) => item.door === 'pixelfed');
    expect(outcome?.outcome).toBe('skipped');
    expect(outcome?.detail).toContain('did not point to a picture');
    expect(h.reserved).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('a picture loader that throws skips Pixelfed the same way, and the other doors still run', async () => {
    const h = harness({
      secrets: { ...ALL_SECRETS, pixelfed_instance_url: 'https://pixelfed.example', pixelfed_access_token: 'PIXELFED-TOKEN-SECRET' },
      loadImage: () => {
        throw new Error('network');
      },
    });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'pixelfed')?.outcome).toBe('skipped');
    expect(result.outcomes.find((item) => item.door === 'telegram')?.outcome).toBe('posted');
    expect(h.reserved.some((item) => item.startsWith('pixelfed:'))).toBe(false);
  });

  it('a Bluesky post stays within its 300-character limit, even with a long title', async () => {
    const h = harness({
      secrets: { bluesky_handle: 'lixxon.bsky.social', bluesky_app_password: 'APP-PASS-SECRET' },
      articles: [{ ...ARTICLE, title: 'A very long title '.repeat(40).trim() }],
    });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.posted).toBe(1);
    const text = h.sent.find((item) => item.door === 'bluesky')?.text ?? '';
    expect(Array.from(text).length).toBeLessThanOrEqual(300);
    expect(text.endsWith(`\n${SITE}/blog/easy-routine-dry-skin`)).toBe(true);
  });

  it('a Bluesky article whose link cannot fit is skipped with a plain reason, and nothing is sent', async () => {
    const h = harness({
      secrets: { bluesky_handle: 'lixxon.bsky.social', bluesky_app_password: 'APP-PASS-SECRET' },
      articles: [{ ...ARTICLE, slug: 'a'.repeat(290) }],
    });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(h.sent).toHaveLength(0);
    expect(result.outcomes.find((item) => item.door === 'bluesky')?.detail).toBe('Bluesky: the article link is too long for this door.');
  });
});

describe('the caps, the history, and the failures', () => {
  it('a door that already has a post today is skipped, and nothing is reserved for it', async () => {
    const h = harness({ todayCount: { telegram: 1 } });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'telegram')?.detail).toBe('Telegram: already posted today.');
    expect(h.reserved.some((item) => item.startsWith('telegram:'))).toBe(false);
    expect(h.sent.some((item) => item.door === 'telegram')).toBe(false);
  });

  it('an article a door already has is never sent again', async () => {
    const h = harness({ postedIds: { discord: ['post-1'] }, secrets: { discord_webhook_url: HOOK } });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.posted).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(result.detail).toContain('Discord: no new article to post yet.');
  });

  it('a title with a dash or a country name is not sent, with a plain reason', async () => {
    const h = harness({ articles: [{ ...ARTICLE, title: 'Routine — easy' }], secrets: { discord_webhook_url: HOOK } });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(h.sent).toHaveLength(0);
    expect(result.detail).toContain('Discord: the newest article title has text that cannot be posted.');
  });

  it('a send that fails is recorded as failed with a plain reason, and the next run can use the next article', async () => {
    const h = harness({
      secrets: { discord_webhook_url: HOOK },
      send: () => ({ ok: false, reason: 'Discord did not find that webhook.' }),
    });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.posted).toBe(0);
    expect(h.finished).toEqual([{ id: 'row-discord', status: 'failed', externalRef: null, errorNote: 'Discord did not find that webhook.' }]);
    expect(h.logs[0]).toEqual({ door: 'discord', outcome: 'failed', detail: 'Discord did not take it: Discord did not find that webhook.' });
    expect(result.detail).toContain('Discord did not take it: Discord did not find that webhook.');
  });

  it('a reservation that is already taken is skipped, not treated as held', async () => {
    const h = harness({ secrets: { discord_webhook_url: HOOK }, reserve: () => ({ ok: false, reason: 'door_day_cap' }) });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.status).toBe('done');
    expect(result.outcomes.find((item) => item.door === 'discord')?.outcome).toBe('skipped');
    expect(h.sent).toHaveLength(0);
  });

  it('a read of the articles that throws is not swallowed by the runner', async () => {
    const h = harness({ secrets: { discord_webhook_url: HOOK } });
    h.ports.readArticles = async () => {
      throw new Error('articles');
    };
    await expect(runDoors(DAY_INPUT, h.ports)).rejects.toThrow('articles');
    expect(h.sent).toHaveLength(0);
  });
});

describe('a failed save never stops the other doors, and never sends a door twice in one day', () => {
  const SECOND_ARTICLE: DoorArticle = { ...ARTICLE, id: 'post-2', title: 'Second article', slug: 'second-article' };

  it('a save that fails once and then works: the door is recorded as posted, and the others still post', async () => {
    const h = harness({ secrets: ALL_SECRETS, finishFail: (id, attempt) => id === 'row-telegram' && attempt === 1 });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(h.finishAttempts['row-telegram']).toBe(2);
    expect(h.finished).toContainEqual({ id: 'row-telegram', status: 'posted', externalRef: 'ref-telegram', errorNote: null });
    expect(result.posted).toBe(2);
    expect(h.sent.map((item) => item.door)).toEqual(['telegram', 'discord']);
    expect(result.detail).not.toContain('could not be saved');
  });

  it('a save that fails every time: the post is reported as posted with a plain note, the log says so, and Discord still posts', async () => {
    const h = harness({ secrets: ALL_SECRETS, finishFail: (id) => id === 'row-telegram' });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(h.finishAttempts['row-telegram']).toBe(3);
    expect(result.status).toBe('done');
    expect(result.outcomes.find((item) => item.door === 'telegram')?.detail).toBe('Telegram: posted, but the record could not be saved. Check the log.');
    expect(h.logs).toContainEqual({ door: 'telegram', outcome: 'failed', detail: 'Telegram: posted, but the record could not be saved. Check the log.' });
    expect(h.sent.map((item) => item.door)).toEqual(['telegram', 'discord']);
    expect(result.posted).toBe(2);
    expect(result.detail).not.toContain('Nothing was posted');
  });

  it('after a save that failed, a later run the same day saves the record again, and never sends the post twice', async () => {
    const h = harness({
      secrets: { telegram_bot_token: TOKEN, telegram_chat_id: '-100123' },
      articles: [ARTICLE, SECOND_ARTICLE],
      finishFail: () => true,
    });
    await runDoors(DAY_INPUT, h.ports);
    const again = await runDoors(DAY_INPUT, h.ports);
    expect(h.sent.filter((item) => item.door === 'telegram')).toHaveLength(1);
    expect(again.outcomes.find((item) => item.door === 'telegram')?.detail).toBe('Telegram: posted, but the record could not be saved. Check the log.');
  });

  it('the next local day, the door posts again: the next article, not the one already sent', async () => {
    const h = harness({
      secrets: { telegram_bot_token: TOKEN, telegram_chat_id: '-100123' },
      articles: [ARTICLE, SECOND_ARTICLE],
      postedIds: { telegram: ['post-1'] },
    });
    const result = await runDoors({ ...DAY_INPUT, localDay: '2026-10-11' }, h.ports);
    expect(result.posted).toBe(1);
    expect(h.sent[0].text).toContain('Second article');
    expect(h.reserved).toEqual(['telegram:post-2']);
  });

  it('a send that throws is recorded as failed, and the other doors still run', async () => {
    const h = harness({ secrets: ALL_SECRETS, sendThrows: true });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(h.finished.every((item) => item.status === 'failed')).toBe(true);
    expect(result.outcomes.filter((item) => item.outcome !== 'not_connected').map((item) => item.outcome)).toEqual(['failed', 'failed']);
    expect(result.outcomes[0].detail).toBe('Telegram did not take it: Could not reach the door.');
  });

  it('a reservation that throws (the database is down): that door is skipped with "nothing was posted", the others run', async () => {
    const h = harness({ secrets: ALL_SECRETS, reserveThrows: true });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'telegram')?.detail).toBe('Telegram: could not start the post. Nothing was posted.');
    expect(h.sent).toHaveLength(0);
    expect(result.status).toBe('done');
  });

  it('a read of the saved values that throws: that door is skipped, and nothing is sent for it', async () => {
    const h = harness({ secrets: ALL_SECRETS, readSecretThrows: true });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(h.sent).toHaveLength(0);
    expect(result.outcomes.every((item) => item.outcome === 'skipped')).toBe(true);
  });

  it('Kill on the Executioner: no saved value is read, nothing is reserved or sent', async () => {
    const h = harness({ secrets: ALL_SECRETS, readSecretThrows: true });
    const result = await runDoors({ ...DAY_INPUT, killScope: 'executioner' }, h.ports);
    expect(result.status).toBe('held');
    expect(h.sent).toHaveLength(0);
    expect(h.reserved).toHaveLength(0);
  });
});

describe('no secret value leaves the step', () => {
  it('neither the details, the logs nor the reply hold a token or a webhook address', async () => {
    const h = harness({
      send: (door) => (door === 'telegram' ? { ok: false, reason: 'Telegram did not take the message.' } : { ok: true, externalRef: null }),
    });
    const result = await runDoors(DAY_INPUT, h.ports);
    const everything = JSON.stringify([result, h.logs, h.finished]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('HOOK-SECRET-VALUE');
  });
});

describe('the video and audio doors send only a real file, and skip honestly without one', () => {
  it('YouTube with no pack video yet is skipped with "no video yet", before anything is reserved', async () => {
    const h = harness({ secrets: YOUTUBE_SECRETS, loadVideo: () => ({ ok: false, reason: 'no_video' }) });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'youtube')).toEqual({ door: 'youtube', outcome: 'skipped', detail: 'YouTube: no video yet. Nothing was posted.' });
    expect(h.reserved).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
    expect(result.posted).toBe(0);
  });

  it('Vimeo with no pack video yet is skipped the same way, and says so in plain words', async () => {
    const h = harness({ secrets: VIMEO_SECRETS, loadVideo: () => ({ ok: false, reason: 'no_video' }) });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'vimeo')?.detail).toBe('Vimeo: no video yet. Nothing was posted.');
    expect(h.sent).toHaveLength(0);
  });

  it('a video that cannot be read is skipped with a plain reason, and nothing is reserved', async () => {
    const h = harness({ secrets: YOUTUBE_SECRETS, loadVideo: () => ({ ok: false, reason: 'not_readable' }) });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'youtube')?.detail).toBe('YouTube: the video could not be read. Nothing was posted.');
    expect(h.reserved).toHaveLength(0);
  });

  it('a video loader that throws skips the door, and the other doors still run', async () => {
    const h = harness({
      secrets: { ...YOUTUBE_SECRETS, ...ALL_SECRETS },
      loadVideo: () => { throw new Error('storage down'); },
    });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'youtube')?.outcome).toBe('skipped');
    expect(result.outcomes.find((item) => item.door === 'telegram')?.outcome).toBe('posted');
  });

  it('a door that is not connected never loads the video or the audio', async () => {
    const h = harness({ secrets: ALL_SECRETS });
    await runDoors(DAY_INPUT, h.ports);
    expect(h.loadedVideo).toHaveLength(0);
    expect(h.loadedAudio).toHaveLength(0);
  });

  it('YouTube with a real video is sent that video, with the article title, and is posted', async () => {
    const h = harness({ secrets: YOUTUBE_SECRETS });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'youtube')?.outcome).toBe('posted');
    const sendExtra = h.extras.find((item) => item.door === 'youtube')?.extra;
    expect(sendExtra?.media?.kind).toBe('video');
    expect(sendExtra?.media && 'contentType' in sendExtra.media ? sendExtra.media.contentType : '').toBe('video/mp4');
    expect(sendExtra?.media && 'bytes' in sendExtra.media ? sendExtra.media.bytes : 0).toBe(4);
    expect(sendExtra?.title).toBe('Easy routine for dry skin');
    expect(sendExtra?.articleId).toBe('post-1');
    expect(h.loadedVideo).toEqual(['post-1']);
    expect(h.finished).toEqual([{ id: 'row-youtube', status: 'posted', externalRef: 'ref-youtube', errorNote: null }]);
  });

  it('a YouTube upload Google kept private is posted with the honest note, not called public', async () => {
    const note = 'YouTube kept it private: the Google app is not yet approved for public uploads.';
    const h = harness({ secrets: YOUTUBE_SECRETS, send: () => ({ ok: true, externalRef: 'yt-1', note }) });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'youtube')?.detail).toContain(note);
    expect(h.logs.find((item) => item.door === 'youtube')?.detail).toContain('private');
    expect(result.detail).not.toMatch(/made public|is public/i);
  });

  it('Podcast with no audio file yet is skipped with "audio not made yet", and no episode row is written', async () => {
    const h = harness({ secrets: PODCAST_SECRETS, loadAudio: () => ({ ok: false, reason: 'no_audio' }) });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'podcast')).toEqual({ door: 'podcast', outcome: 'skipped', detail: 'Podcast: audio not made yet. Nothing was posted.' });
    expect(h.reserved).toHaveLength(0);
    expect(h.sent.some((item) => item.door === 'podcast')).toBe(false);
  });

  it('Podcast with an audio file is sent the episode fields, and is posted', async () => {
    const h = harness({ secrets: PODCAST_SECRETS });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'podcast')?.outcome).toBe('posted');
    const sendExtra = h.extras.find((item) => item.door === 'podcast')?.extra;
    expect(sendExtra?.media).toEqual({ kind: 'audio', path: 'post-1.mp3', bytes: 2048, contentType: 'audio/mpeg' });
    expect(sendExtra?.articleUrl).toBe(`${SITE}/blog/easy-routine-dry-skin`);
    expect(h.loadedAudio).toEqual(['post-1']);
  });

  it('audio that is not an MP3 is skipped with a plain reason, and nothing is reserved', async () => {
    const h = harness({ secrets: PODCAST_SECRETS, loadAudio: () => ({ ok: false, reason: 'not_readable' }) });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'podcast')?.detail).toBe('Podcast: the audio could not be read. Nothing was posted.');
    expect(h.reserved).toHaveLength(0);
  });

  it('a video or audio door is never sent a fake or empty file: the send is only ever given the loaded bytes', async () => {
    const h = harness({ secrets: { ...YOUTUBE_SECRETS, ...VIMEO_SECRETS, ...PODCAST_SECRETS } });
    await runDoors(DAY_INPUT, h.ports);
    for (const item of h.extras) {
      if (item.extra.media?.kind === 'video') expect(item.extra.media.bytes).toBeGreaterThan(0);
      if (item.extra.media?.kind === 'audio') expect(item.extra.media.bytes).toBeGreaterThan(0);
    }
  });
});

describe('a save that failed is tried again later the same day, and the post is never sent twice', () => {
  const SECOND_ARTICLE: DoorArticle = { ...ARTICLE, id: 'post-2', title: 'Second article', slug: 'second-article' };
  const TELEGRAM_SECRETS = { telegram_bot_token: TOKEN, telegram_chat_id: '-100123' };
  const isTelegram = (item: { door: string }) => item.door === 'telegram';

  it('three save tries fail, a fourth try the same day saves the record, and the post is not sent again', async () => {
    const h = harness({
      secrets: TELEGRAM_SECRETS,
      articles: [ARTICLE, SECOND_ARTICLE],
      finishFail: (id, attempt) => id === 'row-telegram' && attempt <= 3,
    });
    const first = await runDoors(DAY_INPUT, h.ports);
    expect(first.outcomes.find(isTelegram)?.detail).toBe('Telegram: posted, but the record could not be saved. Check the log.');
    expect(h.rows.get('row-telegram')?.pendingStatus).toBe('posted');
    expect(h.marks).toEqual([{ id: 'row-telegram', status: 'posted', externalRef: 'ref-telegram', errorNote: null }]);

    const second = await runDoors(DAY_INPUT, h.ports);
    expect(h.finishAttempts['row-telegram']).toBe(4);
    expect(second.outcomes.find(isTelegram)).toEqual({
      door: 'telegram',
      outcome: 'posted',
      detail: 'Posted to Telegram: the record was saved on a later try today.',
    });
    expect(h.finished).toContainEqual({ id: 'row-telegram', status: 'posted', externalRef: 'ref-telegram', errorNote: null });
    expect(h.sent.filter(isTelegram)).toHaveLength(1);
    expect(h.reserved.filter((item) => item === 'telegram:post-1')).toHaveLength(1);
  });

  it('a save that keeps failing on later runs the same day: no second send, and the door is still open to try the save again', async () => {
    const h = harness({
      secrets: TELEGRAM_SECRETS,
      articles: [ARTICLE, SECOND_ARTICLE],
      finishFail: (id) => id === 'row-telegram',
    });
    await runDoors(DAY_INPUT, h.ports);
    const second = await runDoors(DAY_INPUT, h.ports);
    const third = await runDoors(DAY_INPUT, h.ports);
    expect(h.sent.filter(isTelegram)).toHaveLength(1);
    expect(second.outcomes.find(isTelegram)?.detail).toBe('Telegram: posted, but the record could not be saved. Check the log.');
    expect(third.outcomes.find(isTelegram)?.detail).toBe('Telegram: posted, but the record could not be saved. Check the log.');
    expect(h.finishAttempts['row-telegram']).toBe(9);
  });

  it('when the state of the earlier send is unknown, nothing is sent again today, and the log says why', async () => {
    const h = harness({
      secrets: TELEGRAM_SECRETS,
      articles: [ARTICLE, SECOND_ARTICLE],
      finishFail: () => true,
      markPendingFails: true,
    });
    await runDoors(DAY_INPUT, h.ports);
    const again = await runDoors(DAY_INPUT, h.ports);
    expect(h.sent.filter(isTelegram)).toHaveLength(1);
    expect(again.outcomes.find(isTelegram)).toEqual({
      door: 'telegram',
      outcome: 'skipped',
      detail: 'Telegram: an earlier post today needs a look. Nothing new was posted.',
    });
    expect(h.logs).toContainEqual({
      door: 'telegram',
      outcome: 'failed',
      detail: 'Telegram: an earlier post today has no saved state. It was not sent again. Check the log.',
    });
  });

  it('a send that failed and whose record could not be saved is saved as failed on a later run, and not sent again', async () => {
    const h = harness({
      secrets: TELEGRAM_SECRETS,
      articles: [ARTICLE, SECOND_ARTICLE],
      send: () => ({ ok: false, reason: 'Telegram did not take the message.' }),
      finishFail: (id, attempt) => id === 'row-telegram' && attempt <= 3,
    });
    const first = await runDoors(DAY_INPUT, h.ports);
    expect(first.outcomes.find(isTelegram)?.detail).toBe('Telegram did not take it: Telegram did not take the message.');
    expect(h.marks).toEqual([{ id: 'row-telegram', status: 'failed', externalRef: null, errorNote: 'Telegram did not take the message.' }]);

    const second = await runDoors(DAY_INPUT, h.ports);
    expect(second.outcomes.find(isTelegram)).toEqual({
      door: 'telegram',
      outcome: 'failed',
      detail: 'Telegram did not take it: Telegram did not take the message.',
    });
    expect(h.finished).toContainEqual({ id: 'row-telegram', status: 'failed', externalRef: null, errorNote: 'Telegram did not take the message.' });
    expect(h.sent.filter(isTelegram)).toHaveLength(1);
  });

  it('the next local day is not locked: the same door posts again with a new row', async () => {
    let n = 0;
    const h = harness({
      secrets: TELEGRAM_SECRETS,
      articles: [ARTICLE, SECOND_ARTICLE],
      reserve: () => ({ ok: true, id: `row-telegram-${++n}` }),
      finishFail: (id, attempt) => id === 'row-telegram-1' && attempt <= 3,
    });
    await runDoors(DAY_INPUT, h.ports);
    const nextDay = await runDoors({ ...DAY_INPUT, localDay: '2026-10-11' }, h.ports);
    expect(nextDay.outcomes.find(isTelegram)?.outcome).toBe('posted');
    expect(h.sent.filter(isTelegram)).toHaveLength(2);
    expect(h.rows.get('row-telegram-1')?.status).toBe('queued');
  });
});
