import { describe, expect, it } from 'vitest';
import { runDoors, DOORS_NOTHING_CONNECTED_DETAIL, type DoorRunPorts, type ReserveResult } from '../../supabase/functions/_shared/runDoors';
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

const NINE_DOOR_SECRETS: Record<string, string> = {
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
};

interface Harness {
  ports: DoorRunPorts;
  sent: Array<{ door: string; text: string }>;
  keys: Array<{ door: string; key: string }>;
  reserved: string[];
  finished: Array<{ id: string; status: string; externalRef: string | null; errorNote: string | null }>;
  logs: Array<{ door: string; outcome: string; detail: string }>;
  finishAttempts: Record<string, number>;
  /** Which doors were sent, and whether each send got a picture. Kept apart from `sent`. */
  images: Array<{ door: string; hasImage: boolean }>;
  /** The cover addresses the picture loader was asked for. */
  loadedCovers: string[];
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
} = {}): Harness {
  const finishAttempts: Record<string, number> = {};
  const secrets = options.secrets ?? ALL_SECRETS;
  const sent: Harness['sent'] = [];
  const keys: Harness['keys'] = [];
  const reserved: string[] = [];
  const finished: Harness['finished'] = [];
  const logs: Harness['logs'] = [];
  const images: Harness['images'] = [];
  const loadedCovers: string[] = [];
  const ports: DoorRunPorts = {
    readArticles: async () => options.articles ?? [ARTICLE],
    readPostedIds: async (door) => new Set(options.postedIds?.[door] ?? []),
    countToday: async (door) => options.todayCount?.[door] ?? 0,
    readSecret: async (name) => {
      if (options.readSecretThrows) throw new Error('vault');
      return secrets[name] ?? null;
    },
    reserve: async (door, articleId) => {
      if (options.reserveThrows) throw new Error('database');
      reserved.push(`${door}:${articleId}`);
      return options.reserve ? options.reserve(door) : { ok: true, id: `row-${door}` };
    },
    loadImage: async (cover) => {
      loadedCovers.push(cover);
      return options.loadImage ? options.loadImage(cover) : PICTURE;
    },
    send: async (door, _values, text, key, image) => {
      if (options.sendThrows) throw new Error('send');
      sent.push({ door, text });
      images.push({ door, hasImage: image !== null });
      keys.push({ door, key });
      return options.send ? options.send(door) : { ok: true, externalRef: `ref-${door}` };
    },
    finish: async (id, status, externalRef, errorNote) => {
      finishAttempts[id] = (finishAttempts[id] ?? 0) + 1;
      if (options.finishFail?.(id, finishAttempts[id])) throw new Error('finish');
      finished.push({ id, status, externalRef, errorNote });
    },
    log: async (entry) => {
      logs.push(entry);
    },
    pause: async () => {},
  };
  return { ports, sent, keys, reserved, finished, logs, finishAttempts, images, loadedCovers };
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
    expect(result.detail).toBe('Posted to Discord: "Easy routine for dry skin". Not connected yet: Telegram, Bluesky, Mastodon, Tumblr, Blogger, Medium, Pixelfed, WordPress.com.');
  });

  it('both connected doors can post on the same day, one article each', async () => {
    const h = harness();
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.posted).toBe(2);
    expect(h.sent.map((item) => item.door)).toEqual(['telegram', 'discord']);
    expect(result.detail).toContain('Not connected yet: Bluesky, Mastodon, Tumblr, Blogger, Medium, Pixelfed, WordPress.com.');
  });

  it('all nine open doors can post, in order, each with its own reserved row as the key', async () => {
    const h = harness({ secrets: NINE_DOOR_SECRETS });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.status).toBe('done');
    expect(result.posted).toBe(9);
    expect(h.sent.map((item) => item.door)).toEqual(['telegram', 'discord', 'bluesky', 'mastodon', 'tumblr', 'blogger', 'medium', 'pixelfed', 'wordpress_com']);
    expect(h.keys.map((item) => item.key)).toEqual(h.sent.map((item) => `row-${item.door}`));
    expect(result.detail).not.toContain('Not connected yet');
  });

  it('only Pixelfed takes a picture: the other doors are sent with none', async () => {
    const h = harness({ secrets: NINE_DOOR_SECRETS });
    await runDoors(DAY_INPUT, h.ports);
    expect(h.images.filter((item) => item.hasImage).map((item) => item.door)).toEqual(['pixelfed']);
  });

  it('Medium and WordPress.com get the same short line and link as the other link doors', async () => {
    const h = harness({ secrets: NINE_DOOR_SECRETS });
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

  it('after a save that failed, the same door does not send again the same day', async () => {
    const h = harness({
      secrets: { telegram_bot_token: TOKEN, telegram_chat_id: '-100123' },
      articles: [ARTICLE, SECOND_ARTICLE],
      finishFail: () => true,
    });
    await runDoors(DAY_INPUT, h.ports);
    // The row stays queued, so the day cap counts it. A second run the same day must not send.
    h.ports.countToday = async () => 1;
    const again = await runDoors(DAY_INPUT, h.ports);
    expect(h.sent.filter((item) => item.door === 'telegram')).toHaveLength(1);
    expect(again.outcomes.find((item) => item.door === 'telegram')?.detail).toBe('Telegram: already posted today.');
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
