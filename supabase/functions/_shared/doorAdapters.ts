// The HTTP senders for the free doors that are open in this build: Telegram (bot API) and Discord (webhook).
// Each returns a plain result. Reasons never include a token, a webhook address, or the provider's raw text.
// $0: both services are free to use with these official routes.

export const DOOR_TIMEOUT_MS = 8000;

export type DoorSendResult = { ok: true; externalRef: string | null } | { ok: false; reason: string };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TelegramValues {
  token: string;
  chatId: string;
}

const TELEGRAM_HOST = "api.telegram.org";
const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

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
