/**
 * feeds: dynamic sitemap.xml, rss.xml and bot-prerendered article HTML, straight from the DB.
 *   GET /feeds?type=sitemap
 *   GET /feeds?type=rss
 *   GET /feeds?type=prerender&path=/blog/<slug>   (used by vercel.json rewrite for crawler UAs)
 *   GET /feeds?type=podcast                       (the podcast show feed, /podcast.xml; 404 until the show is set up)
 * Public, cached 1h at the edge. No secrets involved.
 */
import { corsHeaders, serviceClient, escapeHtml, siteUrl } from "../_shared/http.ts";
import { WEBSUB_HUB } from "../_shared/rssHub.ts";
import { buildPodcastFeed, episodeAudioUrl, podcastShowReady, type PodcastEpisode } from "../_shared/podcastFeed.ts";

const cache = (type: string) => ({ ...corsHeaders, "Content-Type": type, "Cache-Control": "public, max-age=3600, s-maxage=3600" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "sitemap";
  const site = siteUrl();
  const sb = serviceClient();

  if (type === "sitemap") {
    const [{ data: posts }, { data: cats }, { data: products }, { data: cols }, { data: authors }, { data: seriesList }] = await Promise.all([
      sb.from("posts").select("slug, updated_at, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(5000),
      sb.from("categories").select("slug"),
      sb.from("products").select("slug, updated_at").eq("is_active", true).not("slug", "is", null),
      sb.from("collections").select("slug").eq("is_active", true),
      sb.from("authors").select("slug"),
      sb.from("article_series").select("slug, updated_at").eq("is_active", true),
    ]);
    const u = (loc: string, lastmod?: string | null, pri = "0.6") => `<url><loc>${site}${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ""}<priority>${pri}</priority></url>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${u("/", null, "1.0")}${u("/shop", null, "0.9")}${u("/collections", null, "0.8")}${u("/series", null, "0.8")}${u("/glossary", null, "0.8")}${u("/weekly-digest", null, "0.8")}${u("/about", null, "0.7")}${u("/contact", null, "0.7")}${u("/gift-cards", null, "0.7")}${u("/privacy", null, "0.3")}${u("/terms", null, "0.3")}
${(posts || []).map((p) => u(`/blog/${encodeURIComponent(p.slug)}`, p.updated_at || p.published_at, "0.8")).join("")}
${(cats || []).map((c) => u(`/category/${encodeURIComponent(c.slug)}`, null, "0.7")).join("")}
${(products || []).map((p) => u(`/shop/product/${encodeURIComponent(p.slug)}`, p.updated_at, "0.7")).join("")}
${(cols || []).map((c) => u(`/collections/${encodeURIComponent(c.slug)}`, null, "0.6")).join("")}
${(seriesList || []).map((s) => u(`/series/${encodeURIComponent(s.slug)}`, s.updated_at, "0.7")).join("")}
${(authors || []).map((a) => u(`/author/${encodeURIComponent(a.slug)}`, null, "0.4")).join("")}
</urlset>`;
    return new Response(xml, { headers: cache("application/xml; charset=utf-8") });
  }

  if (type === "rss") {
    const { data: posts } = await sb.from("posts").select("title, slug, excerpt, content, published_at, cover_image, author:authors(name), category:categories(name)").eq("status", "published").order("published_at", { ascending: false }).limit(30);
    const items = (posts || []).map((p) => {
      const img = p.cover_image ? escapeHtml(p.cover_image) : "";
      const author = p.author ? escapeHtml((p.author as unknown as { name: string }).name) : "Lixxon Studio";
      const cat = p.category ? `<category>${escapeHtml((p.category as unknown as { name: string }).name)}</category>` : "";
      const contentHtml = String(p.content || p.excerpt || "").slice(0, 2000).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<item>
  <title>${escapeHtml(p.title)}</title>
  <link>${site}/blog/${encodeURIComponent(p.slug)}</link>
  <guid>${site}/blog/${encodeURIComponent(p.slug)}</guid>
  <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>
  <author>${author}</author>
  ${cat}
  <description>${escapeHtml(p.excerpt || "")}</description>
  <content:encoded><![CDATA[${contentHtml}]]></content:encoded>
  ${img ? `<enclosure url="${img}" type="image/jpeg" />` : ""}
  ${img ? `<media:content url="${img}" medium="image" />` : ""}
</item>`;
    }).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Lixxon Studio</title>
  <link>${site}</link>
  <atom:link href="${site}/rss.xml" rel="self" type="application/rss+xml"/>
  <atom:link href="${WEBSUB_HUB}" rel="hub"/>
  <description>Skincare science, intentional style and minimalist wellness.</description>
  <language>en</language>
  ${items}
</channel>
</rss>`;
    return new Response(xml, { headers: cache("application/rss+xml; charset=utf-8") });
  }

  if (type === "prerender") {
    const path = url.searchParams.get("path") || "/";
    let title = "Lixxon Studio: Skincare, Style & Minimalist Wellness";
    let desc = "A daily digital magazine covering skincare science, intentional style, and minimalist wellness.";
    let image = `${site}/api/og`;
    let ogType = "website";
    let bodyHtml = "";
    let jsonld = "";
    let extraMeta = "";

    const blogMatch = path.match(/^\/blog\/([^/?#]+)/);
    const prodMatch = path.match(/^\/shop\/product\/([^/?#]+)/);
    const catMatch = path.match(/^\/category\/([^/?#]+)/);
    const colMatch = path.match(/^\/collections\/([^/?#]+)/);
    const seriesMatch = path.match(/^\/series\/([^/?#]+)/);
    const authorMatch = path.match(/^\/author\/([^/?#]+)/);

    if (blogMatch) {
      const slug = decodeURIComponent(blogMatch[1]);
      const { data: p } = await sb.from("posts").select("title, excerpt, content, cover_image, published_at, updated_at, seo_title, seo_description, author:authors(name), category:categories(name)").eq("slug", slug).eq("status", "published").maybeSingle();
      if (p) {
        title = `${p.seo_title || p.title} | Lixxon Studio`;
        desc = p.seo_description || p.excerpt || desc;
        image = p.cover_image || `${site}/api/og?slug=${encodeURIComponent(slug)}`;
        ogType = "article";
        const authorName = (p.author as unknown as { name: string })?.name || "Lixxon Studio";
        const categoryName = (p.category as unknown as { name: string })?.name || "Editorial";
        extraMeta = `
    <meta property="article:published_time" content="${p.published_at}" />
    <meta property="article:modified_time" content="${p.updated_at || p.published_at}" />
    <meta property="article:author" content="${escapeHtml(authorName)}" />
    <meta property="article:section" content="${escapeHtml(categoryName)}" />`;
        const paras = String(p.content || "").split("\n").filter(Boolean).slice(0, 40).map((l) => l.startsWith("#") ? `<h2>${escapeHtml(l.replace(/^#+\s*/, ""))}</h2>` : `<p>${escapeHtml(l)}</p>`).join("");
        bodyHtml = `<article>
          <h1>${escapeHtml(p.title)}</h1>
          <p><strong>By ${escapeHtml(authorName)} · Published in ${escapeHtml(categoryName)}</strong></p>
          ${p.cover_image ? `<img src="${escapeHtml(p.cover_image)}" alt="${escapeHtml(p.title)}" style="max-width:100%;height:auto;" />` : ""}
          <p><em>${escapeHtml(p.excerpt || "")}</em></p>
          ${paras}
        </article>`;
        jsonld = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: p.title, description: desc, image: image || undefined, datePublished: p.published_at, dateModified: p.updated_at || p.published_at, author: { "@type": "Person", name: authorName }, publisher: { "@type": "Organization", name: "Lixxon Studio", url: site }, mainEntityOfPage: `${site}${path}` })}</script>`;
      }
    } else if (prodMatch) {
      const slug = decodeURIComponent(prodMatch[1]);
      const { data: pr } = await sb.from("products").select("name, slug, description, image_url, images, price_usd, currency").eq("slug", slug).eq("is_active", true).maybeSingle();
      if (pr) {
        title = `${pr.name} | Lixxon Studio Shop`;
        desc = pr.description || `Curated digital guide and wellness essential: ${pr.name}`;
        image = pr.image_url || pr.images?.[0] || `${site}/api/og?title=${encodeURIComponent(pr.name)}`;
        ogType = "product";
        extraMeta = `
    <meta property="product:price:amount" content="${pr.price_usd || '0.00'}" />
    <meta property="product:price:currency" content="${pr.currency || 'USD'}" />`;
        bodyHtml = `<article>
          <h1>${escapeHtml(pr.name)}</h1>
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(pr.name)}" style="max-width:100%;height:auto;" />` : ""}
          <p><strong>Price: $${pr.price_usd} ${pr.currency || "USD"}</strong></p>
          <p>${escapeHtml(desc)}</p>
        </article>`;
        jsonld = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: pr.name, description: desc, image: image || undefined, offers: { "@type": "Offer", price: pr.price_usd, priceCurrency: pr.currency || "USD", availability: "https://schema.org/InStock" } })}</script>`;
      }
    } else if (catMatch) {
      const slug = decodeURIComponent(catMatch[1]);
      const { data: cat } = await sb.from("categories").select("name, slug, description, image_url").eq("slug", slug).maybeSingle();
      if (cat) {
        title = `${cat.name} Stories & Guides | Lixxon Studio`;
        desc = cat.description || `Read thoughtful, expert-written ${cat.name.toLowerCase()} articles on Lixxon Studio.`;
        image = cat.image_url || `${site}/api/og?title=${encodeURIComponent(cat.name)}`;
        bodyHtml = `<header><h1>${escapeHtml(cat.name)}</h1><p>${escapeHtml(desc)}</p></header>`;
      }
    } else if (colMatch) {
      const slug = decodeURIComponent(colMatch[1]);
      const { data: col } = await sb.from("collections").select("title, slug, description, cover_image").eq("slug", slug).eq("is_active", true).maybeSingle();
      if (col) {
        title = `${col.title} | Lixxon Studio Collections`;
        desc = col.description || `Curated editorial collection: ${col.title}`;
        image = col.cover_image || `${site}/api/og?title=${encodeURIComponent(col.title)}`;
        bodyHtml = `<article><h1>${escapeHtml(col.title)}</h1><p>${escapeHtml(desc)}</p></article>`;
      }
    } else if (seriesMatch) {
      const slug = decodeURIComponent(seriesMatch[1]);
      const { data: s } = await sb.from("article_series").select("title, slug, description, cover_image").eq("slug", slug).eq("is_active", true).maybeSingle();
      if (s) {
        title = `${s.title} Series | Lixxon Studio`;
        desc = s.description || `Multi-part editorial guide: ${s.title}`;
        image = s.cover_image || `${site}/api/og?title=${encodeURIComponent(s.title)}`;
        bodyHtml = `<article><h1>${escapeHtml(s.title)}</h1><p>${escapeHtml(desc)}</p></article>`;
      }
    } else if (authorMatch) {
      const slug = decodeURIComponent(authorMatch[1]);
      const { data: a } = await sb.from("authors").select("name, slug, bio, avatar_url").eq("slug", slug).maybeSingle();
      if (a) {
        title = `${a.name} · Author & Contributor | Lixxon Studio`;
        desc = a.bio || `Articles and editorial insights by ${a.name} on Lixxon Studio.`;
        image = a.avatar_url || `${site}/api/og?title=${encodeURIComponent(a.name)}`;
        bodyHtml = `<header><h1>${escapeHtml(a.name)}</h1><p>${escapeHtml(desc)}</p></header>`;
      }
    }

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(desc)}">
  <link rel="canonical" href="${site}${escapeHtml(path)}">
  <meta property="og:site_name" content="Lixxon Studio">
  <meta property="og:locale" content="en_US">
  <meta property="og:type" content="${ogType}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(desc)}">
  <meta property="og:url" content="${site}${escapeHtml(path)}">
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
  ${image ? `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : ""}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@lixxonstudio">
  <meta name="twitter:creator" content="@lixxonstudio">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(desc)}">
  ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ""}
  ${extraMeta}
  ${jsonld}
</head>
<body>
  ${bodyHtml || `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(desc)}</p>`}
  <p><a href="${site}${escapeHtml(path)}">Continue reading on Lixxon Studio</a></p>
</body>
</html>`;
    return new Response(html, { headers: cache("text/html; charset=utf-8") });
  }

  if (type === "podcast") {
    // The show's title, author and cover come from the owner's saved settings (service role only, read here on the server).
    const [title, author, cover] = await Promise.all(
      ["podcast_show_title", "podcast_show_author", "podcast_cover_url"].map((name) =>
        sb.rpc("automation_secret_get_internal", { p_secret_name: name }).then((r) => (typeof r.data === "string" ? r.data : "")),
      ),
    );
    const show = { title, author, coverUrl: cover, siteUrl: site, feedUrl: `${site}/podcast.xml` };
    if (!podcastShowReady(show)) {
      return new Response("The podcast is not set up yet.", {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const { data: rows } = await sb
      .from("podcast_episodes")
      .select("id, title, description, article_url, published_at, audio_path, audio_bytes, audio_type")
      .order("published_at", { ascending: false })
      .limit(300);
    const base = Deno.env.get("SUPABASE_URL") ?? "";
    const episodes: PodcastEpisode[] = (rows || []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      description: String(row.description ?? ""),
      articleUrl: String(row.article_url),
      publishedAt: String(row.published_at),
      audioUrl: episodeAudioUrl(base, String(row.audio_path)) ?? "",
      audioBytes: Number(row.audio_bytes),
      audioType: String(row.audio_type),
    }));
    return new Response(buildPodcastFeed(show, episodes), { headers: cache("application/rss+xml; charset=utf-8") });
  }

  return new Response("Not found", { status: 404, headers: corsHeaders });
});
