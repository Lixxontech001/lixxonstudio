import { describe, expect, it } from 'vitest';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';
import {
  DOOR_DAILY_LIMIT,
  DOOR_MEDIA,
  DOOR_TEXT_LIMIT,
  DOOR_WINDOW_DAYS,
  OPEN_DOORS,
  doorArticleUrl,
  doorText,
  isOpenDoor,
  pickDoorArticle,
  type DoorArticle,
} from '../../supabase/functions/_shared/doorPosts';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';
import { PACK_CHANNELS } from '../../supabase/functions/_shared/packRules';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const SITE = 'https://lixxonstudio.example';
const LIMIT = 1000;

function article(id: string, overrides: Partial<DoorArticle> = {}): DoorArticle {
  return {
    id,
    title: `Article ${id}`,
    slug: `article-${id}`,
    publishedAt: new Date(NOW - DAY).toISOString(),
    ...overrides,
  };
}

function pick(articles: DoorArticle[], overrides: Partial<{ postedIds: Set<string>; limit: number }> = {}) {
  return pickDoorArticle({
    articles,
    postedIds: overrides.postedIds ?? new Set(),
    nowMs: NOW,
    siteOrigin: SITE,
    limit: overrides.limit ?? LIMIT,
  });
}

describe('the open doors', () => {
  it('are all sixteen auto doors (the twelve from Phases 5 and 6, and the four RSS doors), and only those', () => {
    expect([...OPEN_DOORS]).toEqual([
      'telegram', 'discord', 'bluesky', 'mastodon', 'tumblr', 'blogger', 'medium', 'pixelfed', 'wordpress_com', 'youtube', 'vimeo', 'podcast',
      'flipboard', 'google_news', 'microsoft_start', 'smartnews',
    ]);
    expect([...OPEN_DOORS].sort()).toEqual([...DOOR_IDS].sort());
    for (const door of OPEN_DOORS) expect(isOpenDoor(door)).toBe(true);
    expect(isOpenDoor('instagram')).toBe(false);
    expect(isOpenDoor('whatsapp')).toBe(false);
    expect(isOpenDoor('toString')).toBe(false);
  });

  it('each door that needs a file says which kind: Pixelfed a picture, YouTube and Vimeo a video, Podcast audio, and the rest none', () => {
    expect(DOOR_MEDIA).toEqual({ pixelfed: 'image', youtube: 'video', vimeo: 'video', podcast: 'audio' });
    for (const door of OPEN_DOORS) {
      if (!(door in DOOR_MEDIA)) expect(DOOR_MEDIA[door], door).toBeUndefined();
    }
  });

  it('never include a gated channel', () => {
    for (const channel of PACK_CHANNELS) {
      expect(OPEN_DOORS as readonly string[]).not.toContain(channel);
    }
    for (const door of OPEN_DOORS) expect(DOOR_IDS as readonly string[]).toContain(door);
  });

  it('have the limits the platforms publish: Bluesky 300, Mastodon 500', () => {
    expect(DOOR_TEXT_LIMIT.bluesky).toBe(300);
    expect(DOOR_TEXT_LIMIT.mastodon).toBe(500);
  });

  it('one post per open door per day, and a seven-day window', () => {
    expect(DOOR_DAILY_LIMIT).toBe(1);
    expect(DOOR_WINDOW_DAYS).toBe(7);
  });
});

describe('the article address and the text', () => {
  it('the address is the public blog path, with the site address when there is one', () => {
    expect(doorArticleUrl('easy-routine', SITE)).toBe(`${SITE}/blog/easy-routine`);
    expect(doorArticleUrl('easy-routine', `${SITE}/`)).toBe(`${SITE}/blog/easy-routine`);
    expect(doorArticleUrl('easy-routine', null)).toBe('/blog/easy-routine');
  });

  it('the text is one plain line and the link', () => {
    expect(doorText('Easy routine for dry skin', `${SITE}/blog/easy-routine`, LIMIT)).toBe(
      `New on the blog: Easy routine for dry skin\n${SITE}/blog/easy-routine`,
    );
  });

  it('a long title is clipped to 200 characters, and the text ends with the link', () => {
    expect(doorText('x'.repeat(5000), `${SITE}/blog/a`, LIMIT)).toBe(`New on the blog: ${'x'.repeat(199)}…\n${SITE}/blog/a`);
  });

  it('a short limit clips the title further, so the whole text fits the door', () => {
    const url = `${SITE}/blog/a-long-enough-slug`;
    const text = doorText('y'.repeat(400), url, DOOR_TEXT_LIMIT.bluesky);
    expect(text).not.toBeNull();
    expect(Array.from(text as string).length).toBeLessThanOrEqual(DOOR_TEXT_LIMIT.bluesky);
    expect((text as string).endsWith(`\n${url}`)).toBe(true);
  });

  it('a link that does not fit at all gives null, not a cut link', () => {
    expect(doorText('Title', `${SITE}/blog/${'z'.repeat(400)}`, DOOR_TEXT_LIMIT.bluesky)).toBeNull();
  });

  it('whitespace in the title is flattened', () => {
    expect(doorText('  Two\n\nlines  ', `${SITE}/blog/a`, LIMIT).split('\n')[0]).toBe('New on the blog: Two lines');
  });
});

describe('which article goes to a door', () => {
  it('picks the newest fresh article the door has not had', () => {
    const result = pick([
      article('old', { publishedAt: new Date(NOW - 3 * DAY).toISOString() }),
      article('new', { publishedAt: new Date(NOW - DAY / 2).toISOString() }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.article.id).toBe('new');
      expect(result.articleUrl).toBe(`${SITE}/blog/article-new`);
      expect(result.text).toContain('New on the blog: Article new');
    }
  });

  it('skips an article the door already has, in any status, so a failed post is not retried', () => {
    expect(pick([article('a')], { postedIds: new Set(['a']) })).toEqual({ ok: false, reason: 'nothing_new' });
  });

  it('never sends an article older than the window', () => {
    const old = article('old', { publishedAt: new Date(NOW - (DOOR_WINDOW_DAYS + 1) * DAY).toISOString() });
    expect(pick([old])).toEqual({ ok: false, reason: 'nothing_new' });
  });

  it('never sends an article dated in the future, or with no date', () => {
    const future = article('f', { publishedAt: new Date(NOW + DAY).toISOString() });
    const undated = article('u', { publishedAt: null });
    expect(pick([future, undated])).toEqual({ ok: false, reason: 'nothing_new' });
  });

  it('skips an article without a clean slug', () => {
    for (const slug of [null, '', 'Bad Slug', '../escape', 'a--b', 'x/y']) {
      expect(pick([article('s', { slug })]), String(slug)).toEqual({ ok: false, reason: 'nothing_new' });
    }
  });

  it('a title with a dash, a country name or non-US money is refused with a plain reason', () => {
    for (const title of ['Routine — easy', 'Made in Nigeria', 'Costs £5', 'Lagos skin guide', 'From NGN 5000']) {
      expect(pick([article('t', { title })]), title).toEqual({ ok: false, reason: 'copy_not_clean' });
    }
  });

  it('a door whose limit cannot hold the link says so, and nothing is cut', () => {
    const result = pickDoorArticle({
      articles: [article('long', { slug: 'a'.repeat(60) })],
      postedIds: new Set(),
      nowMs: NOW,
      siteOrigin: SITE,
      limit: 60,
    });
    expect(result).toEqual({ ok: false, reason: 'too_long' });
  });
});
