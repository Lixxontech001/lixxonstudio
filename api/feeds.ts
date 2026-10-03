// Vercel serverless proxy (Hobby tier, free) → Supabase `feeds` edge function.
// Lets /sitemap.xml, /rss.xml and bot prerendering work without hard-coding the project URL
// in vercel.json; the Supabase URL comes from the same env var the frontend uses.
export const config = { runtime: 'edge' };

const ALLOWED = new Set(['sitemap', 'rss', 'prerender']);

/** Read a process env var, trying each name in order. */
function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

export default async function handler(req: Request): Promise<Response> {
  const base = env('VITE_SUPABASE_URL', 'SUPABASE_URL', 'VITE_SUPABASE_PROJECT_URL');
  const anon = env('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_KEY') || '';
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
