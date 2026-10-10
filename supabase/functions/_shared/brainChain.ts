// Buddy's brains in order: one request walks the free brains (see brains.ts), skips any without a saved key,
// and moves on when a brain says "rate limited", "unavailable", "rejected" or "empty".
// Each brain is tried at most once per request, so a dead key is never retried in a loop.
// Pure logic. The Vault read, the Gemini call and the fetch come in through `ports`, so tests use fakes.
// Nothing here logs or returns a key. The reply text is capped.

import { tryableBrains, type BrainId, type BrainSlot } from "./brains.ts";

export const BRAIN_TIMEOUT_MS = 15_000;
export const BRAIN_MAX_REPLY_CHARS = 4000;

export const NONE_SAVED_LINE = "Buddy cannot think yet because no thinking key is saved. Add one in Admin under Automation keys.";
export const ALL_FAILED_LINE = "Buddy could not reach any of its brains just now. Nothing was changed. Try again in a few minutes.";

export type BrainTurn = { role: "user" | "model"; text: string };
export interface BrainInput {
  system: string;
  turns: BrainTurn[];
  json?: boolean;
}

export type BrainCallOutcome = "rejected" | "rate_limited" | "unavailable" | "empty";
export type BrainCallResult = { ok: true; text: string } | { ok: false; outcome: BrainCallOutcome };

export interface BrainPorts {
  /** Reads one Vault entry on the server. Returns null when it is not saved. Never returns the value to a log. */
  readSecret(secretName: string): Promise<string | null>;
  /** Gemini keeps its own Google path. The caller passes its existing call here. */
  askGemini(apiKey: string, input: BrainInput): Promise<BrainCallResult>;
  /** The fetch used for the OpenAI-style brains. Tests pass a fake. */
  fetchImpl?: typeof fetch;
}

export type BrainAnswer =
  | { ok: true; brain: BrainId; label: string; text: string; tried: BrainId[] }
  | { ok: false; reason: "none_saved" | "all_failed"; line: string; tried: BrainId[] };

interface BrainKeys {
  apiKey: string;
  extras: Record<string, string>;
}

/** The saved keys for one brain, or null when any required key is missing or blank. A read that throws counts as missing. */
async function keysFor(slot: BrainSlot, ports: BrainPorts): Promise<BrainKeys | null> {
  const apiKey = await safeRead(ports, slot.secretName);
  if (!apiKey) return null;
  const extras: Record<string, string> = {};
  for (const name of slot.extraSecretNames) {
    const value = await safeRead(ports, name);
    if (!value) return null;
    extras[name] = value;
  }
  return { apiKey, extras };
}

async function safeRead(ports: BrainPorts, name: string): Promise<string | null> {
  try {
    const value = await ports.readSecret(name);
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Asks the brains in order and returns the first reply. Skips brains without a key. Never throws.
 * `tried` lists the brains that were actually called, in order, so the log can say which one answered.
 */
export async function askBrains(input: BrainInput, ports: BrainPorts): Promise<BrainAnswer> {
  const tried: BrainId[] = [];
  for (const slot of tryableBrains()) {
    const keys = await keysFor(slot, ports);
    if (!keys) continue;
    tried.push(slot.id);
    let result: BrainCallResult;
    try {
      result = slot.id === "gemini"
        ? await ports.askGemini(keys.apiKey, input)
        : await askOpenAiStyle(slot, keys, input, ports.fetchImpl ?? fetch);
    } catch {
      result = { ok: false, outcome: "unavailable" };
    }
    if (result.ok) return { ok: true, brain: slot.id, label: slot.label, text: result.text, tried };
  }
  if (tried.length === 0) return { ok: false, reason: "none_saved", line: NONE_SAVED_LINE, tried };
  return { ok: false, reason: "all_failed", line: ALL_FAILED_LINE, tried };
}

/** One OpenAI-style chat call. The key goes only in the Authorization header. Each failure is a plain outcome, never a throw. */
export async function askOpenAiStyle(
  slot: BrainSlot,
  keys: BrainKeys,
  input: BrainInput,
  fetchImpl: typeof fetch,
): Promise<BrainCallResult> {
  if (!slot.baseUrl) return { ok: false, outcome: "rejected" };
  const accountId = keys.extras["cloudflare_account_id"];
  const base = slot.baseUrl.includes("{account_id}")
    ? slot.baseUrl.replace("{account_id}", encodeURIComponent(accountId ?? ""))
    : slot.baseUrl;
  if (base.includes("{")) return { ok: false, outcome: "rejected" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRAIN_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${keys.apiKey}` },
      body: JSON.stringify({
        model: slot.model,
        messages: [
          { role: "system", content: input.system },
          ...input.turns.map((turn) => ({ role: turn.role === "model" ? "assistant" : "user", content: turn.text })),
        ],
        temperature: 0.4,
        max_tokens: input.json ? 900 : 700,
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
    const text = extractOpenAiText(payload);
    return text ? { ok: true, text } : { ok: false, outcome: "empty" };
  } catch {
    return { ok: false, outcome: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/** The first choice's text. Returns "" when there is none. Capped. */
export function extractOpenAiText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return "";
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return "";
  const content = first.message.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("")
      : "";
  return text.trim().slice(0, BRAIN_MAX_REPLY_CHARS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is not needed; a cancel failure changes nothing.
  }
}
