// The rules for posting an article to a free door: which doors are open, which article goes, and the exact text.
// Pure logic, no network, no database. The day run's door step (runDoors.ts) uses these.
// Reader-facing text only: no dash, no country name, no non-US money (copyProblem in packRules.ts).

import { copyProblem } from "./packRules.ts";
import type { DoorId } from "./doorRegistry.ts";

/** Doors that can post in this build. The others are listed honestly as "not built yet". */
export const OPEN_DOORS: readonly DoorId[] = ["telegram", "discord"];

/** Only articles published this recently are posted. Old articles are never sent to a door. */
export const DOOR_WINDOW_DAYS = 7;
/** One post per open door per local day. */
export const DOOR_DAILY_LIMIT = 1;
/** Plain, well under any door's limit. Titles are clipped to fit. */
export const DOOR_TEXT_MAX = 1000;
const TITLE_MAX = 200;

export interface DoorArticle {
  id: string;
  title: string;
  slug: string | null;
  publishedAt: string | null;
}

export type DoorPick =
  | { ok: true; article: DoorArticle; articleUrl: string; text: string }
  | { ok: false; reason: "nothing_new" | "copy_not_clean" };

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isOpenDoor(value: unknown): value is DoorId {
  return typeof value === "string" && (OPEN_DOORS as readonly string[]).includes(value);
}

/** The article's public address. Only a clean slug is used. */
export function doorArticleUrl(slug: string, siteOrigin: string | null): string {
  const path = `/blog/${slug}`;
  return siteOrigin ? `${siteOrigin.replace(/\/+$/, "")}${path}` : path;
}

/** The post text: one plain line and the link. Clipped so it stays well under any door's limit. */
export function doorText(title: string, articleUrl: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  const clipped = flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
  const text = `New on the blog: ${clipped}\n${articleUrl}`;
  return text.length > DOOR_TEXT_MAX ? text.slice(0, DOOR_TEXT_MAX) : text;
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
}): DoorPick {
  const since = input.nowMs - DOOR_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const fresh = input.articles
    .filter((article) => article.slug && SAFE_SLUG.test(article.slug))
    .filter((article) => article.publishedAt !== null && Date.parse(article.publishedAt) >= since && Date.parse(article.publishedAt) <= input.nowMs)
    .filter((article) => !input.postedIds.has(article.id))
    .sort((a, b) => Date.parse(b.publishedAt as string) - Date.parse(a.publishedAt as string));
  const article = fresh[0];
  if (!article || !article.slug) return { ok: false, reason: "nothing_new" };
  if (copyProblem(article.title)) return { ok: false, reason: "copy_not_clean" };
  const articleUrl = doorArticleUrl(article.slug, input.siteOrigin);
  return { ok: true, article, articleUrl, text: doorText(article.title, articleUrl) };
}

export { DOOR_IDS };
