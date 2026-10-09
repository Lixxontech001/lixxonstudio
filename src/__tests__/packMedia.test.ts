import { describe, expect, it } from 'vitest';
import {
  CAPTION_CHUNK_CHARS,
  CAPTION_LINE_CHARS,
  CAPTION_MAX_CHUNKS,
  COPY_NOT_USABLE_REASON,
  NO_ARTICLE_IMAGE_REASON,
  VIDEO_NOT_MADE_REASON,
  articleImageFor,
  captionChunks,
  planPackMedia,
  videoBlockReason,
} from '../../supabase/functions/_shared/packMedia';

const CAPTION = 'Dry skin feels tight by midday. A calm routine keeps the steps in one easy order.';

describe('pack pictures: only the article\'s own cover image', () => {
  it('an https cover image is used as stored', () => {
    expect(articleImageFor('https://images.example.com/cover.jpg')).toEqual({ ok: true, path: 'https://images.example.com/cover.jpg' });
  });

  it('a site path is used as stored', () => {
    expect(articleImageFor('/assets/images/guide.webp')).toEqual({ ok: true, path: '/assets/images/guide.webp' });
  });

  it('no cover image means no picture, and nothing is invented', () => {
    expect(articleImageFor(null)).toEqual({ ok: false, reason: 'no_article_image' });
    expect(articleImageFor('   ')).toEqual({ ok: false, reason: 'no_article_image' });
  });

  it('plain http, data addresses, scripts, protocol-relative and spaced values are refused', () => {
    for (const bad of ['http://example.com/a.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)', '//cdn.example.com/a.jpg', 'https://example.com/a b.jpg', 'images/a.jpg']) {
      expect(articleImageFor(bad), bad).toEqual({ ok: false, reason: 'image_not_usable' });
    }
  });

  it('a very long address is refused', () => {
    expect(articleImageFor(`https://example.com/${'a'.repeat(600)}`)).toEqual({ ok: false, reason: 'image_not_usable' });
  });
});

describe('pack captions: short, burned in, up to three chunks', () => {
  it('a normal caption becomes short chunks, each within the line and chunk limits', () => {
    const chunks = captionChunks(CAPTION);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.length).toBeLessThanOrEqual(CAPTION_MAX_CHUNKS);
    for (const chunk of chunks) {
      expect(chunk.replace(/\n/g, ' ').length).toBeLessThanOrEqual(CAPTION_CHUNK_CHARS);
      for (const line of chunk.split('\n')) expect(line.length).toBeLessThanOrEqual(CAPTION_LINE_CHARS);
    }
  });

  it('a long caption is cut to three chunks at most', () => {
    const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} about the routine.`).join(' ');
    expect(captionChunks(long).length).toBe(CAPTION_MAX_CHUNKS);
  });

  it('a very long single word is cut so no line is too long', () => {
    const chunks = captionChunks('a'.repeat(130));
    for (const chunk of chunks) for (const line of chunk.split('\n')) expect(line.length).toBeLessThanOrEqual(CAPTION_LINE_CHARS);
  });

  it('empty text gives no chunks', () => {
    expect(captionChunks('   ')).toEqual([]);
  });

  it('the plan blocks copy with a dash, a country name or non-US money', () => {
    for (const bad of ['Calm steps \u2014 for you.', 'Made in Lagos today.', 'It costs \u00a39 today.']) {
      const plan = planPackMedia({ coverImage: '/assets/images/guide.webp', copyText: bad, mp4Path: '/tmp/a.mp4' });
      expect(plan.status, bad).toBe('blocked');
      expect(plan.reason, bad).toBe(COPY_NOT_USABLE_REASON);
    }
  });
});

describe('pack video: a real MP4 is needed, or the pack is blocked', () => {
  it('no MP4 path: the reason is "video not made yet"', () => {
    expect(videoBlockReason(null)).toBe(VIDEO_NOT_MADE_REASON);
    expect(videoBlockReason('')).toBe('video not made yet');
    expect(VIDEO_NOT_MADE_REASON).toBe('video not made yet');
  });

  it('an MP4 path clears the block', () => {
    expect(videoBlockReason('/tmp/pack-1.mp4')).toBeNull();
  });
});

describe('pack media plan: blocked on the first thing missing', () => {
  it('no cover image: blocked for the picture', () => {
    expect(planPackMedia({ coverImage: null, copyText: CAPTION, mp4Path: null })).toEqual({
      status: 'blocked', reason: NO_ARTICLE_IMAGE_REASON, imagePath: null, chunks: [],
    });
  });

  it('a cover image but no MP4: blocked with "video not made yet"', () => {
    const plan = planPackMedia({ coverImage: 'https://images.example.com/cover.jpg', copyText: CAPTION, mp4Path: null });
    expect(plan.status).toBe('blocked');
    expect(plan.reason).toBe('video not made yet');
    expect(plan.imagePath).toBe('https://images.example.com/cover.jpg');
    expect(plan.chunks.length).toBeGreaterThan(0);
  });

  it('a cover image, usable copy and an MP4: ready', () => {
    const plan = planPackMedia({ coverImage: '/assets/images/guide.webp', copyText: CAPTION, mp4Path: '/tmp/pack-1.mp4' });
    expect(plan.status).toBe('ready');
    expect(plan.reason).toBeNull();
  });

  it('copy that cannot be used blocks the pack with a plain reason', () => {
    const plan = planPackMedia({ coverImage: '/assets/images/guide.webp', copyText: 'Made in Nigeria.', mp4Path: '/tmp/a.mp4' });
    expect(plan.status).toBe('blocked');
    expect(plan.reason).toBe(COPY_NOT_USABLE_REASON);
  });
});
