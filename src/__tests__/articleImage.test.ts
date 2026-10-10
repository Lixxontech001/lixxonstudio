import { describe, expect, it } from 'vitest';
import {
  IMAGE_MAX_BYTES,
  absoluteImageUrl,
  checkArticleImage,
  imageProblemNote,
  type ImageFetch,
} from '../../supabase/functions/_shared/articleImage';

const SITE = 'https://lixxonstudio.example';
const PICTURE = 'https://images.example.com/cover.jpg';

function fakeResponse(body: Uint8Array | string, init: { status?: number; type?: string; length?: string } = {}): Response {
  const headers = new Headers({ 'content-type': init.type ?? 'image/jpeg' });
  if (init.length !== undefined) headers.set('content-length', init.length);
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return new Response(bytes, { status: init.status ?? 200, headers });
}

describe('absoluteImageUrl: only the article\'s own picture, joined to the site when it is a site path', () => {
  it('an https address is used as stored', () => {
    expect(absoluteImageUrl(PICTURE, SITE)).toBe(PICTURE);
  });

  it('a site path is joined to the site address', () => {
    expect(absoluteImageUrl('/assets/images/guide.webp', SITE)).toBe(`${SITE}/assets/images/guide.webp`);
  });

  it('a site path with no site address cannot be reached, so it is null', () => {
    expect(absoluteImageUrl('/assets/images/guide.webp', null)).toBeNull();
  });

  it('plain http, data addresses and scripts are refused', () => {
    for (const bad of ['http://example.com/a.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)']) {
      expect(absoluteImageUrl(bad, SITE), bad).toBeNull();
    }
  });
});

describe('checkArticleImage: fetch once, then check the type and the size', () => {
  it('a real picture is accepted, with its type and size', async () => {
    const calls: string[] = [];
    const fetchImpl: ImageFetch = async (url) => {
      calls.push(url);
      return fakeResponse(new Uint8Array(1024), { type: 'image/webp' });
    };
    const result = await checkArticleImage(PICTURE, SITE, fetchImpl);
    expect(result).toEqual({ ok: true, url: PICTURE, contentType: 'image/webp', bytes: 1024 });
    expect(calls).toEqual([PICTURE]);
  });

  it('no cover image is reported as no image, and nothing is fetched', async () => {
    let called = false;
    const result = await checkArticleImage(null, SITE, async () => {
      called = true;
      return fakeResponse('x');
    });
    expect(result).toEqual({ ok: false, reason: 'no_image' });
    expect(called).toBe(false);
  });

  it('a page that is not a picture is refused', async () => {
    const result = await checkArticleImage(PICTURE, SITE, async () => fakeResponse('<html></html>', { type: 'text/html' }));
    expect(result).toEqual({ ok: false, reason: 'not_an_image' });
  });

  it('a missing picture (404) is refused as not fetchable', async () => {
    const result = await checkArticleImage(PICTURE, SITE, async () => fakeResponse('nope', { status: 404 }));
    expect(result).toEqual({ ok: false, reason: 'not_fetchable' });
  });

  it('a picture too big by its declared size is refused before the body is read', async () => {
    const result = await checkArticleImage(PICTURE, SITE, async () => fakeResponse('x', { length: String(IMAGE_MAX_BYTES + 1) }));
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('a picture too big by its real size is refused', async () => {
    const result = await checkArticleImage(PICTURE, SITE, async () => fakeResponse(new Uint8Array(IMAGE_MAX_BYTES + 1)));
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('an empty body is refused as not fetchable', async () => {
    const result = await checkArticleImage(PICTURE, SITE, async () => fakeResponse(new Uint8Array(0)));
    expect(result).toEqual({ ok: false, reason: 'not_fetchable' });
  });

  it('a request that is aborted after the time limit is a timeout, with the plain note', async () => {
    const result = await checkArticleImage(PICTURE, SITE, async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(imageProblemNote('timeout')).toBe('The article picture took too long to fetch.');
  });

  it('a network failure is not fetchable, and the note never shows a raw address', async () => {
    const result = await checkArticleImage(PICTURE, SITE, async () => {
      throw new TypeError('network down');
    });
    expect(result).toEqual({ ok: false, reason: 'not_fetchable' });
    expect(imageProblemNote('not_fetchable')).not.toMatch(/https?:\/\//);
  });

  it('a site path picture is fetched from the site address', async () => {
    const seen: string[] = [];
    await checkArticleImage('/assets/images/guide.webp', SITE, async (url) => {
      seen.push(url);
      return fakeResponse(new Uint8Array(10));
    });
    expect(seen).toEqual([`${SITE}/assets/images/guide.webp`]);
  });
});
