// Buddy's think path. Pure logic: no Deno globals, so it can be tested under Vitest.
// The edge function (buddy-think/index.ts) supplies the real Vault read, rate limit, chat
// storage, site reads and fetch.

import { buildBriefing, FIRST_VISIT_WINDOW_HOURS, type BriefingFacts, type BriefingSection } from "./buddyBriefing.ts";

/** Current stable Flash model on the Gemini API (Google's model list, Oct 2026). Change here only. */
export const BUDDY_GEMINI_MODEL = "gemini-3.8-flash";
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_TIMEOUT_MS = 15_000;
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_REPLY_CHARS = 4000;
/** How many earlier messages of the same chat Buddy sees when it answers. */
export const HISTORY_TURNS = 20;

export const BUDDY_SYSTEM_INSTRUCTION = [
  "You are Buddy, the chief of staff for Lixxon Studio.",
  "You talk only to the owner. Be short, clear and human. Plain English, no jargon, no hype.",
  "You do not write marketing copy. You do not post, send, publish, edit or change anything.",
  "Right now you cannot see the website's articles, the shop or any numbers beyond the briefings in this chat. If the owner asks about them, say you cannot see them yet. Never guess or invent article titles, product names, prices or numbers.",
  "You only know what the owner tells you in this conversation, and the briefings Buddy has written in it.",
].join("\n");

export const BUDDY_TEST_PROMPT = "Reply with one short sentence confirming that Buddy can think. Add nothing else.";

export const NO_KEY_MESSAGE =
  "Buddy cannot think yet because no Google key is saved. Add it in Admin under Automation keys, in the box called Google key.";

export const SAVE_FAILED_MESSAGE = "Buddy could not save your message, so nothing was sent. Try again in a moment.";

export type BuddyThinkAction = "status" | "probe" | "ask" | "briefing";
export type ThinkOutcome = "rejected" | "rate_limited" | "unavailable" | "empty";
export type ChatRole = "owner" | "buddy";
export type ChatKind = "reply" | "notice" | "briefing";

/** One earlier turn, in the shape Gemini expects. */
export interface GeminiTurn {
  role: "user" | "model";
  text: string;
}

export type GeminiResult = { ok: true; text: string } | { ok: false; outcome: ThinkOutcome };

export interface ThinkResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface BuddyThinkDeps {
  /** True when the Vault entry for the Google key exists. Never returns the key itself. */
  keyConfigured(): Promise<boolean>;
  /** Reads the key from Vault on the server. Only called for ask/probe. */
  readKey(): Promise<string | null>;
  /** Rate limit for one model call. Null means the limit could not be checked (fail closed). */
  allowCall(action: "probe" | "ask"): Promise<boolean | null>;
  askGemini(apiKey: string, input: { system: string; turns: GeminiTurn[] }): Promise<GeminiResult>;
  /** Saves the outcome of the one-line proof call to the existing key status (no reply text is stored). */
  recordProbe(status: "ok" | "invalid" | "rate_limited" | "unavailable"): Promise<void>;
  /** The chat if it exists and belongs to this owner (enforced by row-level security). */
  loadChat(chatId: string): Promise<{ id: string; title: string | null } | null>;
  /** Earlier replies and questions in this chat, oldest first. Notices are not included. Null when unreadable. */
  loadHistory(chatId: string): Promise<GeminiTurn[] | null>;
  /** Stores one message in the chat. Returns false when it could not be saved. */
  saveMessage(chatId: string, role: ChatRole, kind: ChatKind, content: string, payload?: Record<string, unknown> | null): Promise<boolean>;
  /** Sets the title if the chat has none yet, and marks the chat as recently active. */
  touchChat(chatId: string, title: string): Promise<void>;
  /** The server clock. Injected so tests can fix the time. */
  now(): Date;
  /** When the owner last clicked Continue. Null means a first visit. `ok:false` means it could not be read. */
  getSeenAt(): Promise<{ ok: true; seenAt: string | null } | { ok: false }>;
  /** Records the Continue time. Returns false when it could not be saved. */
  markSeen(atIso: string): Promise<boolean>;
  /** Reads what happened since the given time. Each source reports its own ok flag. */
  readBriefingFacts(sinceIso: string): Promise<BriefingFacts>;
  /** Today's briefing thread for this owner, created on first use. Null when it cannot be read or made. */
  findOrCreateBriefing(localDate: string): Promise<{ id: string; created: boolean } | null>;
}

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const ALLOWED_KEYS = ["action", "message", "chat_id", "local_date"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OUTCOME_MESSAGES: Record<ThinkOutcome, string> = {
  rejected: "Google rejected the saved key. Replace it in Admin under Automation keys.",
  rate_limited: "Google is limiting this key for now. Wait a few minutes and try again.",
  unavailable: "Google could not be reached just now. Try again in a little while.",
  empty: "Google sent back nothing usable. Try asking in a shorter, plainer way.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(status: number, reason: string, message: string): ThinkResponse {
  return { status, body: { ok: false, reason, message } };
}

/** Removes control characters, keeping tabs and line breaks. */
function stripControlCharacters(value: string): string {
  let out = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    const isControl = (code <= 31 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    if (!isControl) out += character;
  }
  return out;
}

/** Strips control characters and surrounding space. Returns null when empty or too long. */
export function cleanMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = stripControlCharacters(value).trim();
  if (!text || text.length > MAX_MESSAGE_CHARS) return null;
  return text;
}

/** A short chat title taken from the first question. */
export function titleFromMessage(message: string): string {
  const firstLine = message.split("\n")[0].trim();
  return (firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine) || "New chat";
}

/** Joins the model's answer text, ignoring any "thought" parts. Returns "" when there is none. */
export function extractReplyText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return "";
  const first = payload.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) return "";
  const text = first.content.parts
    .filter((part): part is { text: string; thought?: unknown } => isRecord(part) && typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text)
    .join("")
    .trim();
  return text.slice(0, MAX_REPLY_CHARS);
}

/** One server-side call to Gemini. The key goes only in the request header and is never echoed back. */
export async function callGemini(
  apiKey: string,
  input: { system: string; turns: GeminiTurn[] },
  fetchImpl: typeof fetch = fetch,
): Promise<GeminiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${GEMINI_API_BASE}/models/${BUDDY_GEMINI_MODEL}:generateContent`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
        generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
      }),
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      await discardBody(response);
      return { ok: false, outcome: "rejected" };
    }
    if (response.status === 429) {
      await discardBody(response);
      return { ok: false, outcome: "rate_limited" };
    }
    if (!response.ok) {
      await discardBody(response);
      return { ok: false, outcome: "unavailable" };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, outcome: "unavailable" };
    }
    const text = extractReplyText(payload);
    return text ? { ok: true, text } : { ok: false, outcome: "empty" };
  } catch {
    return { ok: false, outcome: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is not needed; a cancel failure changes nothing.
  }
}

function probeStatusFor(outcome: ThinkOutcome): "invalid" | "rate_limited" | "unavailable" {
  if (outcome === "rejected") return "invalid";
  if (outcome === "rate_limited") return "rate_limited";
  return "unavailable";
}

/**
 * Handles one already-authenticated owner request. The caller checks identity first.
 * Returns honest JSON for every outcome; never a made-up reply.
 *
 * ask flow: the chat must exist and belong to the owner, then the key and the rate limit are
 * checked, then the owner's message is saved, Gemini answers with the chat so far, and the
 * answer is saved. A missing key still saves the question and an honest notice in the chat.
 */
export async function handleBuddyThink(payload: unknown, deps: BuddyThinkDeps): Promise<ThinkResponse> {
  if (!isRecord(payload) || Object.keys(payload).some((key) => !ALLOWED_KEYS.includes(key))) {
    return fail(400, "invalid_request", "Only an action, a message and a chat id are accepted.");
  }
  const action = payload.action;
  if (action !== "status" && action !== "probe" && action !== "ask" && action !== "briefing") {
    return fail(400, "invalid_action", "Buddy only accepts the status, probe, ask or briefing actions.");
  }

  if (action === "status") {
    return { status: 200, body: { ok: true, action, configured: await deps.keyConfigured() } };
  }

  if (action === "probe") {
    const key = await deps.readKey();
    if (!key) {
      return { status: 200, body: { ok: false, action, reason: "no_key", message: NO_KEY_MESSAGE, can_think: false } };
    }
    const allowed = await deps.allowCall("probe");
    if (allowed === null || allowed === false) {
      const reason = allowed === null ? "unavailable" : "rate_limited";
      const message = allowed === null
        ? "Buddy could not check its limits just now. Try again shortly."
        : "You have asked Buddy a lot in a short time. Wait a few minutes and try again.";
      return { status: 200, body: { ok: false, action, reason, message, can_think: false } };
    }
    const result = await deps.askGemini(key, { system: BUDDY_SYSTEM_INSTRUCTION, turns: [{ role: "user", text: BUDDY_TEST_PROMPT }] });
    await deps.recordProbe(result.ok ? "ok" : probeStatusFor(result.outcome));
    if (result.ok) {
      return { status: 200, body: { ok: true, action, model: BUDDY_GEMINI_MODEL, reply: result.text, can_think: true } };
    }
    return { status: 200, body: { ok: false, action, reason: result.outcome, message: OUTCOME_MESSAGES[result.outcome], can_think: false } };
  }

  if (action === "briefing") {
    const localDate = payload.local_date;
    if (typeof localDate !== "string" || !isRealDate(localDate)) {
      return fail(400, "invalid_date", "Buddy needs today's date from your device.");
    }
    const seen = await deps.getSeenAt();
    if (!seen.ok) return fail(503, "state_unavailable", "Buddy could not check when you last looked. Try again shortly.");
    const now = deps.now();
    const firstVisit = seen.seenAt === null;
    const sinceIso = firstVisit
      ? new Date(now.getTime() - FIRST_VISIT_WINDOW_HOURS * 3_600_000).toISOString()
      : seen.seenAt!;
    const thread = await deps.findOrCreateBriefing(localDate);
    if (!thread) return fail(503, "thread_unavailable", "Buddy could not open today's chat. Try again shortly.");

    const facts = await deps.readBriefingFacts(sinceIso);
    const built = buildBriefing(facts, now, sinceIso, firstVisit);
    const saved = await deps.saveMessage(
      thread.id,
      "buddy",
      "briefing",
      built.text,
      built.quiet ? null : { sections: built.sections as BriefingSection[] },
    );
    if (!saved) return fail(503, "not_saved", "Buddy could not save today's briefing. Try again shortly.");
    // Only a briefing that was saved counts as "seen", so nothing is lost if the save fails.
    await deps.markSeen(now.toISOString());
    return {
      status: 200,
      body: {
        ok: true,
        action,
        chat_id: thread.id,
        created: thread.created,
        first_visit: firstVisit,
        quiet: built.quiet,
        sections: built.sections,
        text: built.text,
      },
    };
  }

  // ask
  const message = cleanMessage(payload.message);
  if (!message) return fail(400, "invalid_message", `Type a message of 1 to ${MAX_MESSAGE_CHARS} characters.`);
  const chatId = typeof payload.chat_id === "string" && UUID_RE.test(payload.chat_id) ? payload.chat_id : null;
  if (!chatId) return fail(400, "invalid_chat", "Start or open a chat first.");

  const chat = await deps.loadChat(chatId);
  if (!chat) return fail(404, "chat_not_found", "That chat could not be found. Start a new chat and try again.");
  const title = chat.title ?? titleFromMessage(message);

  const key = await deps.readKey();
  if (!key) {
    const saved = await deps.saveMessage(chatId, "owner", "reply", message);
    if (!saved) return fail(503, "not_saved", SAVE_FAILED_MESSAGE);
    await deps.saveMessage(chatId, "buddy", "notice", NO_KEY_MESSAGE);
    await deps.touchChat(chatId, title);
    return { status: 200, body: { ok: false, action, reason: "no_key", message: NO_KEY_MESSAGE } };
  }

  const allowed = await deps.allowCall("ask");
  if (allowed === null) {
    return fail(200, "unavailable", "Buddy could not check its limits just now. Nothing was sent. Try again shortly.");
  }
  if (!allowed) {
    return fail(200, "rate_limited", "You have asked Buddy a lot in a short time. Wait a few minutes and try again. Nothing was sent.");
  }

  const history = await deps.loadHistory(chatId);
  if (!history) return fail(503, "history_unavailable", "Buddy could not read this chat just now. Nothing was sent. Try again shortly.");
  const savedQuestion = await deps.saveMessage(chatId, "owner", "reply", message);
  if (!savedQuestion) return fail(503, "not_saved", SAVE_FAILED_MESSAGE);
  await deps.touchChat(chatId, title);

  const turns: GeminiTurn[] = [...history.slice(-HISTORY_TURNS), { role: "user", text: message }];
  const result = await deps.askGemini(key, { system: BUDDY_SYSTEM_INSTRUCTION, turns });

  if (result.ok) {
    const saved = await deps.saveMessage(chatId, "buddy", "reply", result.text);
    return { status: 200, body: { ok: true, action, model: BUDDY_GEMINI_MODEL, reply: result.text, saved } };
  }
  const notice = OUTCOME_MESSAGES[result.outcome];
  await deps.saveMessage(chatId, "buddy", "notice", notice);
  return { status: 200, body: { ok: false, action, reason: result.outcome, message: notice } };
}
