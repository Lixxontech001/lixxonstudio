// The four RSS doors (Flipboard, Google News, Microsoft Start, SmartNews). They read the site's own RSS feed,
// /rss.xml, which already lists every published article. A door here pings a free WebSub hub so the hub fetches
// the feed again. Nothing is posted to them,
// and no secret is needed. The owner still adds the feed address in each service, by hand.
// Pure rules plus one ping. The fetch is passed in, so tests use a fake ping.

import { withTimeout, type DoorSendResult, type FetchLike } from "./doorAdapters.ts";
import type { DoorId } from "./doorRegistry.ts";

/** Google's free PubSubHubbub hub. The feed declares it, and the ping goes to it. */
export const WEBSUB_HUB = "https://pubsubhubbub.appspot.com/";

/** The four RSS doors, in the order they appear on Connections. */
export const RSS_DOORS: readonly DoorId[] = ["flipboard", "google_news", "microsoft_start", "smartnews"];

export function isRssDoor(door: string): boolean {
  return (RSS_DOORS as readonly string[]).includes(door);
}

/** The form body a WebSub publish ping sends. Only the feed address is in it. */
export function hubPingBody(feedUrl: string): string {
  return new URLSearchParams({ "hub.mode": "publish", "hub.url": feedUrl }).toString();
}

/** The word a sent door is logged with: "pinged" for the RSS doors, "posted" for the rest. */
export function sentVerb(door: string): "posted" | "pinged" {
  return isRssDoor(door) ? "pinged" : "posted";
}

/** The start of a sent door's log line: "RSS updated and pinged for Flipboard" for RSS, "Posted to X" for the rest. */
export function sentLead(door: string, label: string): string {
  return isRssDoor(door) ? `RSS updated and pinged for ${label}` : `Posted to ${label}`;
}

/** "Nothing was pinged." for RSS doors, "Nothing was posted." for the rest. */
export function notSentNote(door: string): string {
  return `Nothing was ${sentVerb(door)}.`;
}

/** "Nothing new was pinged." for RSS doors, "Nothing new was posted." for the rest. */
export function nothingNewNote(door: string): string {
  return `Nothing new was ${sentVerb(door)}.`;
}

/**
 * Sends one publish ping for the site's feed. A 2xx from the hub counts as sent. Anything else is a plain reason,
 * never the hub's raw text and never an address with a secret in it.
 */
export async function sendRssPing(feedUrl: string, fetchImpl: FetchLike, hubUrl: string = WEBSUB_HUB): Promise<DoorSendResult> {
  if (!/^https:\/\/[^\s/]+\/rss\.xml$/.test(feedUrl)) {
    return { ok: false, reason: "The site address is not set, so the RSS feed cannot be pinged." };
  }
  const response = await withTimeout(fetchImpl, hubUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: hubPingBody(feedUrl),
  });
  if ("failed" in response) return { ok: false, reason: "The RSS hub could not be reached." };
  if (response.status >= 200 && response.status < 300) return { ok: true, externalRef: null };
  return { ok: false, reason: `The RSS hub did not take the ping (status ${response.status}).` };
}
