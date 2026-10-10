// The daily pack's picture and video plan. Pure logic: it decides what a pack may use and whether it is ready.
// It never renders anything (scripts/pack-video.mjs does that, on a runner), and it never invents an address.
// Still images: only the article's own cover image. Video: vertical 1080 x 1920, short burned-in captions, no
// watermark, no country names. A pack has no video until a real MP4 exists, so it is blocked with "video not made yet".

import { copyProblem } from "./packRules.ts";

export const VIDEO_NOT_MADE_REASON = "video not made yet";
export const NO_ARTICLE_IMAGE_REASON = "No article image yet.";
export const COPY_NOT_USABLE_REASON = "The caption has text that cannot be used on video.";

export const CAPTION_LINE_CHARS = 26;
export const CAPTION_CHUNK_CHARS = 60;
export const CAPTION_MAX_CHUNKS = 3;
const COVER_URL_MAX = 500;

export type ImageChoice = { ok: true; path: string } | { ok: false; reason: "no_article_image" | "image_not_usable" };

/**
 * The article's own cover image, as stored. Only an https address or a site path (starting with a single slash) is
 * accepted. Anything else is refused, and nothing is made up in its place.
 */
export function articleImageFor(coverImage: string | null | undefined): ImageChoice {
  if (coverImage === null || coverImage === undefined || !coverImage.trim()) return { ok: false, reason: "no_article_image" };
  const value = coverImage.trim();
  if (value.length > COVER_URL_MAX || /\s/.test(value)) return { ok: false, reason: "image_not_usable" };
  if (/^https:\/\/[^/]+\S*$/i.test(value)) return { ok: true, path: value };
  if (value.startsWith("/") && !value.startsWith("//")) return { ok: true, path: value };
  return { ok: false, reason: "image_not_usable" };
}

/** Cuts text into pieces of at most `max` characters, at word boundaries. A single long word is cut hard. */
function cutWords(text: string, max: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const raw of text.split(" ")) {
    let word = raw;
    while (word.length > max) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      pieces.push(word.slice(0, max));
      word = word.slice(max);
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > max) {
      pieces.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) pieces.push(current);
  return pieces.filter((piece) => piece.trim().length > 0);
}

/** Wraps one piece into lines of at most `width` characters, joined with line breaks. */
function wrapLines(text: string, width: number): string {
  return cutWords(text, width).join("\n");
}

/**
 * Up to three short caption chunks from the caption text, one on screen at a time. Each chunk has at most 60
 * characters across its lines, and no line is longer than 26. Empty text gives no chunks.
 */
export function captionChunks(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  const sentences = flat.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    for (const piece of cutWords(sentence, CAPTION_CHUNK_CHARS)) {
      if (chunks.length >= CAPTION_MAX_CHUNKS) return chunks;
      chunks.push(wrapLines(piece, CAPTION_LINE_CHARS));
    }
  }
  return chunks;
}

/** The reason a pack has no video, or null when it has one. Only a real MP4 path counts. */
export function videoBlockReason(mp4Path: string | null | undefined): string | null {
  return mp4Path && mp4Path.trim() ? null : VIDEO_NOT_MADE_REASON;
}

export interface PackMediaPlan {
  status: "ready" | "blocked";
  /** The plain reason for the owner, or null when ready. */
  reason: string | null;
  imagePath: string | null;
  chunks: string[];
}

/** What the pack may use. Blocked on the first thing missing: the image, then usable copy, then the video. */
export function planPackMedia(input: { coverImage: string | null | undefined; copyText: string; mp4Path: string | null | undefined }): PackMediaPlan {
  const image = articleImageFor(input.coverImage);
  if (!image.ok) return { status: "blocked", reason: NO_ARTICLE_IMAGE_REASON, imagePath: null, chunks: [] };
  const chunks = captionChunks(input.copyText);
  if (chunks.length === 0 || chunks.some((chunk) => copyProblem(chunk) !== null)) {
    return { status: "blocked", reason: COPY_NOT_USABLE_REASON, imagePath: image.path, chunks: [] };
  }
  const videoBlock = videoBlockReason(input.mp4Path);
  if (videoBlock) return { status: "blocked", reason: videoBlock, imagePath: image.path, chunks };
  return { status: "ready", reason: null, imagePath: image.path, chunks };
}
