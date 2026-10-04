// Dynamic Open Graph image per article: /api/og?slug=... (Vercel Edge + Satori, free on Hobby).
// The prerender HTML (feeds fn) and ArticleReader point og:image here when the post has no cover.
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const esc = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Read a process env var, trying each name in order. */
function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

async function loadPost(slug: string) {
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
  if (!base) return null;
  const r = await fetch(`${base}/rest/v1/posts?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=title,excerpt,reading_time_minutes,category:categories(name),author:authors(name)&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') || '';
  const titleParam = url.searchParams.get('title');
  const post = slug ? await loadPost(slug) : null;
  const title = esc(post?.title || titleParam || 'Lixxon Studio');
  const sub = esc(post?.excerpt || 'Considered beauty, skincare and self-care — written by people, not algorithms.').slice(0, 140);
  const meta = [post?.category?.name, post?.reading_time_minutes ? `${post.reading_time_minutes} min read` : null, post?.author?.name].filter(Boolean).join('  ·  ');
  const size = title.length > 90 ? 44 : title.length > 60 ? 54 : 64;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', background: 'linear-gradient(135deg, #E9E5DC 0%, #F4F1EA 100%)', color: '#1A1A1A', fontFamily: 'Georgia, serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 22, letterSpacing: 8, textTransform: 'uppercase', color: '#B08D57', fontFamily: 'Helvetica, Arial, sans-serif' }}>Lixxon Studio</div>
          {meta && <div style={{ fontSize: 20, color: '#5A5A5A', fontFamily: 'Helvetica, Arial, sans-serif' }}>{meta}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ width: 72, height: 4, background: '#B08D57', marginBottom: 28 }} />
          <div style={{ fontSize: size, lineHeight: 1.12, fontWeight: 400, maxWidth: 1000, display: 'flex' }}>{title}</div>
          <div style={{ marginTop: 24, fontSize: 24, lineHeight: 1.4, color: '#5A5A5A', maxWidth: 900, fontFamily: 'Helvetica, Arial, sans-serif', display: 'flex' }}>{sub}</div>
        </div>
        <div style={{ fontSize: 18, color: '#9A9A9A', fontFamily: 'Helvetica, Arial, sans-serif' }}>lixxonstudio.com</div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000' } },
  );
}
