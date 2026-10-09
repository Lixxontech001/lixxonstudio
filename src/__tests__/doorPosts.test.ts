import { describe, expect, it } from 'vitest';
import {
  DOOR_DAILY_LIMIT,
  DOOR_TEXT_MAX,
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

function article(id: string, overrides: Partial<DoorArticle> = {}): DoorArticle {
  return {
    id,
    title: `Article ${id}`,
    slug: `article-${id}`,
    publishedAt: new Date(NOW - DAY).toISOString(),
    ...overrides,
  };
}

describe('the open doors', () => {
  it('are Telegram and Discord in this slice, and only those', () => {
    expect([...OPEN_DOORS]).toEqual(['telegram', 'discord']);
    expect(isOpenDoor('telegram')).toBe(true);
    expect(isOpenDoor('bluesky')).toBe(false);
    expect(isOpenDoor('toString')).toBe(false);
  });

  it('never include a gated channel', () => {
    for (const channel of PACK_CHANNELS) {
      expect(OPEN_DOORS as readonly string[]).not.toContain(channel);
    }
    for (const door of OPEN_DOORS) expect(DOOR_IDS as readonly string[]).toContain(door);
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
    expect(doorText('Easy routine for dry skin', `${SITE}/blog/easy-routine`)).toBe(
      `New on the blog: Easy routine for dry skin\n${SITE}/blog/easy-routine`,
    );
  });

  it('a long title is clipped and the whole text stays under the limit', () => {
    const text = doorText('x'.repeat(5000), `${SITE}/blog/a`);
    expect(text.length).toBeLessThanOrEqual(DOOR_TEXT_MAX);
    expect(text).toBe(`New on the blog: ${'x'.repeat(199)}…\n${SITE}/blog/a`);
  });

  it('whitespace in the title is flattened', () => {
    expect(doorText('  Two\n\nlines  ', `${SITE}/blog/a`).split('\n')[0]).toBe('New on the blog: Two lines');
  });
});

describe('which article goes to a door', () => {
  it('picks the newest fresh article the door has not had', () => {
    const pick = pickDoorArticle({
      articles: [article('old', { publishedAt: new Date(NOW - 3 * DAY).toISOString() }), article('new', { publishedAt: new Date(NOW - DAY / 2).toISOString() })],
      postedIds: new Set(),
      nowMs: NOW,
      siteOrigin: SITE,
    });
    expect(pick.ok).toBe(true);
    if (pick.ok) {
      expect(pick.article.id).toBe('new');
      expect(pick.articleUrl).toBe(`${SITE}/blog/article-new`);
      expect(pick.text).toContain('New on the blog: Article new');
    }
  });

  it('skips an article the door already has, in any status, so a failed post is not retried', () => {
    const pick = pickDoorArticle({ articles: [article('a')], postedIds: new Set(['a']), nowMs: NOW, siteOrigin: SITE });
    expect(pick).toEqual({ ok: false, reason: 'nothing_new' });
  });

  it('never sends an article older than the window', () => {
    const old = article('old', { publishedAt: new Date(NOW - (DOOR_WINDOW_DAYS + 1) * DAY).toISOString() });
    expect(pickDoorArticle({ articles: [old], postedIds: new Set(), nowMs: NOW, siteOrigin: SITE })).toEqual({ ok: false, reason: 'nothing_new' });
  });

  it('never sends an article dated in the future, or with no date', () => {
    const future = article('f', { publishedAt: new Date(NOW + DAY).toISOString() });
    const undated = article('u', { publishedAt: null });
    expect(pickDoorArticle({ articles: [future, undated], postedIds: new Set(), nowMs: NOW, siteOrigin: SITE })).toEqual({ ok: false, reason: 'nothing_new' });
  });

  it('skips an article without a clean slug', () => {
    for (const slug of [null, '', 'Bad Slug', '../escape', 'a--b', 'x/y']) {
      expect(pickDoorArticle({ articles: [article('s', { slug })], postedIds: new Set(), nowMs: NOW, siteOrigin: SITE }), String(slug)).toEqual({ ok: false, reason: 'nothing_new' });
    }
  });

  it('a title with a dash, a country name or non-US money is refused with a plain reason', () => {
    for (const title of ['Routine — easy', 'Made in Nigeria', 'Costs £5', 'Lagos skin guide', 'From NGN 5000']) {
      const pick = pickDoorArticle({ articles: [article('t', { title })], postedIds: new Set(), nowMs: NOW, siteOrigin: SITE });
      expect(pick, title).toEqual({ ok: false, reason: 'copy_not_clean' });
    }
  });
});
