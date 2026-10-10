import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicMediaPath, rewritePublicMediaUrl } from '../lib/publicMedia';
import { displayImageUrl } from '../lib/images';
import { renderMarkdown } from '../lib/markdown';
import handler from '../../api/media';

const origin = 'https://example.supabase.co';
const object = `${origin}/storage/v1/object/public/pictures/a.jpg`;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('public media display (fake URLs only)', () => {
  it('rewrites public objects and render URLs to the original', () => {
    expect(rewritePublicMediaUrl(object, origin)).toBe('/media/public/pictures/a.jpg');
    expect(rewritePublicMediaUrl(`${origin}/storage/v1/render/image/public/pictures/a.jpg?width=400`, origin)).toBe('/media/public/pictures/a.jpg');
    expect(rewritePublicMediaUrl(`${origin}/storage/v1/object/public/pictures/a%20b.jpg`, origin)).toBe('/media/public/pictures/a%20b.jpg');
  });
  it.each([
    'https://evil.com/storage/v1/object/public/pictures/a.jpg',
    `${origin}.evil.com/storage/v1/object/public/pictures/a.jpg`,
    `${origin}/storage/v1/object/sign/pictures/a.jpg?token=fake`,
    `${origin}/storage/v1/object/authenticated/pictures/a.jpg`,
    `${object}?token=fake`,
    `${origin}/storage/v1/object/public/pictures/../a.jpg`,
    `${origin}/storage/v1/object/public/pictures/%2e%2e/a.jpg`,
    `${origin}/storage/v1/object/public/pictures//a.jpg`,
    `${origin}/storage/v1/object/public/pictures/%252e%252e/a.jpg`,
    `${origin}/storage/v1/object/public/pictures/%2f/a.jpg`,
    `${origin}/storage/v1/object/public/pictures/\\a.jpg`,
    'https://www.pexels.com/photo/example-123/',
  ])('leaves ineligible URL unchanged: %s', url => {
    expect(rewritePublicMediaUrl(url, origin)).toBe(url);
  });
  it('covers the display and markdown pipeline without changing Pexels', () => {
    expect(displayImageUrl(object)).toBe('/media/public/pictures/a.jpg');
    expect(renderMarkdown(`![Picture](${object})`)).toContain('src="/media/public/pictures/a.jpg"');
    expect(renderMarkdown(`![Picture](${object.replace('a.jpg', 'a&b.jpg')})`)).toContain('src="/media/public/pictures/a%26b.jpg"');
    expect(displayImageUrl('https://www.pexels.com/photo/example-123/')).toContain('https://images.pexels.com/photos/123/');
  });
  it.each(['', 'bucket', '/bucket/key', 'bucket//key', 'bucket/../key', 'bucket/%2e%2e/key', 'bucket/%252fkey', 'bucket/%00key', 'bucket/%zz'])('rejects unsafe paths: %s', path => {
    expect(publicMediaPath(path)).toBeNull();
  });
});

describe('media edge handler (mock fetch only)', () => {
  const request = (method = 'GET', path = 'pictures/a.jpg') => new Request(`https://site.example/api/media?p=${encodeURIComponent(path)}`, {
    method, headers: { Cookie: 'private=fake', Authorization: 'Bearer fake', Range: 'bytes=0-2' },
  });
  const setup = (status = 200) => {
    vi.stubEnv('SUPABASE_URL', origin);
    const fetcher = vi.fn().mockResolvedValue(new Response('fake bytes', {
      status, headers: { 'Content-Type': 'image/jpeg', 'Set-Cookie': 'secret=fake' },
    }));
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  };
  it.each(['GET', 'HEAD'])('serves %s with shared cache and no credentials', async method => {
    const fetcher = setup();
    const response = await handler(request(method));
    expect(fetcher).toHaveBeenCalledWith(object, { method, redirect: 'error', credentials: 'omit' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, s-maxage=31536000, stale-while-revalidate=86400');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(await response.text()).toBe(method === 'HEAD' ? '' : 'fake bytes');
  });
  it.each([404, 403, 500, 302, 206])('does not cache upstream %s', async status => {
    setup(status);
    const response = await handler(request());
    expect(response.status).toBe(status === 404 ? 404 : 502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('does not cache network failures', async () => {
    setup().mockRejectedValue(new Error('offline'));
    const response = await handler(request());
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('rejects traversal and non-read methods without fetching', async () => {
    const fetcher = setup();
    expect((await handler(request('POST'))).status).toBe(405);
    expect((await handler(request('GET', 'pictures/../private'))).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
