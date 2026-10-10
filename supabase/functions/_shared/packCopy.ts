// The daily pack's copy: one short caption for Instagram, TikTok and Facebook, and a pin title and description for
// Pinterest. Also the publishing time picker, the rule for which article gets a pack, and the choice of products.
// The Strategist's thinking goes through the one door to the brains (`think`). The Auditor checks every answer before it
// can be saved. Pure logic: no database and no network. The caller passes the think function in.

import { copyProblem, PACK_CHANNELS, PACK_PRODUCT_CAP, type PackChannel } from "./packRules.ts";
import type { ShopProduct } from "./productPlacement.ts";
import type { MindThinkResult } from "./mindThink.ts";

export const NO_KEY_COPY_DETAIL = "Cannot think: no brain key saved.";
export const CAPTION_LIMIT = 280;
export const PIN_TITLE_LIMIT = 100;
export const PIN_DESCRIPTION_LIMIT = 300;

export interface PackCopy {
  instagram: string;
  tiktok: string;
  facebook: string;
  pinterest: { title: string; description: string };
}

export interface CopyVerdict {
  verdict: "allow" | "block";
  /** Plain words for the owner: what to change, or "The Auditor allowed this copy." */
  fix: string;
  /** Channels whose copy is blocked. Empty when allowed. */
  blockedChannels: PackChannel[];
}

export type CopyPlanStatus = "planned" | "blocked" | "cannot_think" | "failed";

export interface CopyPlan {
  status: CopyPlanStatus;
  detail: string;
  copy: PackCopy | null;
  verdict: CopyVerdict | null;
}

/** Medical or cure promises, and claims that the writer tested the product. Never allowed in a caption. */
const MEDICAL_PROMISE = /\b(cures?|heals?|treats? (acne|eczema|psoriasis|rosacea|infections?)|clinically proven|doctor recommended|dermatologist (recommended|approved)|guaranteed|miracle)\b/i;
const PERSONAL_TEST_CLAIM = /\b(i tested|i've tested|i have tested|i tried this|i've tried|in my experience|my own skin|i personally|my story)\b/i;
const MARKUP = /[<>]|\*\*|\]\(|https?:\/\//i;
/** Product-looking names in the copy. Each one must match a shop product, or it is an invented product. */
const PRODUCT_LIKE = /\b((?:[A-Z][A-Za-z'-]*\s+){0,4}[A-Z][A-Za-z'-]*\s+(?:Guide|Kit|Pack|Checklist|Bundle|Planner|Course|Ebook|Journal))\b/g;

/** Where each channel's copy is spread. Plain labels and UTC hours; the owner's clock is never used. */
export interface TimeWindow {
  id: string;
  label: string;
  utcHour: number;
  /** The top countries this window reaches. A window counts for learning only when it reaches one of TOP_COUNTRIES. */
  countries: readonly string[];
}

/** The countries the learning is measured for. Plain names, no city. */
export const TOP_COUNTRIES: readonly string[] = ["US", "UK", "Canada", "Australia", "Ireland", "New Zealand", "Singapore"];
/** Fewer measured posts than this, and the current windows stay as they are. */
export const LEARN_MIN_POSTS = 10;
/** How far back the measured posts are read. */
export const LEARN_LOOKBACK_DAYS = 90;

export const TIME_WINDOWS: readonly TimeWindow[] = [
  { id: "us-east-morning", label: "Morning, US Eastern", utcHour: 13, countries: ["US", "Canada"] },
  { id: "uk-lunchtime", label: "Lunchtime, UK and Ireland", utcHour: 12, countries: ["UK", "Ireland"] },
  { id: "us-pacific-evening", label: "Evening, US Pacific", utcHour: 1, countries: ["US"] },
  { id: "sg-evening", label: "Evening, Singapore", utcHour: 11, countries: ["Singapore"] },
  { id: "au-morning", label: "Morning, Australia Eastern", utcHour: 22, countries: ["Australia"] },
  { id: "nz-morning", label: "Morning, New Zealand", utcHour: 21, countries: ["New Zealand"] },
];

/** The windows the picker offers for each channel. The first one is the suggestion. */
export const CHANNEL_WINDOWS: Record<PackChannel, readonly string[]> = {
  instagram: ["us-east-morning", "uk-lunchtime", "us-pacific-evening"],
  tiktok: ["us-pacific-evening", "au-morning", "sg-evening"],
  facebook: ["us-east-morning", "uk-lunchtime"],
  pinterest: ["us-pacific-evening", "sg-evening", "nz-morning"],
};

export interface TimeOption {
  id: string;
  label: string;
  utcHour: number;
}

/**
 * The windows a channel offers, best first. `ranked` (from learnWindows) only reorders them. It never adds a window,
 * so the Auditor's offered-window check is the same as before. With no ranking, the current order is kept.
 */
export function timeOptionsFor(channel: PackChannel, ranked: readonly string[] = []): TimeOption[] {
  const rank = (id: string) => {
    const index = ranked.indexOf(id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...CHANNEL_WINDOWS[channel]]
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => TIME_WINDOWS.find((window) => window.id === id)!)
    .map((window) => ({
      id: window.id,
      label: window.label,
      utcHour: window.utcHour,
    }));
}

/** The suggested publishing time for one local day and channel, as UTC plus the plain label. Null for a bad day. */
export function suggestedTimeFor(
  channel: PackChannel,
  localDay: string,
  windowId?: string,
  ranked: readonly string[] = [],
): { atUtc: string; label: string; windowId: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDay)) return null;
  const offered = timeOptionsFor(channel, ranked);
  const option = offered.find((item) => item.id === (windowId ?? offered[0]?.id));
  if (!option) return null;
  const [year, month, day] = localDay.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day, option.utcHour, 0, 0));
  if (Number.isNaN(at.getTime())) return null;
  return { atUtc: at.toISOString(), label: option.label, windowId: option.id };
}

/** Auditor check for a chosen time: the window must be offered for that channel, and the hour must match it. */
export function timeProblem(channel: PackChannel, atUtc: string, windowId: string): string | null {
  if (!CHANNEL_WINDOWS[channel].includes(windowId)) return "time_not_offered";
  const window = TIME_WINDOWS.find((item) => item.id === windowId);
  const at = new Date(atUtc);
  if (!window || Number.isNaN(at.getTime())) return "time_invalid";
  return at.getUTCHours() === window.utcHour ? null : "time_mismatch";
}

/** Digital products first, then the rest, at most the pack cap. Digital products are the revenue priority. */
export function chooseProductsForCopy(products: ShopProduct[]): ShopProduct[] {
  const digital = products.filter((product) => product.isDigital);
  const other = products.filter((product) => !product.isDigital);
  return [...digital, ...other].slice(0, PACK_PRODUCT_CAP);
}

export interface PackArticle {
  id: string;
  title: string;
  /** Live product slots on the article, each with whether it is digital. */
  liveProducts: { id: string; isDigital: boolean }[];
}

/**
 * Which article gets the next pack. Tightened for packs: while any article carries a live digital product, only those
 * articles are considered. Then the one with the most digital products wins, then the most live products, then the
 * order given (newest first). Null when no article fits.
 */
export function choosePackArticle(articles: PackArticle[]): PackArticle | null {
  const digitalArticles = articles.filter((article) => article.liveProducts.some((product) => product.isDigital));
  const pool = digitalArticles.length > 0 ? digitalArticles : articles.filter((article) => article.liveProducts.length > 0);
  if (pool.length === 0) return null;
  const scored = pool.map((article, position) => ({
    article,
    position,
    digital: article.liveProducts.filter((product) => product.isDigital).length,
    live: article.liveProducts.length,
  }));
  scored.sort((a, b) => b.digital - a.digital || b.live - a.live || a.position - b.position);
  return scored[0].article;
}

export function buildCopyPrompt(articleTitle: string, products: ShopProduct[]): { system: string; prompt: string } {
  const names = chooseProductsForCopy(products).map((product) => `- ${product.name}${product.isDigital ? " (digital)" : ""}`);
  const system = [
    "You write short, calm, practical social copy for Lixxon Studio, for readers in the US, UK, Canada, Australia, Ireland, New Zealand and Singapore.",
    "Warm and plain. No hype. No dashes of any kind. Never name a country or city. Prices, if any, in US dollars only.",
    "Use only the product names you are given, exactly as written. Never invent a product, a guide, a bundle or a kit.",
    "Never say a product cures, heals or treats anything. Never say a doctor or dermatologist recommends it. Never tell a personal story or say you tested anything.",
    "Reply with JSON only, in this shape: {\"instagram\": \"...\", \"tiktok\": \"...\", \"facebook\": \"...\", \"pinterest\": {\"title\": \"...\", \"description\": \"...\"}}.",
    `Each caption is at most ${CAPTION_LIMIT} characters. The pin title is at most ${PIN_TITLE_LIMIT} characters. The pin description is at most ${PIN_DESCRIPTION_LIMIT} characters.`,
    "The four texts must each be different from the others. Feature the digital product first when one is given.",
  ].join("\n");
  const prompt = [
    `Article title: ${articleTitle}`,
    names.length > 0 ? `Products you may name:\n${names.join("\n")}` : "No product is on this article. Write about the article only.",
  ].join("\n\n");
  return { system, prompt };
}

/** Reads the reply as the four texts. Fenced JSON is accepted. Anything else is null, never guessed at. */
export function parseCopyReply(text: string): PackCopy | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pin = record.pinterest as Record<string, unknown> | undefined;
  const instagram = record.instagram;
  const tiktok = record.tiktok;
  const facebook = record.facebook;
  if (typeof instagram !== "string" || typeof tiktok !== "string" || typeof facebook !== "string") return null;
  if (!pin || typeof pin !== "object" || typeof pin.title !== "string" || typeof pin.description !== "string") return null;
  return {
    instagram: instagram.trim(),
    tiktok: tiktok.trim(),
    facebook: facebook.trim(),
    pinterest: { title: pin.title.trim(), description: pin.description.trim() },
  };
}

/** Lower-case letters and digits only, so "Same text!" and "same text" compare equal. */
export function sameTextKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Each product-looking name in the copy must match a shop product (either way round), or it is invented. */
function inventedName(text: string, shop: ShopProduct[]): string | null {
  for (const match of text.matchAll(PRODUCT_LIKE)) {
    const mention = match[1].toLowerCase();
    const known = shop.some((product) => {
      const name = product.name.toLowerCase();
      return name.includes(mention) || mention.includes(name);
    });
    if (!known) return match[1];
  }
  return null;
}

/** The Auditor. Allows the copy only when every channel passes. Names the channels that failed, in plain words. */
export function auditCopy(copy: PackCopy, shop: ShopProduct[]): CopyVerdict {
  const texts: { channel: PackChannel; label: string; text: string; limit: number }[] = [
    { channel: "instagram", label: "Instagram caption", text: copy.instagram, limit: CAPTION_LIMIT },
    { channel: "tiktok", label: "TikTok caption", text: copy.tiktok, limit: CAPTION_LIMIT },
    { channel: "facebook", label: "Facebook caption", text: copy.facebook, limit: CAPTION_LIMIT },
    { channel: "pinterest", label: "Pinterest title", text: copy.pinterest.title, limit: PIN_TITLE_LIMIT },
  ];
  const problems = new Map<PackChannel, string>();
  const block = (channel: PackChannel, reason: string) => {
    if (!problems.has(channel)) problems.set(channel, reason);
  };

  for (const item of texts) {
    if (!item.text.trim()) block(item.channel, `${item.label} is empty.`);
    else if (item.text.length > item.limit) block(item.channel, `${item.label} is too long. Keep it under ${item.limit} characters.`);
    else if (copyProblem(item.text)) block(item.channel, `${item.label} has a dash, a country name, or non-US money. Remove it.`);
    else if (MEDICAL_PROMISE.test(item.text)) block(item.channel, `${item.label} makes a health promise. Say what the product is for, not what it cures.`);
    else if (PERSONAL_TEST_CLAIM.test(item.text) || MARKUP.test(item.text)) block(item.channel, `${item.label} claims a personal test or has markup. Remove it.`);
    else {
      const invented = inventedName(item.text, shop);
      if (invented) block(item.channel, `${item.label} names "${invented}", which is not a shop product. Use only shop product names.`);
    }
  }
  const description = copy.pinterest.description;
  if (!description.trim()) block("pinterest", "Pinterest description is empty.");
  else if (description.length > PIN_DESCRIPTION_LIMIT) block("pinterest", `Pinterest description is too long. Keep it under ${PIN_DESCRIPTION_LIMIT} characters.`);
  else if (copyProblem(description)) block("pinterest", "Pinterest description has a dash, a country name, or non-US money. Remove it.");
  else if (MEDICAL_PROMISE.test(description) || PERSONAL_TEST_CLAIM.test(description) || MARKUP.test(description)) block("pinterest", "Pinterest description makes a health promise, claims a personal test, or has markup. Remove it.");
  else {
    const invented = inventedName(description, shop);
    if (invented) block("pinterest", `Pinterest description names "${invented}", which is not a shop product.`);
  }

  // The four texts must be pairwise different. The later channel in the list is the one blocked.
  const seen = new Map<string, string>();
  const all: { channel: PackChannel; label: string; text: string }[] = [
    ...texts.map((item) => ({ channel: item.channel, label: item.label, text: item.text })),
    { channel: "pinterest", label: "Pinterest description", text: description },
  ];
  for (const item of all) {
    const key = sameTextKey(item.text);
    if (!key) continue;
    const earlier = seen.get(key);
    if (earlier) block(item.channel, `${item.label} is the same text as ${earlier}. Write each one differently.`);
    else seen.set(key, item.label);
  }

  const blockedChannels = PACK_CHANNELS.filter((channel) => problems.has(channel));
  if (blockedChannels.length === 0) return { verdict: "allow", fix: "The Auditor allowed this copy.", blockedChannels: [] };
  return { verdict: "block", fix: blockedChannels.map((channel) => problems.get(channel)!).join(" "), blockedChannels };
}

/** One pack's copy: prompt, one thinking call, parse, then the Auditor. No key means no copy at all. */
export async function planPackCopy(
  article: { title: string },
  products: ShopProduct[],
  think: (request: { mind: string; system: string; prompt: string }) => Promise<MindThinkResult>,
): Promise<CopyPlan> {
  const { system, prompt } = buildCopyPrompt(article.title, products);
  const result = await think({ mind: "executioner", system, prompt });
  if (!result.ok) {
    if (result.reason === "no_key") return { status: "cannot_think", detail: NO_KEY_COPY_DETAIL, copy: null, verdict: null };
    return { status: "failed", detail: "The copy could not be written just now. Nothing was saved.", copy: null, verdict: null };
  }
  const copy = parseCopyReply(result.text);
  if (!copy) return { status: "failed", detail: "The copy answer was not usable. Nothing was saved.", copy: null, verdict: null };
  const verdict = auditCopy(copy, products);
  if (verdict.verdict === "block") return { status: "blocked", detail: verdict.fix, copy, verdict };
  return { status: "planned", detail: verdict.fix, copy, verdict };
}

/**
 * The window a posting time belongs to: the one whose UTC hour it is within half an hour of (a time from :30 counts for the next hour).
 * Null for a time that is not a real date, or that is not near any window.
 */
export function windowForTime(atUtc: string): TimeWindow | null {
  const at = new Date(atUtc);
  if (Number.isNaN(at.getTime())) return null;
  const hour = (at.getUTCHours() + (at.getUTCMinutes() >= 30 ? 1 : 0)) % 24;
  return TIME_WINDOWS.find((window) => window.utcHour === hour) ?? null;
}

export interface WindowLearning {
  /** True only when enough measured posts were read. */
  learned: boolean;
  /** Measured posts that landed in a window that reaches a top country. */
  measured: number;
  /** Window ids, best first. Empty when nothing was learned. */
  ranked: string[];
  /** One plain sentence for the owner's log. */
  note: string;
}

/**
 * Ranks the windows by measured successful posts (the owner's "I posted this" and door sends that really went out).
 * Thin data, or a failed read, keeps the current windows, and the note says so. Pure: the times come in already read.
 */
export function learnWindows(successTimesUtc: readonly string[], readOk: boolean): WindowLearning {
  if (!readOk) {
    return { learned: false, measured: 0, ranked: [], note: "The measured posts could not be read. Keeping the current posting windows." };
  }
  const eligible = TIME_WINDOWS.filter((window) => window.countries.some((country) => TOP_COUNTRIES.includes(country)));
  const counts = new Map<string, number>(eligible.map((window) => [window.id, 0]));
  let measured = 0;
  for (const at of successTimesUtc) {
    const window = windowForTime(at);
    if (!window || !counts.has(window.id)) continue;
    counts.set(window.id, (counts.get(window.id) ?? 0) + 1);
    measured += 1;
  }
  if (measured < LEARN_MIN_POSTS) {
    const noun = measured === 1 ? "post" : "posts";
    return {
      learned: false,
      measured,
      ranked: [],
      note: `Only ${measured} measured ${noun} so far, and ${LEARN_MIN_POSTS} are needed. Keeping the current posting windows.`,
    };
  }
  const ranked = eligible.map((window) => window.id).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  const top = eligible.find((window) => window.id === ranked[0]);
  return {
    learned: true,
    measured,
    ranked,
    note: `Ranked ${measured} measured posts. Best window so far: ${top ? top.label : "none"}.`,
  };
}
