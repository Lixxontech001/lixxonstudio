// The connection test for each free door: does the saved detail work with the door, right now?
// Every check is a read: a lookup, a sign-in, or a token exchange. None of them sends a message or posts.
// A result is one plain status from a fixed list. No value, token, or provider reply text leaves this file.
// $0: each check uses an official free route. Doors whose check is not built yet answer "not_built" and make no request.

import { DOORS, doorStatus, type DoorId } from "./doorRegistry.ts";
import {
  mastodonOrigin,
  normalizeBlueskyHandle,
  wordpressComSite,
  youtubeChannelCheck,
  oauthAuthorization,
  tumblrBlogName,
  validDiscordWebhook,
  withTimeout,
  readJson,
  type FetchLike,
} from "./doorAdapters.ts";

export type DoorTestStatus = "connected" | "invalid" | "not_connected" | "not_built" | "rate_limited" | "unavailable";

export const DOOR_TEST_MESSAGE: Readonly<Record<DoorTestStatus, string>> = {
  connected: "Connected. The door answered. Nothing was posted.",
  invalid: "The door did not accept these details.",
  not_connected: "Save every field for this door first.",
  not_built: "The test for this door is not built yet.",
  rate_limited: "The door is limiting checks. Try later.",
  unavailable: "The door did not answer. Try later.",
};

export function doorTestMessage(status: DoorTestStatus): string {
  return DOOR_TEST_MESSAGE[status];
}

/** The status for a read that the door refused. Limits and provider trouble are kept apart from a wrong detail. */
function refusedStatus(status: number): DoorTestStatus {
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "invalid";
  return "unavailable";
}

type Values = Readonly<Record<string, string>>;

async function telegramTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(values.telegram_bot_token)}/getChat?chat_id=${encodeURIComponent(values.telegram_chat_id)}`;
  const response = await withTimeout(fetchImpl, url, { method: "GET" });
  if ("failed" in response) return "unavailable";
  const body = (await readJson(response)) as { ok?: unknown } | null;
  if (response.ok && body?.ok === true) return "connected";
  return response.ok ? "invalid" : refusedStatus(response.status);
}

async function discordTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  const webhook = values.discord_webhook_url;
  if (!validDiscordWebhook(webhook)) return "invalid";
  // The webhook's own address, read without the wait option. Reading it does not send anything.
  const url = new URL(webhook);
  const response = await withTimeout(fetchImpl, `${url.origin}${url.pathname}`, { method: "GET" });
  if ("failed" in response) return "unavailable";
  return response.ok ? "connected" : refusedStatus(response.status);
}

async function blueskyTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  const handle = normalizeBlueskyHandle(values.bluesky_handle);
  if (!handle) return "invalid";
  // Signing in only. The session is not used to write anything.
  const response = await withTimeout(fetchImpl, "https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: values.bluesky_app_password }),
  });
  if ("failed" in response) return "unavailable";
  const body = (await readJson(response)) as { accessJwt?: unknown } | null;
  if (response.ok && typeof body?.accessJwt === "string") return "connected";
  return response.ok ? "invalid" : refusedStatus(response.status);
}

async function mastodonTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  const origin = mastodonOrigin(values.mastodon_instance_url);
  if (!origin) return "invalid";
  const response = await withTimeout(fetchImpl, `${origin}/api/v1/accounts/verify_credentials`, {
    method: "GET",
    headers: { Authorization: `Bearer ${values.mastodon_access_token}` },
  });
  if ("failed" in response) return "unavailable";
  return response.ok ? "connected" : refusedStatus(response.status);
}

async function tumblrTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  const blog = tumblrBlogName(values.tumblr_blog_name);
  if (!blog) return "invalid";
  const url = `https://api.tumblr.com/v2/blog/${blog}.tumblr.com/info`;
  const authorization = await oauthAuthorization({
    method: "GET",
    url,
    consumerKey: values.tumblr_consumer_key,
    consumerSecret: values.tumblr_consumer_secret,
    token: values.tumblr_access_token,
    tokenSecret: values.tumblr_token_secret,
  });
  const response = await withTimeout(fetchImpl, url, { method: "GET", headers: { Authorization: authorization } });
  if ("failed" in response) return "unavailable";
  return response.ok ? "connected" : refusedStatus(response.status);
}

async function bloggerTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  if (!/^\d{1,30}$/.test(values.blogger_blog_id)) return "invalid";
  const token = await withTimeout(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: values.blogger_client_id,
      client_secret: values.blogger_client_secret,
      refresh_token: values.blogger_refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if ("failed" in token) return "unavailable";
  const signedIn = (await readJson(token)) as { access_token?: unknown } | null;
  if (!token.ok || typeof signedIn?.access_token !== "string") return token.ok ? "invalid" : refusedStatus(token.status);

  // Reading the blog's own record. Nothing is posted.
  const response = await withTimeout(fetchImpl, `https://www.googleapis.com/blogger/v3/blogs/${values.blogger_blog_id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${signedIn.access_token}` },
  });
  if ("failed" in response) return "unavailable";
  return response.ok ? "connected" : refusedStatus(response.status);
}

// Doors without a check yet are simply absent from this list. They are reported as "not_built", never guessed at.
/** Medium: reads the token's own account. Nothing is posted. */
async function mediumTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  const response = await withTimeout(fetchImpl, "https://api.medium.com/v1/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${values.medium_integration_token}`, Accept: "application/json" },
  });
  if ("failed" in response) return "unavailable";
  if (!response.ok) return refusedStatus(response.status);
  const body = (await readJson(response)) as { data?: { id?: unknown } } | null;
  return typeof body?.data?.id === "string" ? "connected" : "invalid";
}

/** WordPress.com: reads the site's own record with the token. Nothing is posted. */
async function wordpressComTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  const site = wordpressComSite(values.wordpress_com_site);
  if (!site) return "invalid";
  const response = await withTimeout(fetchImpl, `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(site)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${values.wordpress_com_access_token}` },
  });
  if ("failed" in response) return "unavailable";
  return response.ok ? "connected" : refusedStatus(response.status);
}

/** Pixelfed: checks the account with the token, the same read Mastodon uses. Nothing is posted. */
async function pixelfedTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  const origin = mastodonOrigin(values.pixelfed_instance_url);
  if (!origin) return "invalid";
  const response = await withTimeout(fetchImpl, `${origin}/api/v1/accounts/verify_credentials`, {
    method: "GET",
    headers: { Authorization: `Bearer ${values.pixelfed_access_token}` },
  });
  if ("failed" in response) return "unavailable";
  return response.ok ? "connected" : refusedStatus(response.status);
}

/** Vimeo: reads the account the token belongs to. Nothing is uploaded. */
async function vimeoTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  const response = await withTimeout(fetchImpl, "https://api.vimeo.com/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${values.vimeo_access_token}`, Accept: "application/vnd.vimeo.*+json;version=3.4" },
  });
  if ("failed" in response) return "unavailable";
  return response.ok ? "connected" : refusedStatus(response.status);
}

/** YouTube: signs in and reads the channel. Nothing is uploaded. */
async function youtubeTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  return youtubeChannelCheck(
    { clientId: values.youtube_client_id, clientSecret: values.youtube_client_secret, refreshToken: values.youtube_refresh_token },
    fetchImpl,
  );
}

/**
 * Podcast: the cover picture is the only thing a read can check. It must be a secure link to a picture of at most
 * 510 KB. Its square size is not checked here. The owner checks that before submitting the feed.
 */
async function podcastTest(values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  let url: URL;
  try {
    url = new URL(values.podcast_cover_url);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "https:") return "invalid";
  const response = await withTimeout(fetchImpl, url.toString(), { method: "GET", headers: { Accept: "image/*" } });
  if ("failed" in response) return "unavailable";
  if (!response.ok) return refusedStatus(response.status);
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "image/jpeg" && type !== "image/png") return "invalid";
  const body = await response.arrayBuffer().catch(() => null);
  if (!body || body.byteLength === 0 || body.byteLength > 510 * 1024) return "invalid";
  return "connected";
}

const CHECKS: Partial<Record<DoorId, (values: Values, fetchImpl: FetchLike) => Promise<DoorTestStatus>>> = {
  youtube: youtubeTest,
  vimeo: vimeoTest,
  podcast: podcastTest,
  medium: mediumTest,
  wordpress_com: wordpressComTest,
  pixelfed: pixelfedTest,
  telegram: telegramTest,
  discord: discordTest,
  bluesky: blueskyTest,
  mastodon: mastodonTest,
  tumblr: tumblrTest,
  blogger: bloggerTest,
};

/**
 * Tests one door with its saved values (keyed by secret name). A door with any field missing is "not_connected"
 * and no request is made. Unexpected errors become "unavailable", so nothing about them leaks out.
 */
export async function testDoorConnection(door: DoorId, values: Values, fetchImpl: FetchLike): Promise<DoorTestStatus> {
  const check = CHECKS[door];
  if (!check) return "not_built";
  const saved = new Set(Object.keys(values).filter((name) => Boolean(values[name])));
  if (doorStatus(door, saved).state !== "connected") return "not_connected";
  // Every field the door needs must be in `values`, so the checks can read them directly.
  for (const field of DOORS[door].fields) {
    if (!values[field.secretName]) return "not_connected";
  }
  try {
    return await check(values, fetchImpl);
  } catch {
    return "unavailable";
  }
}
