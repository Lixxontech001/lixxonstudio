// The HTTP senders for the free doors that are open in this build: Telegram (bot API), Discord (webhook),
// Bluesky (AT Protocol, app password) and Mastodon (REST, access token).
// Each returns a plain result. Reasons never include a token, a password, a webhook address, or the provider's raw text.
// $0: all four are free to use through their official routes.

export const DOOR_TIMEOUT_MS = 8000;

export type DoorSendResult = { ok: true; externalRef: string | null } | { ok: false; reason: string };

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

/** Runs one request with a time limit. Maps network and timeout failures to plain reasons. */
async function withTimeout(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response | { failed: string }> {
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

async function readJson(response: Response): Promise<unknown> {
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
  const handle = values.handle.replace(/^@/, "").toLowerCase();
  if (handle.length > 253 || !BLUESKY_HANDLE.test(handle)) return { ok: false, reason: "The Bluesky handle is not in the right form." };

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
