// The HTTP senders for the free doors: Telegram (bot API), Discord (webhook), Bluesky (AT Protocol, app password),
// Mastodon (REST, access token), Tumblr (OAuth 1.0a, signed), Blogger (Google OAuth refresh token), and from Phase 6
// Medium (integration token), WordPress.com (REST, access token) and Pixelfed (REST, picture upload first).
// Each returns a plain result. Reasons never include a token, a password, a webhook address, or the provider's raw text.
// $0: all four are free to use through their official routes.

export const DOOR_TIMEOUT_MS = 8000;

/** `note` is a plain line the owner should see, for example a YouTube upload that was kept private. */
export type DoorSendResult = { ok: true; externalRef: string | null; note?: string } | { ok: false; reason: string; closed?: true };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TelegramValues {
  token: string;
  chatId: string;
}

export interface BlueskyValues {
  handle: string;
  appPassword: string;
}

export interface MastodonValues {
  instanceUrl: string;
  accessToken: string;
}

const TELEGRAM_HOST = "api.telegram.org";
const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);
const BLUESKY_HOST = "https://bsky.social";
const BLUESKY_HANDLE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const TUMBLR_BLOG_NAME = /^[a-z0-9-]{1,32}$/;

/** The handle as Bluesky takes it (no leading @, lower case), or null when it is not in the right form. */
export function normalizeBlueskyHandle(value: string): string | null {
  const handle = value.replace(/^@/, "").toLowerCase();
  return handle.length <= 253 && BLUESKY_HANDLE.test(handle) ? handle : null;
}

/** The Tumblr blog name without .tumblr.com, in lower case, or null when it is not in the right form. */
export function tumblrBlogName(value: string): string | null {
  const blog = value.trim().toLowerCase().replace(/\.tumblr\.com$/, "");
  return TUMBLR_BLOG_NAME.test(blog) ? blog : null;
}

/** Runs one request with a time limit. Maps network and timeout failures to plain reasons. */
export async function withTimeout(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response | { failed: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOOR_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    const aborted = (error as { name?: string })?.name === "AbortError";
    return { failed: aborted ? "The door did not answer in time." : "Could not reach the door." };
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Telegram: one message to one chat, through the bot. Returns the message id as the reference. */
export async function sendTelegram(values: TelegramValues, text: string, fetchImpl: FetchLike): Promise<DoorSendResult> {
  if (!values.token || !values.chatId) return { ok: false, reason: "Telegram is not connected yet." };
  const url = `https://${TELEGRAM_HOST}/bot${encodeURIComponent(values.token)}/sendMessage`;
  const response = await withTimeout(fetchImpl, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: values.chatId, text, disable_web_page_preview: false }),
  });
  if ("failed" in response) return { ok: false, reason: response.failed };
  const body = (await readJson(response)) as { ok?: unknown; result?: { message_id?: unknown } } | null;
  if (response.status === 401 || response.status === 404) {
    return { ok: false, reason: "Telegram did not accept the bot token or the chat." };
  }
  if (response.status === 429) return { ok: false, reason: "Telegram is limiting posts. Try later." };
  if (!response.ok || body?.ok !== true) return { ok: false, reason: "Telegram did not take the message." };
  const id = body.result?.message_id;
  return { ok: true, externalRef: typeof id === "number" || typeof id === "string" ? String(id).slice(0, 120) : null };
}

/** A Discord webhook address: https, a Discord host, and the webhook path. Anything else is refused before any request. */
export function validDiscordWebhook(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && DISCORD_HOSTS.has(url.hostname) && url.pathname.startsWith("/api/webhooks/");
  } catch {
    return false;
  }
}

/** Discord: one message through the channel webhook. wait=true returns the message id. */
export async function sendDiscord(webhookUrl: string, text: string, fetchImpl: FetchLike): Promise<DoorSendResult> {
  if (!webhookUrl) return { ok: false, reason: "Discord is not connected yet." };
  if (!validDiscordWebhook(webhookUrl)) return { ok: false, reason: "The Discord webhook address is not in the right form." };
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");
  const response = await withTimeout(fetchImpl, url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  if ("failed" in response) return { ok: false, reason: response.failed };
  if (response.status === 404) return { ok: false, reason: "Discord did not find that webhook." };
  if (response.status === 429) return { ok: false, reason: "Discord is limiting posts. Try later." };
  if (!response.ok) return { ok: false, reason: "Discord did not take the message." };
  const body = (await readJson(response)) as { id?: unknown } | null;
  return { ok: true, externalRef: typeof body?.id === "string" ? body.id.slice(0, 120) : null };
}

/** The UTF-8 byte offset of a substring, which is what Bluesky facets use. */
function byteOffset(text: string, index: number): number {
  return new TextEncoder().encode(text.slice(0, index)).length;
}

/** A link facet for the URL at the end of the text, so Bluesky shows it as a link. Empty when there is no such URL. */
export function blueskyLinkFacets(text: string): Array<Record<string, unknown>> {
  const match = /https:\/\/\S+$/.exec(text.trimEnd());
  if (!match || match.index === undefined) return [];
  const url = match[0];
  const start = byteOffset(text, match.index);
  return [
    {
      index: { byteStart: start, byteEnd: start + new TextEncoder().encode(url).length },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
    },
  ];
}

/** Bluesky: sign in with the handle and an app password, then write one post record. Returns the post address. */
export async function sendBluesky(values: BlueskyValues, text: string, fetchImpl: FetchLike): Promise<DoorSendResult> {
  if (!values.handle || !values.appPassword) return { ok: false, reason: "Bluesky is not connected yet." };
  const handle = normalizeBlueskyHandle(values.handle);
  if (!handle) return { ok: false, reason: "The Bluesky handle is not in the right form." };

  const session = await withTimeout(fetchImpl, `${BLUESKY_HOST}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: values.appPassword }),
  });
  if ("failed" in session) return { ok: false, reason: session.failed };
  if (session.status === 429) return { ok: false, reason: "Bluesky is limiting sign-ins. Try later." };
  const signedIn = (await readJson(session)) as { accessJwt?: unknown; did?: unknown } | null;
  if (!session.ok || typeof signedIn?.accessJwt !== "string" || typeof signedIn?.did !== "string") {
    return { ok: false, reason: "Bluesky did not accept the handle or the app password." };
  }

  const record = await withTimeout(fetchImpl, `${BLUESKY_HOST}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${signedIn.accessJwt}` },
    body: JSON.stringify({
      repo: signedIn.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        facets: blueskyLinkFacets(text),
      },
    }),
  });
  if ("failed" in record) return { ok: false, reason: record.failed };
  if (record.status === 429) return { ok: false, reason: "Bluesky is limiting posts. Try later." };
  if (record.status === 401 || record.status === 403) return { ok: false, reason: "Bluesky did not accept the session." };
  const created = (await readJson(record)) as { uri?: unknown } | null;
  if (!record.ok || typeof created?.uri !== "string") return { ok: false, reason: "Bluesky did not take the post." };
  return { ok: true, externalRef: created.uri.slice(0, 120) };
}

/** A Mastodon server address: https, a host, and nothing else (no path, no query, no user name). Returns the clean origin. */
export function mastodonOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    if ((url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Mastodon: one status through the account's access token. The Idempotency-Key stops a repeat of the same post. */
export async function sendMastodon(values: MastodonValues, text: string, idempotencyKey: string, fetchImpl: FetchLike): Promise<DoorSendResult> {
  if (!values.instanceUrl || !values.accessToken) return { ok: false, reason: "Mastodon is not connected yet." };
  const origin = mastodonOrigin(values.instanceUrl);
  if (!origin) return { ok: false, reason: "The Mastodon server address must start with https:// and have no path." };
  const response = await withTimeout(fetchImpl, `${origin}/api/v1/statuses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${values.accessToken}`,
      "Idempotency-Key": idempotencyKey.slice(0, 120),
    },
    body: JSON.stringify({ status: text }),
  });
  if ("failed" in response) return { ok: false, reason: response.failed };
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "Mastodon did not accept the access token." };
  if (response.status === 429) return { ok: false, reason: "Mastodon is limiting posts. Try later." };
  const body = (await readJson(response)) as { id?: unknown } | null;
  if (!response.ok || (typeof body?.id !== "string" && typeof body?.id !== "number")) {
    return { ok: false, reason: "Mastodon did not take the post." };
  }
  return { ok: true, externalRef: String(body.id).slice(0, 120) };
}

export interface TumblrValues {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  tokenSecret: string;
  blogName: string;
}

export interface BloggerValues {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  blogId: string;
}

const TUMBLR_HOST = "https://api.tumblr.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const BLOGGER_HOST = "https://www.googleapis.com/blogger/v3";
const BLOGGER_BLOG_ID = /^\d{1,30}$/;

/** Percent-encoding as OAuth 1.0a requires (RFC 3986: also encodes ! ' ( ) *). */
export function oauthEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface OAuthSigningInput {
  method: string;
  /** The address without the query string. */
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
  /** Query or form parameters that take part in the signature. A JSON body does not. */
  params?: Record<string, string>;
  nonce?: string;
  timestamp?: number;
}

/** The OAuth 1.0a Authorization header (HMAC-SHA1). Used by Tumblr. Exported so the signature can be checked against a known example. */
export async function oauthAuthorization(input: OAuthSigningInput): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: input.consumerKey,
    oauth_nonce: input.nonce ?? randomHex(16),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: input.token,
    oauth_version: "1.0",
  };
  const all: Record<string, string> = { ...(input.params ?? {}), ...oauth };
  const paramString = Object.keys(all)
    .sort()
    .map((key) => `${oauthEncode(key)}=${oauthEncode(all[key])}`)
    .join("&");
  const base = [input.method.toUpperCase(), oauthEncode(input.url), oauthEncode(paramString)].join("&");
  const key = `${oauthEncode(input.consumerSecret)}&${oauthEncode(input.tokenSecret)}`;
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(base));
  oauth.oauth_signature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `OAuth ${Object.keys(oauth).map((key) => `${key}="${oauthEncode(oauth[key])}"`).join(", ")}`;
}

/** Splits the door text into its first line and its last line, which is the article link. Null when the link is not https. */
export function splitLinkText(text: string): { head: string; url: string } | null {
  const cut = text.lastIndexOf("\n");
  if (cut < 0) return null;
  const head = text.slice(0, cut).trim();
  const url = text.slice(cut + 1).trim();
  if (!head || !url.startsWith("https://") || /\s/.test(url)) return null;
  return { head, url };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Tumblr: one published text post with the article link, through the signed API request. Returns the post id when it can be read. */
export async function sendTumblr(values: TumblrValues, text: string, fetchImpl: FetchLike): Promise<DoorSendResult> {
  if (!values.consumerKey || !values.consumerSecret || !values.accessToken || !values.tokenSecret || !values.blogName) {
    return { ok: false, reason: "Tumblr is not connected yet." };
  }
  const blog = tumblrBlogName(values.blogName);
  if (!blog) return { ok: false, reason: "The Tumblr blog name is not in the right form." };
  const parts = splitLinkText(text);
  if (!parts) return { ok: false, reason: "The article link is not in the right form." };

  const url = `${TUMBLR_HOST}/v2/blog/${blog}.tumblr.com/posts`;
  const authorization = await oauthAuthorization({
    method: "POST",
    url,
    consumerKey: values.consumerKey,
    consumerSecret: values.consumerSecret,
    token: values.accessToken,
    tokenSecret: values.tokenSecret,
  });
  const response = await withTimeout(fetchImpl, url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify({
      state: "published",
      content: [
        { type: "text", text: parts.head },
        { type: "link", url: parts.url },
      ],
    }),
  });
  if ("failed" in response) return { ok: false, reason: response.failed };
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "Tumblr did not accept the keys or the access token." };
  if (response.status === 404) return { ok: false, reason: "Tumblr did not find that blog." };
  if (response.status === 429) return { ok: false, reason: "Tumblr is limiting posts. Try later." };
  if (!response.ok) return { ok: false, reason: "Tumblr did not take the post." };
  // Tumblr post ids are larger than JavaScript can hold exactly, so the id is read as text.
  const raw = await response.text().catch(() => "");
  const match = /"id"\s*:\s*"?(\d+)"?/.exec(raw);
  return { ok: true, externalRef: match ? match[1].slice(0, 120) : null };
}

/** Blogger: an access token from the refresh token, then one published post with the article link. */
export async function sendBlogger(values: BloggerValues, text: string, fetchImpl: FetchLike): Promise<DoorSendResult> {
  if (!values.clientId || !values.clientSecret || !values.refreshToken || !values.blogId) {
    return { ok: false, reason: "Blogger is not connected yet." };
  }
  const blogId = values.blogId.trim();
  if (!BLOGGER_BLOG_ID.test(blogId)) return { ok: false, reason: "The Blogger blog ID is not in the right form." };
  const parts = splitLinkText(text);
  if (!parts) return { ok: false, reason: "The article link is not in the right form." };

  const token = await withTimeout(fetchImpl, GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: values.clientId,
      client_secret: values.clientSecret,
      refresh_token: values.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if ("failed" in token) return { ok: false, reason: token.failed };
  const signedIn = (await readJson(token)) as { access_token?: unknown } | null;
  if (!token.ok || typeof signedIn?.access_token !== "string") {
    return { ok: false, reason: "Google did not accept the Blogger sign-in details." };
  }

  const url = `${BLOGGER_HOST}/blogs/${blogId}/posts/`;
  const response = await withTimeout(fetchImpl, url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${signedIn.access_token}` },
    body: JSON.stringify({
      kind: "blogger#post",
      title: parts.head.slice(0, 200),
      content: `<p>${escapeHtml(parts.head)}</p><p><a href="${escapeHtml(parts.url)}">${escapeHtml(parts.url)}</a></p>`,
    }),
  });
  if ("failed" in response) return { ok: false, reason: response.failed };
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "Blogger did not accept the access." };
  if (response.status === 404) return { ok: false, reason: "Blogger did not find that blog." };
  if (response.status === 429) return { ok: false, reason: "Blogger is limiting posts. Try later." };
  const body = (await readJson(response)) as { id?: unknown } | null;
  if (!response.ok || (typeof body?.id !== "string" && typeof body?.id !== "number")) {
    return { ok: false, reason: "Blogger did not take the post." };
  }
  return { ok: true, externalRef: String(body.id).slice(0, 120) };
}

// ---- Phase 6 slice 3: Medium, WordPress.com and Pixelfed ----

export interface MediumValues {
  accessToken: string;
}

export interface WordPressComValues {
  site: string;
  accessToken: string;
}

export interface PixelfedValues {
  instanceUrl: string;
  accessToken: string;
}

/** The picture a Pixelfed post uploads. Its bytes come from the article's own cover image. */
export interface DoorImage {
  data: ArrayBuffer;
  contentType: string;
}

const MEDIUM_API = "https://api.medium.com/v1";
/** Medium answers "gone" once it closes a route. The owner sees this in plain words. The door is not scraped. */
export const MEDIUM_CLOSED_REASON = "Medium: this door is closed.";
const WORDPRESS_API = "https://public-api.wordpress.com";
const WORDPRESS_SITE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const PIXELFED_IMAGE_EXTENSION: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** A WordPress.com site as a host name (for example lixxon.wordpress.com). A pasted https:// and trailing slash are dropped. */
export function wordpressComSite(value: string): string | null {
  const site = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return site.length <= 253 && WORDPRESS_SITE.test(site) ? site : null;
}

/** The body of a short link post: the link only. The title already says what it is. */
function linkBody(url: string): string {
  return `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`;
}

/**
 * Medium: one published story with the article link (canonical link set to the article). The door works only with an
 * integration token the owner already has, because Medium no longer issues new ones. Returns the story id.
 */
export async function sendMedium(values: MediumValues, text: string, fetchImpl: FetchLike): Promise<DoorSendResult> {
  if (!values.accessToken) return { ok: false, reason: "Medium is not connected yet." };
  const parts = splitLinkText(text);
  if (!parts) return { ok: false, reason: "The article link is not in the right form." };
  const auth = { Authorization: `Bearer ${values.accessToken}`, Accept: "application/json" };

  // The account id is needed for the post address. Reading the account posts nothing.
  const me = await withTimeout(fetchImpl, `${MEDIUM_API}/me`, { method: "GET", headers: auth });
  if ("failed" in me) return { ok: false, reason: me.failed };
  if (me.status === 410) return { ok: false, reason: MEDIUM_CLOSED_REASON, closed: true };
  if (me.status === 401 || me.status === 403) return { ok: false, reason: "Medium did not accept the integration token." };
  if (me.status === 429) return { ok: false, reason: "Medium is limiting posts. Try later." };
  const account = (await readJson(me)) as { data?: { id?: unknown } } | null;
  const accountId = account?.data?.id;
  if (!me.ok || typeof accountId !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(accountId)) {
    return { ok: false, reason: "Medium did not return the account." };
  }

  const response = await withTimeout(fetchImpl, `${MEDIUM_API}/users/${accountId}/posts`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: parts.head.slice(0, 200),
      contentFormat: "html",
      content: linkBody(parts.url),
      canonicalUrl: parts.url,
      publishStatus: "public",
    }),
  });
  if ("failed" in response) return { ok: false, reason: response.failed };
  if (response.status === 410) return { ok: false, reason: MEDIUM_CLOSED_REASON, closed: true };
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "Medium did not accept the integration token." };
  if (response.status === 429) return { ok: false, reason: "Medium is limiting posts. Try later." };
  const body = (await readJson(response)) as { data?: { id?: unknown } } | null;
  const id = body?.data?.id;
  if (!response.ok || typeof id !== "string") return { ok: false, reason: "Medium did not take the story." };
  return { ok: true, externalRef: id.slice(0, 120) };
}

/**
 * WordPress.com: one published post, a title and a link back to the article. Not the full article.
 * Returns the post id.
 */
export async function sendWordPressCom(values: WordPressComValues, text: string, fetchImpl: FetchLike): Promise<DoorSendResult> {
  if (!values.site || !values.accessToken) return { ok: false, reason: "WordPress.com is not connected yet." };
  const site = wordpressComSite(values.site);
  if (!site) return { ok: false, reason: "The WordPress.com site address is not in the right form." };
  const parts = splitLinkText(text);
  if (!parts) return { ok: false, reason: "The article link is not in the right form." };

  const response = await withTimeout(fetchImpl, `${WORDPRESS_API}/wp/v2/sites/${encodeURIComponent(site)}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${values.accessToken}`, Accept: "application/json" },
    body: JSON.stringify({ title: parts.head.slice(0, 200), content: linkBody(parts.url), status: "publish" }),
  });
  if ("failed" in response) return { ok: false, reason: response.failed };
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "WordPress.com did not accept the access token." };
  if (response.status === 404) return { ok: false, reason: "WordPress.com did not find that site." };
  if (response.status === 429) return { ok: false, reason: "WordPress.com is limiting posts. Try later." };
  const body = (await readJson(response)) as { id?: unknown } | null;
  if (!response.ok || (typeof body?.id !== "string" && typeof body?.id !== "number")) {
    return { ok: false, reason: "WordPress.com did not take the post." };
  }
  return { ok: true, externalRef: String(body.id).slice(0, 120) };
}

/**
 * Pixelfed is photo-first, so a post needs a picture. The article's own cover image is uploaded, then one status
 * with that picture and the link text is published. Without a picture the send is refused before any request.
 * Returns the status id. The Idempotency-Key is the reserved row id.
 */
export async function sendPixelfed(
  values: PixelfedValues,
  text: string,
  image: DoorImage | null,
  idempotencyKey: string,
  fetchImpl: FetchLike,
): Promise<DoorSendResult> {
  if (!values.instanceUrl || !values.accessToken) return { ok: false, reason: "Pixelfed is not connected yet." };
  const origin = mastodonOrigin(values.instanceUrl);
  if (!origin) return { ok: false, reason: "The Pixelfed server address must start with https:// and have no path." };
  if (!image) return { ok: false, reason: "This article has no picture for Pixelfed." };
  const extension = PIXELFED_IMAGE_EXTENSION[image.contentType];
  if (!extension) return { ok: false, reason: "The article picture is not a type Pixelfed takes." };
  const parts = splitLinkText(text);
  if (!parts) return { ok: false, reason: "The article link is not in the right form." };

  // Upload the picture. The description is the alt text: the title line.
  const form = new FormData();
  form.append("file", new Blob([image.data], { type: image.contentType }), `article.${extension}`);
  form.append("description", parts.head.slice(0, 500));
  const upload = await withTimeout(fetchImpl, `${origin}/api/v1/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${values.accessToken}`, Accept: "application/json" },
    body: form,
  });
  if ("failed" in upload) return { ok: false, reason: upload.failed };
  if (upload.status === 401 || upload.status === 403) return { ok: false, reason: "Pixelfed did not accept the access token." };
  if (upload.status === 429) return { ok: false, reason: "Pixelfed is limiting posts. Try later." };
  const uploaded = (await readJson(upload)) as { id?: unknown } | null;
  if (!upload.ok || (typeof uploaded?.id !== "string" && typeof uploaded?.id !== "number")) {
    return { ok: false, reason: "Pixelfed did not take the picture." };
  }

  const response = await withTimeout(fetchImpl, `${origin}/api/v1/statuses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${values.accessToken}`,
      Accept: "application/json",
      "Idempotency-Key": idempotencyKey.slice(0, 120),
    },
    body: JSON.stringify({ status: text, caption: text, media_ids: [String(uploaded.id)], visibility: "public" }),
  });
  if ("failed" in response) return { ok: false, reason: response.failed };
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "Pixelfed did not accept the access token." };
  if (response.status === 429) return { ok: false, reason: "Pixelfed is limiting posts. Try later." };
  const body = (await readJson(response)) as { id?: unknown } | null;
  if (!response.ok || (typeof body?.id !== "string" && typeof body?.id !== "number")) {
    return { ok: false, reason: "Pixelfed did not take the post." };
  }
  return { ok: true, externalRef: String(body.id).slice(0, 120) };
}

// ---- Phase 6 slice 4: YouTube and Vimeo (real pack video only) ----

export interface YouTubeValues {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface VimeoValues {
  accessToken: string;
}

/** A real MP4 from a pack. Only ever read from storage, never invented. */
export interface DoorVideo {
  data: ArrayBuffer;
  contentType: string;
  bytes: number;
}

const YOUTUBE_UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";
const YOUTUBE_CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
const VIMEO_API = "https://api.vimeo.com";
const VIMEO_ACCEPT = "application/vnd.vimeo.*+json;version=3.4";
/** The most a video may be. A pack video is 10 seconds, far below this. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/** Title and description text for a video: YouTube refuses < and >, so they are removed. Clipped to the door's limit. */
export function plainVideoText(value: string, max: number): string {
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** True when an address is https and on one of the given hosts (or a sub-host). Used before any bytes are sent. */
export function onHost(url: string, hosts: readonly string[]): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && hosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/** The shared checks for a video: an MP4, not empty, not too large. Returns a plain reason, or null when it is fine. */
function videoProblem(video: DoorVideo | null): string | null {
  if (!video) return "There is no video for this article yet.";
  if (video.contentType !== "video/mp4") return "The video is not an MP4 file.";
  if (!(video.bytes > 0)) return "The video file is empty. Nothing was sent.";
  if (video.bytes > VIDEO_MAX_BYTES) return "The video is too large for this door.";
  return null;
}

/**
 * YouTube: one resumable upload of the pack's MP4, as a Short. The upload goes to Google's own upload address only.
 * An unaudited Google project uploads as private; that is reported as a note, never as a public post.
 * Returns the video id.
 */
export async function sendYouTube(values: YouTubeValues, text: string, title: string, video: DoorVideo | null, fetchImpl: FetchLike): Promise<DoorSendResult> {
  if (!values.clientId || !values.clientSecret || !values.refreshToken) return { ok: false, reason: "YouTube is not connected yet." };
  const problem = videoProblem(video);
  if (problem || !video) return { ok: false, reason: problem ?? "There is no video for this article yet." };

  const token = await withTimeout(fetchImpl, GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: values.clientId,
      client_secret: values.clientSecret,
      refresh_token: values.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if ("failed" in token) return { ok: false, reason: token.failed };
  const signedIn = (await readJson(token)) as { access_token?: unknown } | null;
  if (!token.ok || typeof signedIn?.access_token !== "string") return { ok: false, reason: "Google did not accept the YouTube sign-in details." };

  // Step 1: describe the video and ask for an upload address.
  const start = await withTimeout(fetchImpl, `${YOUTUBE_UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Authorization: `Bearer ${signedIn.access_token}`,
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(video.bytes),
    },
    body: JSON.stringify({
      snippet: { title: plainVideoText(title, 100) || "New on the blog", description: plainVideoText(text, 5000), categoryId: "22" },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    }),
  });
  if ("failed" in start) return { ok: false, reason: start.failed };
  if (start.status === 401) return { ok: false, reason: "YouTube did not accept the sign-in for uploads." };
  if (start.status === 403) return { ok: false, reason: "YouTube refused the upload. It may be the daily upload limit or the upload permission." };
  if (start.status === 429) return { ok: false, reason: "YouTube is limiting uploads. Try later." };
  const location = start.headers.get("location");
  if (!start.ok || !location || !onHost(location, ["googleapis.com"])) return { ok: false, reason: "YouTube did not start the upload." };

  // Step 2: send the bytes to that address. No sign-in header goes with them.
  const sent = await withTimeout(fetchImpl, location, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: video.data,
  });
  if ("failed" in sent) return { ok: false, reason: sent.failed };
  const body = (await readJson(sent)) as { id?: unknown; status?: { privacyStatus?: unknown } } | null;
  if (!sent.ok || typeof body?.id !== "string") return { ok: false, reason: "YouTube did not take the video." };
  const privacy = body.status?.privacyStatus;
  const note = typeof privacy === "string" && privacy !== "public"
    ? `YouTube kept it ${privacy}: the Google app is not yet approved for public uploads.`
    : undefined;
  return { ok: true, externalRef: body.id.slice(0, 120), ...(note ? { note } : {}) };
}

/**
 * Vimeo: create the video, then send the MP4 with Vimeo's resumable (tus) upload. The upload address must be on Vimeo.
 * The whole file must be taken (the offset must equal the size). Returns the video id.
 */
export async function sendVimeo(values: VimeoValues, text: string, title: string, video: DoorVideo | null, fetchImpl: FetchLike): Promise<DoorSendResult> {
  if (!values.accessToken) return { ok: false, reason: "Vimeo is not connected yet." };
  const problem = videoProblem(video);
  if (problem || !video) return { ok: false, reason: problem ?? "There is no video for this article yet." };

  // Step 1: create the video and get its upload address.
  const created = await withTimeout(fetchImpl, `${VIMEO_API}/me/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${values.accessToken}`, Accept: VIMEO_ACCEPT },
    body: JSON.stringify({
      upload: { approach: "tus", size: String(video.bytes) },
      name: plainVideoText(title, 128) || "New on the blog",
      description: plainVideoText(text, 5000),
      privacy: { view: "anybody" },
    }),
  });
  if ("failed" in created) return { ok: false, reason: created.failed };
  if (created.status === 401) return { ok: false, reason: "Vimeo did not accept the access token." };
  if (created.status === 403 || created.status === 429) return { ok: false, reason: "Vimeo refused the upload. Check the upload limit on your Vimeo plan." };
  const made = (await readJson(created)) as { uri?: unknown; upload?: { upload_link?: unknown } } | null;
  const uri = made?.uri;
  const link = made?.upload?.upload_link;
  if (!created.ok || typeof uri !== "string" || typeof link !== "string" || !onHost(link, ["vimeo.com"])) {
    return { ok: false, reason: "Vimeo did not start the upload." };
  }

  // Step 2: send the bytes to Vimeo's upload address. No sign-in header goes with them.
  const sent = await withTimeout(fetchImpl, link, {
    method: "PATCH",
    headers: { "Tus-Resumable": "1.0.0", "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream", Accept: VIMEO_ACCEPT },
    body: video.data,
  });
  if ("failed" in sent) return { ok: false, reason: sent.failed };
  const offset = sent.headers.get("upload-offset");
  if (!sent.ok || (offset !== null && Number(offset) !== video.bytes)) return { ok: false, reason: "Vimeo did not take the whole video." };
  const id = /\/videos\/(\d+)/.exec(uri)?.[1];
  return { ok: true, externalRef: (id ?? uri).slice(0, 120) };
}

/** Read-only checks for the two video doors (no upload, no post). */
export async function youtubeChannelCheck(values: YouTubeValues, fetchImpl: FetchLike): Promise<"connected" | "invalid" | "rate_limited" | "unavailable"> {
  const token = await withTimeout(fetchImpl, GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: values.clientId, client_secret: values.clientSecret, refresh_token: values.refreshToken, grant_type: "refresh_token" }).toString(),
  });
  if ("failed" in token) return "unavailable";
  const signedIn = (await readJson(token)) as { access_token?: unknown } | null;
  if (!token.ok || typeof signedIn?.access_token !== "string") return token.status === 429 ? "rate_limited" : "invalid";
  // Reading the channel the sign-in belongs to. Nothing is uploaded.
  const channel = await withTimeout(fetchImpl, `${YOUTUBE_CHANNELS}?part=id&mine=true`, {
    method: "GET",
    headers: { Authorization: `Bearer ${signedIn.access_token}` },
  });
  if ("failed" in channel) return "unavailable";
  if (channel.status === 429) return "rate_limited";
  if (!channel.ok) return "invalid";
  const body = (await readJson(channel)) as { items?: unknown[] } | null;
  return Array.isArray(body?.items) && body.items.length > 0 ? "connected" : "invalid";
}
