// Buddy's think path. Pure logic: no Deno globals, so it can be tested under Vitest.
// The edge function (buddy-think/index.ts) supplies the real Vault read, rate limit and fetch.

/** Current stable Flash model on the Gemini API (Google's model list, Oct 2026). Change here only. */
export const BUDDY_GEMINI_MODEL = "gemini-3.8-flash";
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_TIMEOUT_MS = 15_000;
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_REPLY_CHARS = 4000;

export const BUDDY_SYSTEM_INSTRUCTION = [
  "You are Buddy, the chief of staff for Lixxon Studio.",
  "You talk only to the owner. Be short, clear and human. Plain English, no jargon, no hype.",
  "You do not write marketing copy. You do not post, send, publish, edit or change anything.",
  "You only know what the owner tells you in this conversation. If you cannot see something, say you cannot see it yet.",
  "Never invent article titles, product names, prices or numbers.",
].join("\n");

export const BUDDY_TEST_PROMPT = "Reply with one short sentence confirming that Buddy can think. Add nothing else.";

export const NO_KEY_MESSAGE =
  "Buddy cannot think yet because no Google key is saved. Add it in Admin under Automation keys, in the box called Google key.";

export type BuddyThinkAction = "status" | "probe" | "ask";
export type ThinkOutcome = "rejected" | "rate_limited" | "unavailable" | "empty";

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
  askGemini(apiKey: string, input: { system: string; text: string }): Promise<GeminiResult>;
  /** Saves the outcome of the one-line proof call to the existing key status (no reply text is stored). */
  recordProbe(status: "ok" | "invalid" | "rate_limited" | "unavailable"): Promise<void>;
}

const ALLOWED_KEYS = ["action", "message"];

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

/** Strips control characters and surrounding space. Returns null when empty or too long. */
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

export function cleanMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = stripControlCharacters(value).trim();
  if (!text || text.length > MAX_MESSAGE_CHARS) return null;
  return text;
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
  input: { system: string; text: string },
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
        contents: [{ role: "user", parts: [{ text: input.text }] }],
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
 */
export async function handleBuddyThink(payload: unknown, deps: BuddyThinkDeps): Promise<ThinkResponse> {
  if (!isRecord(payload) || Object.keys(payload).some((key) => !ALLOWED_KEYS.includes(key))) {
    return fail(400, "invalid_request", "Only an action and a message are accepted.");
  }
  const action = payload.action;
  if (action !== "status" && action !== "probe" && action !== "ask") {
    return fail(400, "invalid_action", "Buddy only accepts the status, probe or ask actions.");
  }

  if (action === "status") {
    return { status: 200, body: { ok: true, action, configured: await deps.keyConfigured() } };
  }

  let text = BUDDY_TEST_PROMPT;
  if (action === "ask") {
    const message = cleanMessage(payload.message);
    if (!message) return fail(400, "invalid_message", `Type a message of 1 to ${MAX_MESSAGE_CHARS} characters.`);
    text = message;
  }

  const key = await deps.readKey();
  if (!key) {
    return {
      status: 200,
      body: { ok: false, action, reason: "no_key", message: NO_KEY_MESSAGE, ...(action === "probe" ? { can_think: false } : {}) },
    };
  }

  const allowed = await deps.allowCall(action);
  if (allowed === null) {
    return {
      status: 200,
      body: { ok: false, action, reason: "unavailable", message: "Buddy could not check its limits just now. Try again shortly.", ...(action === "probe" ? { can_think: false } : {}) },
    };
  }
  if (!allowed) {
    return {
      status: 200,
      body: { ok: false, action, reason: "rate_limited", message: "You have asked Buddy a lot in a short time. Wait a few minutes and try again.", ...(action === "probe" ? { can_think: false } : {}) },
    };
  }

  const result = await deps.askGemini(key, { system: BUDDY_SYSTEM_INSTRUCTION, text });

  if (action === "probe") {
    await deps.recordProbe(result.ok ? "ok" : probeStatusFor(result.outcome));
  }

  if (result.ok) {
    return {
      status: 200,
      body: {
        ok: true,
        action,
        model: BUDDY_GEMINI_MODEL,
        reply: result.text,
        ...(action === "probe" ? { can_think: true } : {}),
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: false,
      action,
      reason: result.outcome,
      message: OUTCOME_MESSAGES[result.outcome],
      ...(action === "probe" ? { can_think: false } : {}),
    },
  };
}
