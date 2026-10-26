import { publicMediaOrigin, publicMediaPath } from '../src/lib/publicMedia';

export const config = { runtime: 'edge' };
const CACHE_REWRITE = 'public, s-maxage=31536000, stale-while-revalidate=86400';
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';

function inferContentType(path: string, upstreamType: string | null): string {
  if (upstreamType && upstreamType !== 'application/octet-stream' && upstreamType !== 'text/plain') {
    return upstreamType;
  }
  const clean = path.split('?')[0].toLowerCase();
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.gif')) return 'image/gif';
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.avif')) return 'image/avif';
  return upstreamType || 'image/jpeg';
}

export default async function handler(req: Request): Promise<Response> {
  const fail = (status: number) => new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...(status === 405 ? { Allow: 'GET, HEAD' } : {}),
    },
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405);

  const requestUrl = new URL(req.url);
  const params = requestUrl.searchParams;

  let targetPath: string | null = null;
  let customOrigin: string | null = null;
  let isDirectUrlParam = false;

  // 1. Support ?url= parameter (full Supabase storage URL or direct path)
  const urlParam = params.get('url');
  if (urlParam) {
    isDirectUrlParam = true;
    try {
      if (urlParam.startsWith('http://') || urlParam.startsWith('https://')) {
        const parsed = new URL(urlParam);
        // External CDNs or non-Supabase domains: never proxy, redirect directly
        if (!parsed.hostname.endsWith('.supabase.co')) {
          return Response.redirect(urlParam, 302);
        }
        const match = parsed.pathname.match(/\/storage\/v1\/(?:object\/public|render\/image\/public)\/(.+)/);
        if (match) {
          targetPath = publicMediaPath(match[1]);
          customOrigin = parsed.origin;
        }
      } else {
        const cleaned = urlParam.replace(/^\/?(?:media\/public\/|storage\/v1\/(?:object\/public|render\/image\/public)\/)/, '');
        targetPath = publicMediaPath(cleaned);
      }
    } catch {
      targetPath = null;
    }
  }

  // 2. Fall back to ?p= parameter (Vercel rewrite from /media/public/:path*)
  if (!targetPath) {
    const pParam = params.get('p');
    if (!pParam || params.getAll('p').length !== 1) return fail(404);
    targetPath = publicMediaPath(pParam);
    if (!targetPath) return fail(404);
  }

  const envOrigin =
    publicMediaOrigin(process.env.SUPABASE_URL) ||
    publicMediaOrigin(process.env.VITE_SUPABASE_URL) ||
    publicMediaOrigin(process.env.VITE_PUBLIC_SUPABASE_URL) ||
    publicMediaOrigin(process.env.VITE_SUPABASE_PROJECT_URL) ||
    publicMediaOrigin(process.env.VITE_SUPABASE_PUBLIC_URL) ||
    publicMediaOrigin(process.env.VITE_SUPABASE_PROJECT_REF_URL);

  const origin = customOrigin || envOrigin;
  if (!origin) return fail(502);

  try {
    const upstream = await fetch(`${origin}/storage/v1/object/public/${targetPath}`, {
      method: req.method,
      redirect: 'error',
      credentials: 'omit',
    });

    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return fail(upstream.status === 404 ? 404 : 502);
    }

    const contentType = inferContentType(targetPath, upstream.headers.get('content-type'));

    const headers = new Headers({
      'Cache-Control': CACHE_IMMUTABLE,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });

    if (contentType) headers.set('content-type', contentType);

    for (const name of ['content-length', 'etag', 'last-modified']) {
      const val = upstream.headers.get(name);
      if (val) headers.set(name, val);
    }

    return new Response(req.method === 'HEAD' ? null : upstream.body, {
      status: 200,
      headers,
    });
  } catch {
    return fail(502);
  }
}
