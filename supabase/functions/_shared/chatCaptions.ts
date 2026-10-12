// Phase I slice 4: the four captions, drafted in the chat at any time.
//
// A draft in the chat is talk, not a change, so it works with Takeover on or off: nothing on the site moves, nothing
// is published, and nothing is saved until a pack is made. The four gated captions stay four: Instagram, TikTok and
// Facebook each get one caption, Pinterest gets a title and a description, and no two of the four are ever the same
// words. The same prompt and the same Auditor the day's packs use are used here, so a draft can never be looser than
// the pack it might become.
//
// The draft is saved into the chat. Today's pack step may use it, and that step runs only while Takeover is on, so a
// draft reaches a pack only when Takeover is on. Nothing here writes to a pack.
//
// Pure logic: no database, no Deno globals, so it runs under Vitest. The caller passes in the site read and the brain.

import { auditCopy, choosePackArticle, chooseProductsForCopy, planPackCopy, type PackCopy } from "./packCopy.ts";
import type { ShopProduct } from "./productPlacement.ts";
import type { MindThinkResult } from "./mindThink.ts";
import { sayKey } from "./mindMemory.ts";

export const DRAFT_LIMIT = 900;
export const NO_ARTICLE_DRAFT_LINE = "No article with a live product is ready to draft captions for yet.";
export const DRAFT_FAILED_LINE = "The captions could not be drafted just now. Nothing was saved.";
export const DRAFT_NOTE = "This is a draft in this chat only. Buddy never posts.";
export const DRAFT_SAVE_ON_LINE = "Takeover is on, so today's pack step may save these four. Nothing was posted for you.";
export const DRAFT_SAVE_OFF_LINE = "Takeover is off, so nothing was saved to a pack. The draft stays in this chat.";
export const DRAFT_SAVE_UNREADABLE_LINE = "I could not read Takeover just now, so nothing was saved to a pack.";
export const DRAFT_USED_DETAIL = "The captions the owner drafted in the chat were used.";

/** The write-ish words that ask for a draft. A check or a question about captions is not a draft. */
const DRAFT_WORDS = /\b(write|writing|draft|drafting|make|making|new|again|redo|preview|show|give|update)\b/i;
const CAPTION_WORD = /\bcaptions?\b/i;

/** True when this order asks for the four captions to be written. It is talk, so it needs no Takeover. */
export function captionAsk(instruction: string): boolean {
  return CAPTION_WORD.test(instruction) && DRAFT_WORDS.test(instruction);
}

/** The four texts, in the order the pack lists its channels. Pinterest is one text: its title, then its description. */
export function fourTexts(copy: PackCopy): [string, string, string, string] {
  const pin = [copy.pinterest.title.trim(), copy.pinterest.description.trim()].filter(Boolean).join(". ");
  return [copy.instagram.trim(), copy.tiktok.trim(), copy.facebook.trim(), pin];
}

/**
 * The four stay four: each one has words, and no two are the same. A draft that fails this is never shown as a
 * draft and is never saved. The reason is in plain words for the owner.
 */
export function fourStayFour(copy: PackCopy): { ok: boolean; reason: string } {
  const texts = fourTexts(copy);
  const labels = ["Instagram caption", "TikTok caption", "Facebook caption", "Pinterest pin"];
  for (let index = 0; index < texts.length; index += 1) {
    if (!texts[index]) return { ok: false, reason: `${labels[index]} came back empty.` };
  }
  const seen = new Map<string, string>();
  for (let index = 0; index < texts.length; index += 1) {
    const key = sayKey(texts[index]);
    const earlier = seen.get(key);
    if (earlier) return { ok: false, reason: `${labels[index]} is the same words as ${earlier}.` };
    seen.set(key, labels[index]);
  }
  return { ok: true, reason: "" };
}

function clip(value: string, limit: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** The line that says where the draft stands. Takeover on: the pack step may use it. Off: it stays in the chat. */
export function saveTellLine(takeover: boolean | null): string {
  if (takeover === true) return DRAFT_SAVE_ON_LINE;
  if (takeover === false) return DRAFT_SAVE_OFF_LINE;
  return DRAFT_SAVE_UNREADABLE_LINE;
}

/** The chat text for one draft: the article, the four texts, and the honest note about what was not done. */
export function draftLines(copy: PackCopy, articleTitle: string, takeover: boolean | null): string[] {
  const texts = fourTexts(copy);
  return [
    `Here are the four captions for "${clip(articleTitle, 120)}":`,
    `Instagram: ${texts[0]}`,
    `TikTok: ${texts[1]}`,
    `Facebook: ${texts[2]}`,
    `Pinterest: ${texts[3]}`,
    `${DRAFT_NOTE} ${saveTellLine(takeover)}`,
  ].map((line) => line.slice(0, DRAFT_LIMIT));
}

/** The article and the products a draft is written for. Already read by the caller. */
export interface CaptionSource {
  articleTitle: string;
  products: ShopProduct[];
}

/** One published article, as the caller read it. */
export interface CaptionArticle {
  id: string;
  title: string;
  slug: string | null;
}

/** Only a clean slug gets a public address, the same rule the packs use. */
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The article a draft is written for: the same choice the day's packs make (an article with a live product, digital
 * first, then most live products, then the newest). The products are the pack's own first three. Null when no article
 * has a live product and a clean address yet, and then Buddy says so instead of drafting.
 */
export function pickCaptionSource(
  articles: readonly CaptionArticle[],
  slots: ReadonlyArray<{ postId: string; productId: string }>,
  shop: readonly ShopProduct[],
): CaptionSource | null {
  const byId = new Map(shop.map((product) => [product.id, product]));
  const live = new Map<string, ShopProduct[]>();
  for (const slot of slots) {
    const product = byId.get(slot.productId);
    if (!product) continue;
    live.set(slot.postId, [...(live.get(slot.postId) ?? []), product]);
  }
  const pool = articles
    .filter((article) => Boolean(article.slug) && SAFE_SLUG.test(String(article.slug)) && (live.get(article.id)?.length ?? 0) > 0)
    .map((article) => ({
      id: article.id,
      title: article.title,
      liveProducts: (live.get(article.id) ?? []).map((product) => ({ id: product.id, isDigital: product.isDigital })),
    }));
  const picked = choosePackArticle(pool);
  if (!picked) return null;
  return { articleTitle: picked.title, products: chooseProductsForCopy(live.get(picked.id) ?? []) };
}

export type CaptionDraftResult =
  | { ok: true; articleTitle: string; copy: PackCopy; lines: string[] }
  | { ok: false; line: string };

/**
 * Drafts the four captions in the chat. The pack's own prompt writes them and the pack's own Auditor checks them
 * before they are shown. Nothing is saved anywhere but the chat.
 */
export async function draftCaptionsInChat(
  source: CaptionSource | null,
  think: (request: { mind: string; system: string; prompt: string }) => Promise<MindThinkResult>,
  takeover: boolean | null,
): Promise<CaptionDraftResult> {
  if (!source || !source.articleTitle.trim()) return { ok: false, line: NO_ARTICLE_DRAFT_LINE };
  const plan = await planPackCopy({ title: source.articleTitle }, source.products, think);
  if (plan.status === "cannot_think") return { ok: false, line: plan.detail };
  if (plan.status === "failed" || !plan.copy) return { ok: false, line: DRAFT_FAILED_LINE };
  const four = fourStayFour(plan.copy);
  if (!four.ok) return { ok: false, line: `The draft was not usable: ${four.reason} Nothing was saved.` };
  if (plan.status === "blocked") {
    return { ok: false, line: `The Auditor blocked this draft. ${plan.detail} Nothing was saved.` };
  }
  return { ok: true, articleTitle: source.articleTitle, copy: plan.copy, lines: draftLines(plan.copy, source.articleTitle, takeover) };
}

/** The chat message payload for a draft: the owner's day, the article, and the four texts. */
export function draftPayload(day: string, articleTitle: string, copy: PackCopy): Record<string, unknown> {
  return { kind: "caption_draft", day, article_title: articleTitle, copy };
}

/**
 * Reads a draft back from a chat message payload. A payload that is not one of Buddy's four-text drafts is refused
 * rather than guessed at, so a half-written row can never reach a pack.
 */
export function draftFromPayload(payload: unknown): { day: string; articleTitle: string; copy: PackCopy } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.kind !== "caption_draft") return null;
  const day = typeof record.day === "string" ? record.day.trim() : "";
  const articleTitle = typeof record.article_title === "string" ? record.article_title.trim() : "";
  if (!day || !articleTitle) return null;
  const raw = record.copy;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const copyRow = raw as Record<string, unknown>;
  const pin = copyRow.pinterest;
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) return null;
  const pinRow = pin as Record<string, unknown>;
  if (typeof copyRow.instagram !== "string" || typeof copyRow.tiktok !== "string" || typeof copyRow.facebook !== "string") return null;
  if (typeof pinRow.title !== "string" || typeof pinRow.description !== "string") return null;
  const copy: PackCopy = {
    instagram: copyRow.instagram,
    tiktok: copyRow.tiktok,
    facebook: copyRow.facebook,
    pinterest: { title: pinRow.title, description: pinRow.description },
  };
  if (!fourStayFour(copy).ok) return null;
  return { day, articleTitle, copy };
}

/** The draft's copy, when the draft was written for this article and the Auditor still allows it for these products. */
export function draftForArticle(
  draft: { articleTitle: string; copy: PackCopy } | null,
  articleTitle: string,
  products: ShopProduct[],
): { copy: PackCopy; verdict: ReturnType<typeof auditCopy> } | null {
  if (!draft) return null;
  if (sayKey(draft.articleTitle) !== sayKey(articleTitle)) return null;
  return { copy: draft.copy, verdict: auditCopy(draft.copy, products) };
}
