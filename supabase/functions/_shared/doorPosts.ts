// The rules for posting an article to a free door: which doors are open, which article goes, and the exact text.
// Pure logic, no network, no database. The day run's door step (runDoors.ts) uses these.
// Reader-facing text only: no dash, no country name, no non-US money (copyProblem in packRules.ts).

import { copyProblem } from "./packRules.ts";
import type { DoorId } from "./doorRegistry.ts";

/** Doors that can post in this build. The others are listed honestly as "not built yet". */
export const OPEN_DOORS: readonly DoorId[] = [
  "telegram", "discord", "bluesky", "mastodon", "tumblr", "blogger", "medium", "pixelfed", "wordpress_com", "youtube", "vimeo", "podcast",
];

/**
 * The kind of file a door needs from the article's pack or site. Checked before anything is reserved:
 * a missing file skips the door for the day with a plain reason, and no slot is used.
 * Pixelfed: the article's cover picture. YouTube and Vimeo: a real pack MP4. Podcast: the episode's audio file.
 */
export const DOOR_MEDIA: Readonly<Partial<Record<DoorId, "image" | "video" | "audio">>> = {
  pixelfed: "image",
  youtube: "video",
  vimeo: "video",
  podcast: "audio",
};

/** Doors that need the article's own cover picture. Their article is picked only from articles that have one. */
export const DOORS_NEED_PICTURE: readonly DoorId[] = ["pixelfed"];

/**
 * The most text each open door takes. Bluesky: 300 graphemes (counted here by code points, which is never fewer, so it is safe).
 * Mastodon: 500 characters by default (a link counts as 23 there; we count the whole link, which is never fewer).
 */
export const DOOR_TEXT_LIMIT: Readonly<Record<DoorId, number>> = {
  telegram: 1000,
  discord: 1000,
  bluesky: 300,
  mastodon: 500,
  tumblr: 1000,
  blogger: 1000,
  // Phase 6 doors. Their send steps are built in later slices, which confirm or change these limits.
  medium: 1000,
  youtube: 1000,
  pixelfed: 500,
  wordpress_com: 1000,
  podcast: 1000,
  vimeo: 1000,
};

/** Only articles published this recently are posted. Old articles are never sent to a door. */
export const DOOR_WINDOW_DAYS = 7;
/** One post per open door per local day. */
export const DOOR_DAILY_LIMIT = 1;
const TITLE_MAX = 200;
const PREFIX = "New on the blog: ";

export interface DoorArticle {
  id: string;
  title: string;
  slug: string | null;
  publishedAt: string | null;
  /** The article's own cover picture, as stored (a site path or an https address). Null when there is none. */
  coverImage?: string | null;
}

export type DoorPick =
  | { ok: true; article: DoorArticle; articleUrl: string; text: string }
  | { ok: false; reason: "nothing_new" | "copy_not_clean" | "too_long" };

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isOpenDoor(value: unknown): value is DoorId {
  return typeof value === "string" && (OPEN_DOORS as readonly string[]).includes(value);
}

/** The article's public address. Only a clean slug is used. */
export function doorArticleUrl(slug: string, siteOrigin: string | null): string {
  const path = `/blog/${slug}`;
  return siteOrigin ? `${siteOrigin.replace(/\/+$/, "")}${path}` : path;
}

/**
 * The post text: one plain line, then the link. The title is clipped so the whole text fits the door's limit.
 * Returns null when even the link does not fit.
 */
export function doorText(title: string, articleUrl: string, limit: number): string | null {
  const suffix = `\n${articleUrl}`;
  const room = limit - Array.from(PREFIX + suffix).length;
  if (room < 1) return null;
  const flat = title.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  const max = Math.min(TITLE_MAX, room);
  const clipped = chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : flat;
  return `${PREFIX}${clipped}${suffix}`;
}

/**
 * The newest published article, inside the window, that this door has not had yet.
 * `postedIds` holds every article id already given to this door (any status), so a failed post is not retried.
 */
export function pickDoorArticle(input: {
  articles: DoorArticle[];
  postedIds: ReadonlySet<string>;
  nowMs: number;
  siteOrigin: string | null;
  limit: number;
  /** When true, only an article with its own cover picture is picked (Pixelfed). */
  needPicture?: boolean;
}): DoorPick {
  const since = input.nowMs - DOOR_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const fresh = input.articles
    .filter((article) => article.slug && SAFE_SLUG.test(article.slug))
    .filter((article) => !input.needPicture || (typeof article.coverImage === "string" && article.coverImage.trim() !== ""))
    .filter((article) => article.publishedAt !== null && Date.parse(article.publishedAt) >= since && Date.parse(article.publishedAt) <= input.nowMs)
    .filter((article) => !input.postedIds.has(article.id))
    .sort((a, b) => Date.parse(b.publishedAt as string) - Date.parse(a.publishedAt as string));
  const article = fresh[0];
  if (!article || !article.slug) return { ok: false, reason: "nothing_new" };
  if (copyProblem(article.title)) return { ok: false, reason: "copy_not_clean" };
  const articleUrl = doorArticleUrl(article.slug, input.siteOrigin);
  const text = doorText(article.title, articleUrl, input.limit);
  if (text === null) return { ok: false, reason: "too_long" };
  return { ok: true, article, articleUrl, text };
}
