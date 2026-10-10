// The Strategist's placement plan and the Auditor's check on it. Pure logic: no database, no Deno globals,
// so it runs under Vitest. Nothing here writes to an article. The apply step (a later slice) does that,
// and only after the Auditor allows the plan.
//
// A plan says: which one paragraph to add to, which 1 to 3 active shop products, and one or two sentences.
// A paragraph is one plain text line of the article body (headings, lists, quotes, images and code are not).

import type { MindThinkResult } from "./mindThink.ts";

export const PLACEMENT_MAX_PRODUCTS = 3;
export const PLACEMENT_MAX_SENTENCES = 2;
export const PLACEMENT_MAX_WORDS = 60;
/** How much of the article the Strategist reads, so one request stays small. */
export const PLACEMENT_MAX_ARTICLE_CHARS = 8000;

export const NO_KEY_DETAIL = "Cannot think: no brain key saved.";

export interface ArticleParagraph {
  /** The line number in the article body. An edit replaces exactly this line. */
  index: number;
  text: string;
}

export interface ShopProduct {
  id: string;
  name: string;
  isDigital: boolean;
  /** Price in US dollars, from the shop's price in cents. Null when the shop has no price. */
  priceUsd: number | null;
}

export interface PlacementCandidate {
  paragraphIndex: number;
  productIds: string[];
  sentences: string[];
}

export interface AuditVerdict {
  verdict: "allow" | "block";
  /** Plain English for the owner. Empty when the plan is allowed. */
  fix: string;
  reasons: string[];
}

export type PlanStatus = "planned" | "blocked" | "no_fit" | "cannot_think" | "failed";

export interface PlacementPlan {
  status: PlanStatus;
  detail: string;
  candidate: PlacementCandidate | null;
  verdict: AuditVerdict | null;
}

const EM_OR_EN_DASH = /[\u2014\u2013]/;
const COUNTRY_OR_CITY = /\b(nigeria|nigerian|naira|lagos|abuja)\b/i;
const NON_USD_MONEY = /[\u00a3\u20ac\u20a6]|\b(gbp|eur|ngn)\b/i;
const CURE_OR_MEDICAL_PROMISE =
  /\b(cures?|heals?|treats? (acne|eczema|psoriasis|rosacea|infections?)|clinically proven|doctor recommended|dermatologist (recommended|approved)|guaranteed|miracle|permanent(ly)? (fix|cure))\b/i;
const PERSONAL_TEST_CLAIM = /\b(i tested|i've tested|i have tested|i tried this|i've tried|in my experience|my own skin|i personally)\b/i;
const MARKUP = /[<>]|\*\*|\]\(/;

/**
 * Digital products first, then the rest, keeping the order each group already had. Ordering only: the cap of three
 * is still the Auditor's rule, so a plan with four products is still blocked. The Strategist decides what fits.
 * This only decides which fitting product leads, so a digital product wins over a physical one or an affiliate link.
 */
export function digitalFirst(productIds: string[], shop: ShopProduct[]): string[] {
  const digital = new Map(shop.map((product) => [product.id, product.isDigital]));
  const isDigital = (id: string) => digital.get(id) === true;
  return [...productIds.filter(isDigital), ...productIds.filter((id) => !isDigital(id))];
}

/** The plain paragraphs of an article body, each with the line number it sits on. */
export function paragraphsOf(content: string | null): ArticleParagraph[] {
  if (!content) return [];
  const out: ArticleParagraph[] = [];
  content.split("\n").forEach((raw, index) => {
    const text = raw.trim();
    if (!text) return;
    if (/^(#{1,6}\s|[-*]\s|\d+\.\s|>|```|!\[|-{3,}$|\*{3,}$|<)/.test(text)) return;
    out.push({ index, text });
  });
  return out;
}

/** Splits text into sentences on full stops, question marks and exclamation marks. */
export function sentencesOf(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normal(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9$.]+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reads the Strategist's JSON answer. Anything that is not clearly that shape returns null. */
export function parsePlacementReply(text: string): PlacementCandidate | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const paragraph = parsed.paragraph;
  const ids = parsed.product_ids;
  const sentences = parsed.sentences;
  if (typeof paragraph !== "number" || !Number.isInteger(paragraph) || paragraph < 0) return null;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
  if (typeof sentences !== "string" || !sentences.trim()) return null;
  return {
    paragraphIndex: paragraph,
    productIds: ids as string[],
    sentences: sentencesOf(sentences),
  };
}

/** The Strategist's brief. It carries the Lixxon Studio voice rules and the locked owner rules. */
export function buildPlacementPrompt(
  title: string,
  content: string | null,
  shop: ShopProduct[],
): { system: string; prompt: string } {
  const system = [
    "You are the Strategist for Lixxon Studio, a magazine for readers in the US, UK, Canada, Australia, Ireland, New Zealand and Singapore. Write in English.",
    "You choose where one shop product fits in an existing article, and you write one or two new sentences for that place.",
    "Voice for the new sentences: calm, warm, clear and honest. Like a thoughtful person talking to one reader. Plain words, no hype, no screaming.",
    "Use I at most once, and only for editorial judgment. Never invent a personal story, a test, a result, or a credential.",
    "Never claim a product cures, heals or treats a condition, and never say a doctor or dermatologist recommends it.",
    "Never use a dash character. Use full stops and commas. Never name a country or a city.",
    "If a price appears, it must be the exact US dollar price given in the shop list, written like $12.00. Otherwise leave the price out.",
    "Name each product exactly as it appears in the shop list.",
    "Do not repeat a sentence that is already in the article. Add something new that fits the paragraph.",
    "Choose at most three products. When a digital product fits, use it before a physical product or an affiliate link.",
    "Reply with JSON only, in this exact shape: {\"paragraph\": <line number>, \"product_ids\": [\"<id>\"], \"sentences\": \"<one or two sentences>\"}",
    "If no product fits any paragraph honestly, reply with {\"paragraph\": -1, \"product_ids\": [], \"sentences\": \"\"}.",
  ].join("\n");

  const lines = paragraphsOf(content).map((paragraph) => `[${paragraph.index}] ${paragraph.text}`);
  let article = lines.join("\n");
  if (article.length > PLACEMENT_MAX_ARTICLE_CHARS) article = `${article.slice(0, PLACEMENT_MAX_ARTICLE_CHARS)}\n(the article continues)`;
  // Digital products are listed first, so the Strategist sees them first.
  const shopOrdered = [...shop].sort((a, b) => Number(b.isDigital) - Number(a.isDigital));
  const shopLines = shopOrdered.map((product) => {
    const price = product.priceUsd === null ? "no price" : `$${product.priceUsd.toFixed(2)}`;
    return `${product.id} | ${product.name} | ${product.isDigital ? "digital" : "product"} | ${price}`;
  });
  const prompt = [
    `ARTICLE TITLE: ${title}`,
    "ARTICLE PARAGRAPHS (the number in brackets is the line number):",
    article || "(no plain paragraphs)",
    "",
    "ACTIVE SHOP PRODUCTS (id | name | type | US dollar price):",
    shopLines.join("\n") || "(none)",
  ].join("\n");
  return { system, prompt };
}

/**
 * The Auditor. Allows the plan only when every check passes. Each failed check adds one plain-English fix.
 * Pure: it reads the article and the shop, and changes neither.
 */
export function auditPlacement(candidate: PlacementCandidate, content: string | null, shop: ShopProduct[]): AuditVerdict {
  const reasons: Array<{ reason: string; fix: string }> = [];
  const block = (reason: string, fix: string) => reasons.push({ reason, fix });

  const chosen = candidate.productIds.map((id) => shop.find((product) => product.id === id) ?? null);
  if (candidate.productIds.length < 1) block("no product", "Pick at least one product from the shop.");
  if (candidate.productIds.length > PLACEMENT_MAX_PRODUCTS) block("too many products", "Keep it to three products or fewer on one article.");
  if (new Set(candidate.productIds).size !== candidate.productIds.length) block("repeated product", "Each product can only be listed once.");
  if (chosen.some((product) => product === null)) block("not in shop", "That product is not in the shop. Create it yourself, then try again.");

  const paragraph = paragraphsOf(content).find((item) => item.index === candidate.paragraphIndex);
  if (!paragraph) block("not a paragraph", "That place is not a plain paragraph of the article. Pick another paragraph.");

  const text = candidate.sentences.join(" ");
  if (candidate.sentences.length < 1) block("no sentences", "Write one or two sentences for the place.");
  if (candidate.sentences.length > PLACEMENT_MAX_SENTENCES) block("too many sentences", "Use one or two sentences, not more.");
  if (wordCount(text) > PLACEMENT_MAX_WORDS) block("too long", "Keep the new text to two short sentences. This is a line, not a rewrite.");
  if (EM_OR_EN_DASH.test(text)) block("dash", "Remove the dash. Use a full stop or a comma instead.");
  if (COUNTRY_OR_CITY.test(text)) block("country", "Remove the country or city name. Write for readers everywhere.");
  if (NON_USD_MONEY.test(text)) block("currency", "Use US dollars only, or leave the price out.");
  if (CURE_OR_MEDICAL_PROMISE.test(text)) block("medical", "Remove the health promise. Say what the product is for, not what it cures.");
  if (PERSONAL_TEST_CLAIM.test(text)) block("personal claim", "Remove the personal test claim. Only say what is true of the product.");
  if (MARKUP.test(text)) block("markup", "Plain sentences only, with no tags or bold marks.");

  const prices = [...text.matchAll(/\$(\d+(?:\.\d{1,2})?)/g)].map((match) => Number(match[1]));
  const allowedPrices = chosen.filter((product): product is ShopProduct => product !== null && product.priceUsd !== null).map((product) => product.priceUsd as number);
  if (prices.some((price) => !allowedPrices.some((allowed) => Math.abs(allowed - price) < 0.005))) {
    block("price", "Use the exact shop price for the product, or leave the price out.");
  }

  for (const product of chosen) {
    if (product && !normal(text).includes(normal(product.name))) {
      block("not named", `Name "${product.name}" as it appears in the shop.`);
      break;
    }
  }

  if (content && candidate.sentences.some((sentence) => sentence.length > 20 && normal(content).includes(normal(sentence)))) {
    block("repeat", "One of these sentences is already in the article. Write something new.");
  }

  if (reasons.length === 0) return { verdict: "allow", fix: "", reasons: [] };
  const unique = reasons.filter((item, index) => reasons.findIndex((other) => other.reason === item.reason) === index);
  return { verdict: "block", fix: unique.map((item) => item.fix).join(" "), reasons: unique.map((item) => item.reason) };
}

/**
 * Makes one plan for one article. One call through `think` (the brain chain), then the Auditor.
 * Honest about every failure: no key, a bad reply, or a blocked plan. Nothing here is ever applied.
 */
export async function planPlacement(
  article: { id: string; title: string; content: string | null },
  shop: ShopProduct[],
  think: (request: { mind: string; system: string; prompt: string }) => Promise<MindThinkResult>,
): Promise<PlacementPlan> {
  if (shop.length === 0) {
    return { status: "no_fit", detail: "The shop has no active products to place.", candidate: null, verdict: null };
  }
  const { system, prompt } = buildPlacementPrompt(article.title, article.content, shop);
  const result = await think({ mind: "strategist", system, prompt });
  if (!result.ok) {
    if (result.reason === "no_key") return { status: "cannot_think", detail: NO_KEY_DETAIL, candidate: null, verdict: null };
    return { status: "failed", detail: "The Strategist could not finish just now. Nothing was applied.", candidate: null, verdict: null };
  }
  if (/"paragraph"\s*:\s*-1\b/.test(result.text)) {
    return { status: "no_fit", detail: "No product fits a paragraph of this article honestly. Nothing was applied.", candidate: null, verdict: null };
  }
  const parsed = parsePlacementReply(result.text);
  if (!parsed) {
    return { status: "failed", detail: "The Strategist's answer was not usable. Nothing was applied.", candidate: null, verdict: null };
  }
  // Digital products that fit lead the list. The Auditor still checks the cap of three.
  const candidate: PlacementCandidate = { ...parsed, productIds: digitalFirst(parsed.productIds, shop) };
  const verdict = auditPlacement(candidate, article.content, shop);
  if (verdict.verdict === "block") {
    return { status: "blocked", detail: verdict.fix, candidate, verdict };
  }
  return { status: "planned", detail: "The Auditor allowed this plan. It is not applied yet.", candidate, verdict };
}
