// Vercel serverless proxy (Hobby tier, free) → Supabase `feeds` edge function.
// Lets /sitemap.xml, /rss.xml and bot prerendering work without hard-coding the project URL
// in vercel.json; the Supabase URL comes from the same env var the frontend uses.
export const config = { runtime: 'edge' };

const ALLOWED = new Set(['sitemap', 'rss', 'prerender']);

export default async function handler(req: Request): Promise<Response> {
  const base = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || '';
  const url = new URL(req.url);
  const type = url.searchParams.get('type') || 'sitemap';
  const path = url.searchParams.get('path') || '/';
  if (!base || !ALLOWED.has(type)) return new Response('Not found', { status: 404 });
  const target = `${base}/functions/v1/feeds?type=${type}&path=${encodeURIComponent(path)}`;
  const r = await fetch(target, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
  const headers = new Headers(r.headers);
  headers.set('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  headers.delete('access-control-allow-origin');
  return new Response(r.body, { status: r.status, headers });
}
