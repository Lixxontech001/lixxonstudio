// The day run's gated packs: one row per channel for one article, saved through the database's one pack door.
// Pure logic. The doors (Gemini, the picture check, the pack save, the log) come in through `ports`.
// Takeover off, or Kill on a mind this run needs: nothing is read, nothing is saved, nothing is fetched.
// A pack is ready only with a real MP4. No MP4 is made by this run yet, so every pack is honest "video not made yet".

import { PACK_CHANNELS, type PackChannel } from "./packRules.ts";
import { chooseProductsForCopy, choosePackArticle, planPackCopy, suggestedTimeFor, type CopyPlan, type PackArticle } from "./packCopy.ts";
import { planPackMedia, VIDEO_NOT_MADE_REASON } from "./packMedia.ts";
import { imageProblemNote, type ArticleImageCheck } from "./articleImage.ts";
import { blockedDetail } from "./runDay.ts";
import type { KillScope } from "./placementRun.ts";
import type { ShopProduct } from "./productPlacement.ts";
import type { MindThinkResult } from "./mindThink.ts";

export const PACKS_ALREADY_MADE_DETAIL = "Today's packs are already made.";
export const NO_PACK_ARTICLE_DETAIL = "No article with a live product and a web address is ready to pack yet.";
const REASON_LIMIT = 300;
const NOTE_LIMIT = 300;

/** One article the packs can be made for. Newest first. */
export interface PackSource {
  id: string;
  title: string;
  slug: string | null;
  coverImage: string | null;
  liveProductIds: string[];
}

export interface DayPacksInput {
  localDay: string;
  takeover: boolean;
  killScope: KillScope;
  articles: PackSource[];
  shop: ShopProduct[];
  /** The site's address, for article links and for site-path pictures. Null when not configured. */
  siteOrigin: string | null;
  /** True when this day already has packs. The run then does nothing, so it is safe to repeat. */
  alreadyMade: boolean;
  /** Learned window order from measured posts. Absent or not learned: the current windows are kept. */
  learning?: { learned: boolean; ranked: string[]; note: string } | null;
}

/** One pack row, as the database's pack door takes it. */
export interface PackRow {
  channel: PackChannel;
  localDay: string;
  postId: string;
  suggestedAtUtc: string;
  suggestedLabel: string;
  caption: string | null;
  pinTitle: string | null;
  pinDescription: string | null;
  articleUrl: string;
  imagePath: string | null;
  videoPath: null;
  productIds: string[];
  status: "ready" | "blocked";
  blockedReason: string | null;
  auditorVerdict: "allow" | "block";
  auditorNote: string | null;
}

export type SavePackResult = { ok: true } | { ok: false; reason: string };

export interface DayPacksPorts {
  think: (request: { mind: string; system: string; prompt: string }) => Promise<MindThinkResult>;
  checkImage: (cover: string | null, siteOrigin: string | null) => Promise<ArticleImageCheck>;
  savePack: (row: PackRow) => Promise<SavePackResult>;
  log: (entry: { mind: "executioner"; action: string; outcome: "done" | "blocked" | "failed"; detail: string }) => Promise<void>;
}

export type DayPacksStatus = "nothing_to_do" | "held" | "done" | "failed";

export interface DayPacksResult {
  status: DayPacksStatus;
  detail: string;
  saved: number;
  postId: string | null;
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** The article's public address on the site. Only a clean slug is used. */
export function articleAddress(slug: string, siteOrigin: string | null): string {
  const path = `/blog/${slug}`;
  return siteOrigin ? `${siteOrigin.replace(/\/+$/, "")}${path}` : path;
}

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function textFor(channel: PackChannel, copy: NonNullable<CopyPlan["copy"]>): { caption: string | null; title: string | null; description: string | null } {
  if (channel === "pinterest") return { caption: null, title: copy.pinterest.title, description: copy.pinterest.description };
  return { caption: copy[channel], title: null, description: null };
}

function saveReason(reason: string): string {
  if (reason === "takeover_off") return "Takeover is off. The rest of the packs were not saved.";
  if (reason === "killed") return "A Kill switch is on. The rest of the packs were not saved.";
  return "A pack could not be saved, so the run stopped.";
}

/** Makes today's packs for one article. Saves one row per channel, through the pack door only. */
export async function runDayPacks(input: DayPacksInput, ports: DayPacksPorts): Promise<DayPacksResult> {
  const gate = blockedDetail(input.takeover, input.killScope);
  if (gate) return { status: "held", detail: gate, saved: 0, postId: null };
  if (input.alreadyMade) return { status: "nothing_to_do", detail: PACKS_ALREADY_MADE_DETAIL, saved: 0, postId: null };

  const shopById = new Map(input.shop.map((product) => [product.id, product]));
  const liveShop = (source: PackSource): ShopProduct[] =>
    source.liveProductIds.map((id) => shopById.get(id)).filter((product): product is ShopProduct => Boolean(product));
  const eligible = input.articles.filter((source) => source.slug && SAFE_SLUG.test(source.slug) && liveShop(source).length > 0);
  const pool: PackArticle[] = eligible.map((source) => ({
    id: source.id,
    title: source.title,
    liveProducts: liveShop(source).map((product) => ({ id: product.id, isDigital: product.isDigital })),
  }));
  const picked = choosePackArticle(pool);
  const source = picked ? eligible.find((item) => item.id === picked.id) : undefined;
  if (!source || !source.slug) return { status: "nothing_to_do", detail: NO_PACK_ARTICLE_DETAIL, saved: 0, postId: null };

  const products = chooseProductsForCopy(liveShop(source));
  const plan = await planPackCopy({ title: source.title }, products, ports.think);
  if (plan.status === "cannot_think") return { status: "held", detail: plan.detail, saved: 0, postId: source.id };
  if (plan.status === "failed" || !plan.copy || !plan.verdict) return { status: "failed", detail: plan.detail, saved: 0, postId: source.id };

  const image = await ports.checkImage(source.coverImage, input.siteOrigin);
  const imageNote = image.ok ? "The article picture was checked." : imageProblemNote(image.reason);
  const link = articleAddress(source.slug, input.siteOrigin);
  const copy = plan.copy;
  const verdict = plan.verdict;

  let saved = 0;
  const rows: PackRow[] = [];
  for (const channel of PACK_CHANNELS) {
    const time = suggestedTimeFor(channel, input.localDay, undefined, input.learning?.learned ? input.learning.ranked : []);
    if (!time) return { status: "failed", detail: "The day is not valid. Nothing was saved.", saved, postId: source.id };
    const auditorBlocked = verdict.blockedChannels.includes(channel);
    const text = textFor(channel, copy);
    const media = planPackMedia({ coverImage: source.coverImage, copyText: text.caption ?? text.title ?? "", mp4Path: null });
    const blockedReason = auditorBlocked
      ? clip(`The Auditor blocked this copy. ${verdict.fix}`, REASON_LIMIT)
      : media.status === "ready"
        ? null
        : media.reason ?? VIDEO_NOT_MADE_REASON;
    const status: "ready" | "blocked" = auditorBlocked || media.status !== "ready" ? "blocked" : "ready";
    const row: PackRow = {
      channel,
      localDay: input.localDay,
      postId: source.id,
      suggestedAtUtc: time.atUtc,
      suggestedLabel: time.label,
      // Copy the Auditor blocked is never stored. Only the reason is.
      caption: auditorBlocked ? null : text.caption,
      pinTitle: auditorBlocked ? null : text.title,
      pinDescription: auditorBlocked ? null : text.description,
      articleUrl: link,
      imagePath: image.ok ? image.url : null,
      videoPath: null,
      productIds: products.map((product) => product.id),
      status,
      blockedReason: status === "blocked" ? blockedReason : null,
      auditorVerdict: auditorBlocked ? "block" : "allow",
      auditorNote: clip(imageNote, NOTE_LIMIT),
    };
    const result = await ports.savePack(row);
    if (!result.ok) {
      await ports.log({ mind: "executioner", action: "Made today's packs", outcome: "failed", detail: saveReason(result.reason) });
      return { status: "held", detail: `Saved ${saved} of ${PACK_CHANNELS.length} packs. ${saveReason(result.reason)}`, saved, postId: source.id };
    }
    saved += 1;
    rows.push(row);
  }

  const ready = rows.filter((row) => row.status === "ready").length;
  const reasons = [...new Set(rows.map((row) => row.blockedReason).filter((reason): reason is string => Boolean(reason)))];
  const blockedText = rows.length - ready > 0 ? ` Blocked: ${reasons.join("; ")}.` : "";
  const learnText = input.learning ? ` ${input.learning.note}` : "";
  const detail = clip(`Made today's packs for "${source.title}": ${saved} saved, ${ready} ready to post by hand.${blockedText}${learnText}`, 500);
  await ports.log({ mind: "executioner", action: "Made today's packs", outcome: "done", detail });
  return { status: "done", detail, saved, postId: source.id };
}
