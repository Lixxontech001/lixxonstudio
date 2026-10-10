import { describe, expect, it } from 'vitest';
import { NO_KEY_COPY_DETAIL } from '../../supabase/functions/_shared/packCopy';
import {
  PACKS_ALREADY_MADE_DETAIL,
  articleAddress,
  runDayPacks,
  type DayPacksInput,
  type DayPacksPorts,
  type PackRow,
  type PackSource,
} from '../../supabase/functions/_shared/dayPacks';
import { TAKEOVER_OFF_DETAIL, KILL_BLOCK_DETAIL } from '../../supabase/functions/_shared/runDay';
import { VIDEO_NOT_MADE_REASON } from '../../supabase/functions/_shared/packMedia';
import type { ArticleImageCheck } from '../../supabase/functions/_shared/articleImage';

const SITE = 'https://lixxonstudio.example';
const PICTURE = 'https://images.example.com/cover.jpg';

const SHOP = [
  { id: 'p1', name: 'Calm Skin Routine Guide', isDigital: true, priceUsd: 12 },
  { id: 'p2', name: 'Dry Skin Checklist', isDigital: true, priceUsd: 5 },
  { id: 'p3', name: 'Night Care Bundle', isDigital: false, priceUsd: 24 },
];

const ARTICLE: PackSource = {
  id: 'post-1',
  title: 'Easy Skincare Routine for Dry Skin',
  slug: 'easy-skincare-routine-dry-skin',
  coverImage: PICTURE,
  liveProductIds: ['p1', 'p2'],
};

const GOOD = {
  instagram: 'A calm routine for dry skin, with the Calm Skin Routine Guide that keeps the steps in order.',
  tiktok: 'Dry skin feels tight by midday. The Calm Skin Routine Guide puts the steps in one easy order.',
  facebook: 'If your skin feels dry after washing, start with one calm order of steps. The Dry Skin Checklist shows it.',
  pinterest: { title: 'Calm routine for dry skin', description: 'A simple order of steps for dry skin, with the Calm Skin Routine Guide.' },
};

interface Counters {
  think: number;
  checkImage: number;
  savePack: number;
  log: number;
}

function harness(options: {
  copy?: unknown;
  thinkReason?: 'no_key' | 'other';
  image?: ArticleImageCheck;
  failSaveAt?: number;
} = {}) {
  const counters: Counters = { think: 0, checkImage: 0, savePack: 0, log: 0 };
  const rows: PackRow[] = [];
  const logs: string[] = [];
  const ports: DayPacksPorts = {
    think: async () => {
      counters.think += 1;
      if (options.thinkReason === 'no_key') return { ok: false, reason: 'no_key' } as never;
      if (options.thinkReason === 'other') return { ok: false, reason: 'failed' } as never;
      return { ok: true, text: JSON.stringify(options.copy ?? GOOD) };
    },
    checkImage: async () => {
      counters.checkImage += 1;
      return options.image ?? { ok: true, url: PICTURE, contentType: 'image/jpeg', bytes: 2048 };
    },
    savePack: async (row) => {
      counters.savePack += 1;
      if (options.failSaveAt !== undefined && counters.savePack === options.failSaveAt) return { ok: false, reason: 'takeover_off' };
      rows.push(row);
      return { ok: true };
    },
    log: async (entry) => {
      counters.log += 1;
      logs.push(entry.detail);
    },
  };
  return { ports, counters, rows, logs };
}

function input(overrides: Partial<DayPacksInput> = {}): DayPacksInput {
  return {
    localDay: '2026-10-10',
    takeover: true,
    killScope: 'none',
    articles: [ARTICLE],
    shop: SHOP,
    siteOrigin: SITE,
    alreadyMade: false,
    ...overrides,
  };
}

describe('the day run makes packs only when it is allowed to', () => {
  it('Takeover off: nothing is read, fetched, written or logged', async () => {
    const { ports, counters } = harness();
    const result = await runDayPacks(input({ takeover: false }), ports);
    expect(result).toEqual({ status: 'held', detail: TAKEOVER_OFF_DETAIL, saved: 0, postId: null });
    expect(counters).toEqual({ think: 0, checkImage: 0, savePack: 0, log: 0 });
  });

  it('Kill on the Executioner or on all: nothing is written and no thinking happens', async () => {
    for (const killScope of ['executioner', 'all'] as const) {
      const { ports, counters, rows } = harness();
      const result = await runDayPacks(input({ killScope }), ports);
      expect(result.status).toBe('held');
      expect(result.detail).toBe(KILL_BLOCK_DETAIL);
      expect(rows).toEqual([]);
      expect(counters.think).toBe(0);
      expect(counters.savePack).toBe(0);
    }
  });

  it('a day that already has packs does nothing, so a repeated run is safe', async () => {
    const { ports, counters } = harness();
    const result = await runDayPacks(input({ alreadyMade: true }), ports);
    expect(result).toEqual({ status: 'nothing_to_do', detail: PACKS_ALREADY_MADE_DETAIL, saved: 0, postId: null });
    expect(counters.think).toBe(0);
  });

  it('no article with a live product and a web address: nothing to pack, honestly said', async () => {
    const { ports, counters } = harness();
    const result = await runDayPacks(input({ articles: [{ ...ARTICLE, liveProductIds: [] }] }), ports);
    expect(result.status).toBe('nothing_to_do');
    expect(counters.savePack).toBe(0);
    const noSlug = await runDayPacks(input({ articles: [{ ...ARTICLE, slug: null }] }), harness().ports);
    expect(noSlug.status).toBe('nothing_to_do');
  });

  it('no Google key: the run says so, saves nothing, and does not pretend', async () => {
    const { ports, rows } = harness({ thinkReason: 'no_key' });
    const result = await runDayPacks(input(), ports);
    expect(result).toEqual({ status: 'held', detail: NO_KEY_COPY_DETAIL, saved: 0, postId: 'post-1' });
    expect(rows).toEqual([]);
  });

  it('a copy answer that cannot be read is a plain failure, with nothing saved', async () => {
    const { ports, rows } = harness({ thinkReason: 'other' });
    const result = await runDayPacks(input(), ports);
    expect(result.status).toBe('failed');
    expect(rows).toEqual([]);
  });
});

describe('the day run saves one pack row per channel', () => {
  it('a picture that fetches: four rows, each with the picture and no video, all honest "video not made yet"', async () => {
    const { ports, rows } = harness();
    const result = await runDayPacks(input(), ports);
    expect(result).toMatchObject({ status: 'done', saved: 4, postId: 'post-1' });
    expect(rows.map((row) => row.channel)).toEqual(['instagram', 'tiktok', 'facebook', 'pinterest']);
    for (const row of rows) {
      expect(row.status).toBe('blocked');
      expect(row.blockedReason).toBe(VIDEO_NOT_MADE_REASON);
      expect(row.videoPath).toBeNull();
      expect(row.imagePath).toBe(PICTURE);
      expect(row.auditorVerdict).toBe('allow');
      expect(row.postId).toBe('post-1');
      expect(row.localDay).toBe('2026-10-10');
    }
  });

  it('the picture cannot be fetched: the pack keeps no picture, says why in the note, and is still honest', async () => {
    const { ports, rows } = harness({ image: { ok: false, reason: 'not_fetchable' } });
    await runDayPacks(input(), ports);
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.imagePath).toBeNull();
      expect(row.status).toBe('blocked');
      expect(row.blockedReason).toBe(VIDEO_NOT_MADE_REASON);
      expect(row.auditorNote).toBe('The article picture could not be fetched.');
    }
  });

  it('no picture on the article: the reason is "No article picture yet." and not a video claim', async () => {
    const { ports, rows } = harness({ image: { ok: false, reason: 'no_image' } });
    await runDayPacks(input({ articles: [{ ...ARTICLE, coverImage: null }] }), ports);
    expect(rows[0].blockedReason).toBe('No article image yet.');
  });

  it('the four captions for one article are pairwise different', async () => {
    const { ports, rows } = harness();
    await runDayPacks(input(), ports);
    const texts = rows.map((row) => (row.channel === 'pinterest' ? row.pinTitle : row.caption));
    expect(texts.every((text) => typeof text === 'string' && text.length > 0)).toBe(true);
    expect(new Set(texts.map((text) => (text as string).toLowerCase())).size).toBe(4);
  });

  it('an Auditor block on one channel: that channel is blocked, its copy is not stored, the others keep theirs', async () => {
    const copy = { ...GOOD, tiktok: GOOD.instagram };
    const { ports, rows } = harness({ copy });
    const result = await runDayPacks(input(), ports);
    expect(result.status).toBe('done');
    const tiktok = rows.find((row) => row.channel === 'tiktok');
    expect(tiktok?.status).toBe('blocked');
    expect(tiktok?.auditorVerdict).toBe('block');
    expect(tiktok?.caption).toBeNull();
    expect(tiktok?.blockedReason).toMatch(/^The Auditor blocked this copy\./);
    expect(rows.find((row) => row.channel === 'instagram')?.caption).toBe(GOOD.instagram);
  });

  it('products on each pack are only this article\'s live products, at most three', async () => {
    const { ports, rows } = harness();
    await runDayPacks(input(), ports);
    for (const row of rows) {
      expect(row.productIds.length).toBeLessThanOrEqual(3);
      expect(row.productIds.every((id) => ARTICLE.liveProductIds.includes(id))).toBe(true);
      expect(row.productIds).not.toContain('p3');
    }
  });

  it('each row has a UTC time with a plain label, and the link is the article\'s public address', async () => {
    const { ports, rows } = harness();
    await runDayPacks(input(), ports);
    for (const row of rows) {
      expect(row.suggestedAtUtc.endsWith('Z')).toBe(true);
      expect(row.suggestedLabel).toMatch(/US|UK and Ireland|Australia|New Zealand|Singapore/);
      expect(row.articleUrl).toBe(`${SITE}/blog/easy-skincare-routine-dry-skin`);
    }
  });

  it('a save refused part way stops the run and says how many were saved', async () => {
    const { ports, rows } = harness({ failSaveAt: 3 });
    const result = await runDayPacks(input(), ports);
    expect(result.status).toBe('held');
    expect(result.saved).toBe(2);
    expect(result.detail).toMatch(/^Saved 2 of 4 packs\./);
    expect(rows.length).toBe(2);
  });

  it('the run writes one plain log line when it finishes', async () => {
    const { ports, logs, counters } = harness();
    const result = await runDayPacks(input(), ports);
    expect(counters.log).toBe(1);
    expect(logs[0]).toBe(result.detail);
    expect(result.detail).toMatch(/^Made today's packs for "Easy Skincare Routine for Dry Skin": 4 saved, 0 ready to post by hand\./);
  });
});

describe('the copy of every pack stays clean', () => {
  it('no dash, no country name, no non-US money in what is stored', async () => {
    const { ports, rows } = harness();
    await runDayPacks(input(), ports);
    const text = rows.flatMap((row) => [row.caption, row.pinTitle, row.pinDescription, row.auditorNote, row.blockedReason, row.suggestedLabel]).filter(Boolean).join(' ');
    expect(text).not.toMatch(/[\u2014\u2013]/);
    expect(text).not.toMatch(/nigeria|lagos|naira|\bWAT\b|\u00a3|\u20ac/i);
  });
});

describe('the article address', () => {
  it('uses the blog path with the site address, or the path alone when no site address is set', () => {
    expect(articleAddress('easy-skincare-routine-dry-skin', SITE)).toBe(`${SITE}/blog/easy-skincare-routine-dry-skin`);
    expect(articleAddress('easy-skincare-routine-dry-skin', null)).toBe('/blog/easy-skincare-routine-dry-skin');
  });
});
