// Vercel serverless proxy (Hobby tier, free) → Supabase `feeds` edge function.
// Lets /sitemap.xml, /rss.xml and bot prerendering work without hard-coding the project URL
// in vercel.json; the Supabase URL comes from the same env var the frontend uses.
export const config = { runtime: 'edge' };

const ALLOWED = new Set(['sitemap', 'rss', 'prerender', 'podcast']);

/** Read a process env var, trying each name in order. */
function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

function fallbackSitemap(site: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${site}/</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>
  <url><loc>${site}/shop</loc><lastmod>${today}</lastmod><priority>0.9</priority></url>
  <url><loc>${site}/collections</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>
  <url><loc>${site}/series</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>
  <url><loc>${site}/glossary</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>
  <url><loc>${site}/weekly-digest</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>
  <url><loc>${site}/about</loc><lastmod>${today}</lastmod><priority>0.7</priority></url>
  <url><loc>${site}/contact</loc><lastmod>${today}</lastmod><priority>0.7</priority></url>
  <url><loc>${site}/gift-cards</loc><lastmod>${today}</lastmod><priority>0.7</priority></url>
  <url><loc>${site}/privacy</loc><lastmod>${today}</lastmod><priority>0.3</priority></url>
  <url><loc>${site}/terms</loc><lastmod>${today}</lastmod><priority>0.3</priority></url>
</urlset>`;
}

export default async function handler(req: Request): Promise<Response> {
  const base = env(
    'VITE_SUPABASE_URL',
    'VITE_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL',
    'VITE_SUPABASE_PROJECT_URL',
  );
  const anon =
    env(
      'VITE_SUPABASE_ANON_KEY',
      'VITE_PUBLIC_SUPABASE_ANON_KEY',
      'VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_ANON_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'VITE_SUPABASE_KEY',
    ) || '';
  const url = new URL(req.url);
  const type = url.searchParams.get('type') || 'sitemap';
  const path = url.searchParams.get('path') || '/';

  if (!ALLOWED.has(type)) return new Response('Not found', { status: 404 });
  if (!base) {
    if (type === 'sitemap') {
      return new Response(fallbackSitemap(url.origin), {
        status: 200,
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
      });
    }
    return new Response('Not found', { status: 404 });
  }

  const target = `${base}/functions/v1/feeds?type=${type}&path=${encodeURIComponent(path)}`;
  let r: Response;
  try {
    r = await fetch(target, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
    if (!r.ok && type === 'sitemap') {
      return new Response(fallbackSitemap(url.origin), {
        status: 200,
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
      });
    }
  } catch {
    if (type === 'sitemap') {
      return new Response(fallbackSitemap(url.origin), {
        status: 200,
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
      });
    }
    // Supabase unreachable — answer crawlers with a clean error instead of an unhandled stack trace.
    return new Response('Upstream feed unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const headers = new Headers(r.headers);
  headers.set('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  headers.delete('access-control-allow-origin');
  return new Response(r.body, { status: r.status, headers });
}
