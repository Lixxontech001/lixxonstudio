// Phase I slice 5: the one US dollar price change a day, and the Auditor's check on it.
//
// Rules kept here:
// - US dollars only. The Auditor blocks a price of nothing, a free price, any other currency, and any writing that
//   names another money or a country.
// - One change moves a price by a quarter at most, never below a dollar, never above a thousand, and always to whole
//   cents. A change smaller than fifty cents is not a change.
// - The words the owner gets are the dollars themselves: what it was, what it is now, and the one plain sentence the
//   Strategist gave for it.
// Pure logic: no database, no network, no Deno globals, so it runs under Vitest.

import type { MindThinkResult } from "./mindThink.ts";

export const PRICE_MIN_USD = 1;
export const PRICE_MAX_USD = 999.99;
export const PRICE_MIN_STEP_USD = 0.5;
export const PRICE_MAX_CHANGE_SHARE = 0.25;
export const PRICE_WHY_LIMIT = 200;

/** The one line when the Strategist looked and left the shop as it is. */
export const PRICE_LEFT_ALONE = "The Strategist looked at the shop and left the prices as they are.";

export interface PriceProduct {
  id: string;
  name: string;
  /** The shop's price in US dollars. Null when the shop has no price for it. */
  priceUsd: number | null;
  /** The shop's own currency for this product. Null means the shop treats it as US dollars. */
  currency: string | null;
}

export interface PriceCandidate {
  productId: string;
  priceUsd: number;
  why: string;
}

export interface PriceVerdict {
  verdict: "allow" | "block";
  /** Plain English for the owner. Empty when the change is allowed. */
  fix: string;
  reasons: string[];
}

export type PricePlanStatus = "planned" | "nothing" | "cannot_think" | "failed";

export interface PricePlan {
  status: PricePlanStatus;
  detail: string;
  candidate: PriceCandidate | null;
  verdict: PriceVerdict;
  /** The product the plan is about, when one was named. */
  product: PriceProduct | null;
}

const EM_OR_EN_DASH = /[\u2014\u2013]/;
const COUNTRY_OR_CITY = /\b(nigeria|nigerian|naira|lagos|abuja)\b/i;
const NON_USD_MONEY = /[\u00a3\u20ac\u20a6]|\b(gbp|eur|ngn|pounds?|euros?|naira)\b/i;
const MARKUP = /[<>]|\*\*|\]\(/;

/** The Strategist's brief. US dollars only, one product, one price, one plain reason. */
export function buildPricePrompt(products: readonly PriceProduct[], facts: string): { system: string; prompt: string } {
  const system = [
    "You are the Strategist for Lixxon Studio, a magazine with a shop. Write in English.",
    "You look at the shop and the site facts, and you decide whether ONE product's price should change today.",
    "You may change a price only when the facts honestly support it, such as a product that sells and is priced low, or one that never sells at its price.",
    "Prices are in US dollars, written to the cent, like 12.50. Never write a price of nothing, and never a free price.",
    "One change moves a price by a quarter at most. Never below one dollar and never above nine hundred and ninety nine dollars.",
    "Never name a country or a city, and never name any money other than the US dollar.",
    "The reason is one short plain sentence for the owner. No dashes, no hype, no jargon.",
    'Reply with JSON only, in this exact shape: {"product_id": "<id from the list>", "price": <number>, "why": "<one short sentence>"}.',
    'If no price should change today, reply with {"product_id": "", "price": 0, "why": ""}.',
  ].join("\n");

  const shopLines = products.map((product) => `${product.id} | ${product.name} | ${product.priceUsd === null ? "no price" : `$${product.priceUsd.toFixed(2)}`}`);
  const prompt = [
    `SITE FACTS: ${facts.trim() || "(none)"}`,
    "LIVE SHOP PRODUCTS (id | name | US dollar price now):",
    shopLines.join("\n") || "(none)",
  ].join("\n");
  return { system, prompt };
}

/** Reads the Strategist's reply. Anything that is not the agreed shape is null, so nothing is ever guessed. */
export function parsePriceReply(text: string): PriceCandidate | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const productId = typeof parsed.product_id === "string" ? parsed.product_id.trim() : "";
  const raw = typeof parsed.price === "number" ? parsed.price : typeof parsed.price === "string" ? Number(parsed.price) : NaN;
  const why = typeof parsed.why === "string" ? parsed.why.replace(/\s+/g, " ").trim() : "";
  if (!productId || !Number.isFinite(raw)) return null;
  return { productId, priceUsd: raw, why };
}

const MONEY = (value: number): string => `$${value.toFixed(2)}`;

/**
 * The Auditor. Allows a price change only when every check passes, and says in plain words what to fix otherwise.
 * Pure: it reads the candidate and the shop, and changes neither.
 */
export function auditPriceChange(candidate: PriceCandidate, product: PriceProduct | null): PriceVerdict {
  const reasons: Array<{ reason: string; fix: string }> = [];
  const block = (reason: string, fix: string) => reasons.push({ reason, fix });

  if (!product) {
    block("not in shop", "That product is not in the live shop. Pick one from the list.");
  } else {
    if (product.currency !== null && product.currency.toUpperCase() !== "USD") {
      block("currency", "US dollar prices only. This product is not priced in US dollars.");
    }
    if (product.priceUsd === null) {
      block("no price", "The shop has no price for this product yet. Set one yourself first, then I can change it.");
    }
  }

  const price = candidate.priceUsd;
  if (!Number.isFinite(price)) block("bad price", "Write the price as a number, like 12.50.");
  else {
    const cents = Math.round(price * 100);
    if (Math.abs(cents / 100 - price) > 0.0001) block("bad price", "Write the price as dollars and cents, like 12.50.");
    if (price <= 0) block("free", "A price of nothing is not a price. Keep it above zero.");
    else if (price < PRICE_MIN_USD) block("too low", `Keep the price at ${MONEY(PRICE_MIN_USD)} or more.`);
    else if (price > PRICE_MAX_USD) block("too high", `Keep the price under ${MONEY(PRICE_MAX_USD)}.`);
  }

  if (product && product.priceUsd !== null && Number.isFinite(price) && price > 0) {
    const step = Math.abs(price - product.priceUsd);
    if (step < PRICE_MIN_STEP_USD) block("no change", "That is the same price. Leave it as it is.");
    else if (step > product.priceUsd * PRICE_MAX_CHANGE_SHARE + 0.005) {
      block("big change", "One change moves a price by a quarter at most. Change it in smaller steps.");
    }
  }

  const why = candidate.why.trim();
  if (!why) block("no reason", "Write one short sentence for why this price moves.");
  else {
    if (why.length > PRICE_WHY_LIMIT) block("too long", "Keep the reason to one short sentence.");
    if (EM_OR_EN_DASH.test(why)) block("dash", "Remove the dash. Use a full stop or a comma instead.");
    if (COUNTRY_OR_CITY.test(why)) block("country", "Remove the country or city name. Write for readers everywhere.");
    if (NON_USD_MONEY.test(why)) block("money", "US dollars only. Leave any other money out of the reason.");
    if (MARKUP.test(why)) block("markup", "Plain words only, with no tags or bold marks.");
  }

  if (reasons.length === 0) return { verdict: "allow", fix: "", reasons: [] };
  const unique = reasons.filter((item, index) => reasons.findIndex((other) => other.reason === item.reason) === index);
  return { verdict: "block", fix: unique.map((item) => item.fix).join(" "), reasons: unique.map((item) => item.reason) };
}

/** The Strategist's plan, already checked by the Auditor. Nothing here changes the shop. */
export async function planPriceChange(
  products: readonly PriceProduct[],
  facts: string,
  think: (request: { mind: string; system: string; prompt: string }) => Promise<MindThinkResult>,
): Promise<PricePlan> {
  if (products.length === 0) {
    return { status: "nothing", detail: "The shop has no live product priced in US dollars, so no price was touched.", candidate: null, verdict: { verdict: "allow", fix: "", reasons: [] }, product: null };
  }
  const { system, prompt } = buildPricePrompt(products, facts);
  const answer = await think({ mind: "strategist", system, prompt });
  if (!answer.ok) {
    return answer.reason === "no_key"
      ? { status: "cannot_think", detail: "Cannot think: no brain key saved.", candidate: null, verdict: { verdict: "allow", fix: "", reasons: [] }, product: null }
      : { status: "failed", detail: "The price check could not be done just now. Nothing changed.", candidate: null, verdict: { verdict: "allow", fix: "", reasons: [] }, product: null };
  }
  const candidate = parsePriceReply(answer.text);
  if (!candidate) return { status: "nothing", detail: PRICE_LEFT_ALONE, candidate: null, verdict: { verdict: "allow", fix: "", reasons: [] }, product: null };
  const product = products.find((item) => item.id === candidate.productId) ?? null;
  return { status: "planned", detail: `${product?.name ?? "A product"}: ${candidate.why || "one change"}.`, candidate, verdict: auditPriceChange(candidate, product), product };
}

/**
 * One allowed fix. The Strategist is asked once, with the Auditor's own words, to repair the price it just gave.
 * It answers in the same JSON shape, so the same reader and the same Auditor are used. Null means: no usable fix,
 * and the change is stopped. Nothing here is ever applied.
 */
export async function fixPriceOnce(
  products: readonly PriceProduct[],
  facts: string,
  blocked: PriceCandidate,
  fix: string,
  think: (request: { mind: string; system: string; prompt: string }) => Promise<MindThinkResult>,
): Promise<PriceCandidate | null> {
  const { system, prompt } = buildPricePrompt(products, facts);
  const blockedText = `product ${blocked.productId}, price ${MONEY(blocked.priceUsd)}, reason "${blocked.why}"`;
  const answer = await think({
    mind: "strategist",
    system,
    prompt: `${prompt}\n\nThe Auditor blocked that price change. Fix it once, then it is checked again.\nTHE CHANGE THE AUDITOR BLOCKED: ${blockedText}\nWHAT THE AUDITOR SAID (fix exactly this): ${fix}`,
  });
  if (!answer.ok) return null;
  return parsePriceReply(answer.text);
}
