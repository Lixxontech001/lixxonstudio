// The podcast feed: one RSS file that Apple Podcasts and Spotify can read once the owner submits it.
// Pure: no network, no database. The feeds function reads the rows and passes them in.
// Only episodes with a real audio file are listed. An episode with no audio never gets an enclosure.
// The show needs a title, an author and a square cover picture before it is served.

export const PODCAST_COVER_MAX_BYTES = 510 * 1024;
/** Apple's top-level category for this show. The owner can change it in Apple Podcasts. */
export const PODCAST_CATEGORY = "Health & Fitness";
const PODCAST_ITEM_LIMIT = 300;
const AUDIO_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp3$/;

export interface PodcastShow {
  title: string;
  author: string;
  /** A secure address to a square picture, 1400 to 3000 pixels, under 510 KB. */
  coverUrl: string;
  siteUrl: string;
  feedUrl: string;
}

export interface PodcastEpisode {
  id: string;
  title: string;
  description: string;
  articleUrl: string;
  publishedAt: string;
  /** The public address of the audio file. Empty when there is none. */
  audioUrl: string;
  audioBytes: number;
  audioType: string;
}

/** XML text: the five special characters escaped. */
export function xmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function secureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && value.length <= 2048;
  } catch {
    return false;
  }
}

/**
 * True when the show has everything the feed needs: a title, an author, and a secure cover address.
 * The author is a public name, so an email address is refused: the owner's email never goes into the feed.
 */
export function podcastShowReady(show: { title: string; author: string; coverUrl: string }): boolean {
  return show.title.trim().length > 0 && show.title.length <= 128
    && show.author.trim().length > 0 && show.author.length <= 128
    && !show.author.includes("@") && !show.title.includes("@")
    && secureUrl(show.coverUrl);
}

/**
 * The public address of an episode's audio: the storage object in the public podcast bucket. Null for a name that is
 * not the expected form (an article id and .mp3), so no odd address is ever built.
 */
export function episodeAudioUrl(supabaseUrl: string, path: string): string | null {
  if (!AUDIO_PATH.test(path)) return null;
  const base = supabaseUrl.replace(/\/+$/, "");
  if (!secureUrl(base)) return null;
  return `${base}/storage/v1/object/public/podcast-audio/${encodeURIComponent(path)}`;
}

/** The RFC 2822 date RSS uses. */
function rssDate(iso: string): string | null {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time).toUTCString();
}

/** One item. Returns null for an episode that has no real audio file, so it is left out. */
function item(episode: PodcastEpisode): string | null {
  if (!secureUrl(episode.audioUrl) || !(episode.audioBytes > 0) || !secureUrl(episode.articleUrl)) return null;
  const pubDate = rssDate(episode.publishedAt);
  if (!pubDate) return null;
  return [
    "<item>",
    `<title>${xmlText(episode.title)}</title>`,
    `<link>${xmlText(episode.articleUrl)}</link>`,
    `<guid isPermaLink="false">lixxon-episode-${xmlText(episode.id)}</guid>`,
    `<pubDate>${pubDate}</pubDate>`,
    `<description>${xmlText(episode.description)}</description>`,
    `<enclosure url="${xmlText(episode.audioUrl)}" length="${Math.floor(episode.audioBytes)}" type="${xmlText(episode.audioType)}"/>`,
    "<itunes:explicit>false</itunes:explicit>",
    "</item>",
  ].join("");
}

/** The whole feed. Episodes without audio are dropped, and the feed still works with none. */
export function buildPodcastFeed(show: PodcastShow, episodes: readonly PodcastEpisode[]): string {
  const items = episodes.slice(0, PODCAST_ITEM_LIMIT).map(item).filter((value): value is string => value !== null).join("");
  const title = xmlText(show.title);
  const cover = xmlText(show.coverUrl);
  const site = xmlText(show.siteUrl);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${title}</title>`,
    `<link>${site}</link>`,
    `<atom:link href="${xmlText(show.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    "<description>Notes from the Lixxon Studio blog.</description>",
    "<language>en</language>",
    `<itunes:author>${xmlText(show.author)}</itunes:author>`,
    "<itunes:explicit>false</itunes:explicit>",
    `<itunes:image href="${cover}"/>`,
    `<itunes:category text="${xmlText(PODCAST_CATEGORY)}"/>`,
    `<image><url>${cover}</url><title>${title}</title><link>${site}</link></image>`,
    items,
    "</channel>",
    "</rss>",
  ].join("");
}
