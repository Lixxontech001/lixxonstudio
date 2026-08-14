// Vercel Edge Middleware
export default async function middleware(request) {
  const userAgent = request.headers.get('user-agent') || '';
  const isBot = /Flipboard|Pinterest|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|TelegramBot/i.test(userAgent);
  const url = new URL(request.url);

  // Only run this logic for social media scraper bots visiting blog posts
  if (isBot && url.pathname.startsWith('/blog/')) {
    const slug = url.pathname.replace('/blog/', '').split('/')[0];

    // Supabase credentials read directly from environment variables
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://YOUR_SUPABASE_ID.supabase.co';
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

    let title = slug.replace(/-/g, ' ').toUpperCase() + ' | Lixxon Studio';
    let description = 'Read the full article on Lixxon Studio — Skincare, Style & Minimalist Wellness.';
    let imageUrl = '';

    try {
      // Query Supabase REST API directly from the Edge
      const response = await fetch(
        `${supabaseUrl}/rest/v1/posts?slug=eq.${encodeURIComponent(slug)}&select=title,excerpt,cover_image`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          const post = data[0];
          title = `${post.title} | Lixxon Studio`;
          if (post.excerpt) description = post.excerpt;
          if (post.cover_image) imageUrl = post.cover_image;
        }
      }
    } catch (err) {
      // Fallback stays active if database fetch fails
    }

    // Generate response with full dynamic meta tags
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${request.url}" />

    <!-- Open Graph (Flipboard, Facebook, Pinterest) -->
    <meta property="og:site_name" content="Lixxon Studio" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${request.url}" />
    ${imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : ''}

    <!-- Twitter Cards -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}" />` : ''}
  </head>
  <body></body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { 
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=3600, s-maxage=86400'
      },
    });
  }

  // Pass through regular user traffic to the React app
  return fetch(request);
}

export const config = {
  matcher: '/blog/:path*',
};
