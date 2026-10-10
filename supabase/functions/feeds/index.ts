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
    const [{ data: posts }, { data: cats }, { data: products }, { data: cols }, { data: authors }] = await Promise.all([
      sb.from("posts").select("slug, updated_at, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(5000),
      sb.from("categories").select("slug"),
      sb.from("products").select("slug, updated_at").eq("is_active", true).not("slug", "is", null),
      sb.from("collections").select("slug").eq("is_active", true),
      sb.from("authors").select("slug"),
    ]);
    const u = (loc: string, lastmod?: string | null, pri = "0.6") => `<url><loc>${site}${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ""}<priority>${pri}</priority></url>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${u("/", null, "1.0")}${u("/shop", null, "0.8")}${u("/collections")}${u("/about")}${u("/contact")}${u("/gift-cards")}${u("/weekly-digest")}
${(posts || []).map((p) => u(`/blog/${encodeURIComponent(p.slug)}`, p.updated_at || p.published_at, "0.8")).join("")}
${(cats || []).map((c) => u(`/category/${encodeURIComponent(c.slug)}`, null, "0.7")).join("")}
${(products || []).map((p) => u(`/shop/product/${encodeURIComponent(p.slug)}`, p.updated_at, "0.7")).join("")}
${(cols || []).map((c) => u(`/collections/${encodeURIComponent(c.slug)}`)).join("")}
${(authors || []).map((a) => u(`/author/${encodeURIComponent(a.slug)}`, null, "0.4")).join("")}
</urlset>`;
    return new Response(xml, { headers: cache("application/xml; charset=utf-8") });
  }

  if (type === "rss") {
    const { data: posts } = await sb.from("posts").select("title, slug, excerpt, published_at, cover_image, category:categories(name)").eq("status", "published").order("published_at", { ascending: false }).limit(30);
    const items = (posts || []).map((p) => `<item><title>${escapeHtml(p.title)}</title><link>${site}/blog/${encodeURIComponent(p.slug)}</link><guid>${site}/blog/${encodeURIComponent(p.slug)}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate>${p.category ? `<category>${escapeHtml((p.category as unknown as { name: string }).name)}</category>` : ""}<description>${escapeHtml(p.excerpt || "")}</description>${p.cover_image ? `<enclosure url="${escapeHtml(p.cover_image)}" type="image/jpeg" />` : ""}</item>`).join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Lixxon Studio</title><link>${site}</link><atom:link href="${site}/rss.xml" rel="self" type="application/rss+xml"/><atom:link href="${WEBSUB_HUB}" rel="hub"/><description>Skincare science, intentional style and minimalist wellness.</description><language>en</language>${items}</channel></rss>`;
    return new Response(xml, { headers: cache("application/rss+xml; charset=utf-8") });
  }

  if (type === "prerender") {
    const path = url.searchParams.get("path") || "/";
    const m = path.match(/^\/blog\/([^/?#]+)/);
    let title = "Lixxon Studio: Skincare, Style & Minimalist Wellness";
    let desc = "A daily digital magazine covering skincare science, intentional style, and minimalist wellness.";
    let image = "";
    let bodyHtml = "";
    let jsonld = "";
    if (m) {
      const { data: p } = await sb.from("posts").select("title, excerpt, content, cover_image, published_at, updated_at, seo_title, seo_description, author:authors(name), category:categories(name)").eq("slug", decodeURIComponent(m[1])).eq("status", "published").maybeSingle();
      if (p) {
        title = p.seo_title || p.title; desc = p.seo_description || p.excerpt || desc; image = p.cover_image || `${site}/api/og?slug=${encodeURIComponent(m[1])}`;
        const paras = String(p.content || "").split("\n").filter(Boolean).slice(0, 40).map((l) => l.startsWith("#") ? `<h2>${escapeHtml(l.replace(/^#+\s*/, ""))}</h2>` : `<p>${escapeHtml(l)}</p>`).join("");
        bodyHtml = `<article><h1>${escapeHtml(p.title)}</h1><p><em>${escapeHtml(p.excerpt || "")}</em></p>${paras}</article>`;
        jsonld = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: p.title, description: desc, image: image || undefined, datePublished: p.published_at, dateModified: p.updated_at || p.published_at, author: { "@type": "Person", name: (p.author as unknown as { name: string })?.name || "Lixxon Studio" }, publisher: { "@type": "Organization", name: "Lixxon Studio" }, mainEntityOfPage: `${site}${path}` })}</script>`;
      }
    }
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(desc)}"><link rel="canonical" href="${site}${escapeHtml(path)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(desc)}">${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}<meta property="og:url" content="${site}${escapeHtml(path)}"><meta name="twitter:card" content="summary_large_image">${jsonld}</head><body>${bodyHtml || `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(desc)}</p>`}<p><a href="${site}${escapeHtml(path)}">Continue to Lixxon Studio</a></p></body></html>`;
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
