// Buddy's read-only view of the site: published article titles and active shop products.
// Pure rules. The edge function does the reads (select only, never content or writes) and passes the rows here.
// Money is always USD, shown as "USD 29.00".

export const SITE_ARTICLE_LIMIT = 30;
export const SITE_PRODUCT_LIMIT = 40;

export interface SiteArticle {
  title: string;
  slug: string | null;
  publishedAt: string | null;
  /** The stored one-line summary. Never the article body. */
  excerpt: string | null;
}

export interface SiteProduct {
  name: string;
  priceUsd: number | null;
}

export interface SiteFacts {
  articles: { ok: boolean; total: number; items: SiteArticle[] };
  products: { ok: boolean; total: number; items: SiteProduct[] };
}

/** A read as the database client returns it. Only the parts used here. */
export interface ReadResult {
  data: unknown;
  error: unknown;
  count?: number | null;
}

/** Keeps one line of plain text: no control characters, no line breaks, trimmed and capped. */
export function cleanLine(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const withoutControl = Array.from(value, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  }).join("");
  const cleaned = withoutControl.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max);
}

/** Price in cents from the database to whole dollars and cents. Null when there is no price. */
export function centsToUsd(cents: unknown): number | null {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents < 0) return null;
  return Math.round(cents) / 100;
}

export function formatUsd(amount: number | null): string {
  return amount === null ? "price not set" : `USD ${amount.toFixed(2)}`;
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

export function siteFactsFromReads(articles: ReadResult, products: ReadResult): SiteFacts {
  const articleItems: SiteArticle[] = [];
  for (const row of rowsOf(articles.data)) {
    const title = cleanLine(row.title, 160);
    if (!title) continue;
    articleItems.push({
      title,
      slug: cleanLine(row.slug, 120),
      publishedAt: typeof row.published_at === "string" ? row.published_at : null,
      excerpt: cleanLine(row.excerpt, 200),
    });
  }
  const productItems: SiteProduct[] = [];
  for (const row of rowsOf(products.data)) {
    const name = cleanLine(row.name, 160);
    if (!name) continue;
    productItems.push({ name, priceUsd: centsToUsd(row.price_cents) });
  }
  const articlesOk = !articles.error;
  const productsOk = !products.error;
  return {
    articles: { ok: articlesOk, total: articlesOk ? (articles.count ?? articleItems.length) : 0, items: articlesOk ? articleItems : [] },
    products: { ok: productsOk, total: productsOk ? (products.count ?? productItems.length) : 0, items: productsOk ? productItems : [] },
  };
}

/**
 * The block added to Buddy's instructions for one question. It says what is real, and says plainly
 * when a list could not be read, so Buddy never fills the gap by guessing.
 */
export function siteFactsBlock(facts: SiteFacts): string {
  const lines: string[] = ["THE SITE RIGHT NOW (read only, from the live database; use only this list):"];

  if (!facts.articles.ok) {
    lines.push("Published articles: could not be read just now. Do not name any article.");
  } else if (facts.articles.items.length === 0) {
    lines.push("Published articles: none yet.");
  } else {
    lines.push(`Published articles: ${facts.articles.total} in total. Latest first:`);
    for (const article of facts.articles.items) {
      lines.push(article.excerpt ? `- "${article.title}". Summary: ${article.excerpt}` : `- "${article.title}"`);
    }
    if (facts.articles.total > facts.articles.items.length) {
      lines.push(`(and ${facts.articles.total - facts.articles.items.length} more not listed here)`);
    }
  }

  if (!facts.products.ok) {
    lines.push("Shop products: could not be read just now. Do not name any product or price.");
  } else if (facts.products.items.length === 0) {
    lines.push("Shop products: none active yet.");
  } else {
    lines.push(`Shop products: ${facts.products.total} active in total. Prices are in USD:`);
    for (const product of facts.products.items) lines.push(`- ${product.name}: ${formatUsd(product.priceUsd)}`);
    if (facts.products.total > facts.products.items.length) {
      lines.push(`(and ${facts.products.total - facts.products.items.length} more not listed here)`);
    }
  }

  return lines.join("\n");
}
