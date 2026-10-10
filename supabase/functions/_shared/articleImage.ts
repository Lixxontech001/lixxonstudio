// The article's own picture, checked before a pack uses it. Pure apart from the one fetch it is given.
// Only the article's own cover image is used. Nothing is bought, looked up elsewhere, or invented.
// A picture that cannot be fetched, is not an image, or is too big is refused. The pack then stays honest.

import { articleImageFor } from "./packMedia.ts";

export const IMAGE_FETCH_TIMEOUT_MS = 8_000;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type ArticleImageReason = "no_image" | "not_usable" | "not_fetchable" | "not_an_image" | "too_large" | "timeout";

export type ArticleImageCheck =
  | { ok: true; url: string; contentType: string; bytes: number }
  | { ok: false; reason: ArticleImageReason };

export type ImageFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: "follow" }) => Promise<Response>;

/**
 * The full address of the cover image: an https address as stored, or a site path joined to the site's address.
 * Null when the picture cannot be reached by address (a site path with no site address, or a refused value).
 */
export function absoluteImageUrl(cover: string | null | undefined, siteOrigin: string | null): string | null {
  const choice = articleImageFor(cover);
  if (!choice.ok) return null;
  if (choice.path.startsWith("/")) {
    if (!siteOrigin) return null;
    try {
      return new URL(choice.path, siteOrigin).toString();
    } catch {
      return null;
    }
  }
  return choice.path;
}

export type ArticleImageLoad =
  | { ok: true; url: string; contentType: string; bytes: number; data: ArrayBuffer }
  | { ok: false; reason: ArticleImageReason };

/**
 * Fetches the cover image once and checks it: a success status, an image type, and a size under the limit.
 * Returns the picture's bytes too, for a door that uploads the picture itself (Pixelfed).
 */
export async function fetchArticleImage(
  cover: string | null | undefined,
  siteOrigin: string | null,
  fetchImpl: ImageFetch = (url, init) => fetch(url, init),
): Promise<ArticleImageLoad> {
  if (cover === null || cover === undefined || !cover.trim()) return { ok: false, reason: "no_image" };
  const url = absoluteImageUrl(cover, siteOrigin);
  if (!url) return { ok: false, reason: "not_usable" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { headers: { Accept: "image/*" }, signal: controller.signal, redirect: "follow" });
    if (!response.ok) return { ok: false, reason: "not_fetchable" };
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return { ok: false, reason: "not_an_image" };
    const declared = Number(response.headers.get("content-length") || "0");
    if (declared > IMAGE_MAX_BYTES) return { ok: false, reason: "too_large" };
    const body = await response.arrayBuffer();
    if (body.byteLength === 0) return { ok: false, reason: "not_fetchable" };
    if (body.byteLength > IMAGE_MAX_BYTES) return { ok: false, reason: "too_large" };
    return { ok: true, url, contentType, bytes: body.byteLength, data: body };
  } catch (error) {
    const aborted = (error as { name?: string })?.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "not_fetchable" };
  } finally {
    clearTimeout(timer);
  }
}

/** The same check as fetchArticleImage, without the bytes. Used by the packs. */
export async function checkArticleImage(
  cover: string | null | undefined,
  siteOrigin: string | null,
  fetchImpl: ImageFetch = (url, init) => fetch(url, init),
): Promise<ArticleImageCheck> {
  const loaded = await fetchArticleImage(cover, siteOrigin, fetchImpl);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  return { ok: true, url: loaded.url, contentType: loaded.contentType, bytes: loaded.bytes };
}

/** Plain words for the owner, used in the pack's note. Never a raw address. */
export function imageProblemNote(reason: ArticleImageReason): string {
  switch (reason) {
    case "no_image":
      return "The article has no picture yet.";
    case "not_usable":
      return "The article picture address is not one the pack can use.";
    case "not_an_image":
      return "The article picture address did not point to a picture.";
    case "too_large":
      return "The article picture is too large to use.";
    case "timeout":
      return "The article picture took too long to fetch.";
    default:
      return "The article picture could not be fetched.";
  }
}
