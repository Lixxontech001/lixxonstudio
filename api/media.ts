import { publicMediaOrigin, publicMediaPath } from '../src/lib/publicMedia';

export const config = { runtime: 'edge' };
const CACHE = 'public, s-maxage=31536000, stale-while-revalidate=86400';

export default async function handler(req: Request): Promise<Response> {
  const fail = (status: number) => new Response(null, {
    status, headers: { 'Cache-Control': 'no-store', ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) },
  });
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405);
  const params = new URL(req.url).searchParams;
  const path = publicMediaPath(params.get('p') || '');
  if (!path || params.getAll('p').length !== 1) return fail(404);
  const origin = publicMediaOrigin(process.env.SUPABASE_URL || process.env.VITE_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_PROJECT_URL ||
    process.env.VITE_SUPABASE_PUBLIC_URL || process.env.VITE_SUPABASE_PROJECT_REF_URL);
  if (!origin) return fail(502);
  try {
    // No client headers/cookies, credentials, range or conditional requests are forwarded.
    const upstream = await fetch(`${origin}/storage/v1/object/public/${path}`, {
      method: req.method, redirect: 'error', credentials: 'omit',
    });
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return fail(upstream.status === 404 ? 404 : 502);
    }
    const headers = new Headers({
      'Cache-Control': CACHE,
      'X-Content-Type-Options': 'nosniff',
      // Public uploads must not execute active documents on the site's origin.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    for (const name of ['content-type', 'content-length', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(req.method === 'HEAD' ? null : upstream.body, { status: 200, headers });
  } catch { return fail(502); }
}
