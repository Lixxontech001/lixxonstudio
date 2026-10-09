// Buddy's routing rules: which of the owner's messages are orders, which are questions about a mind,
// and which go to the normal chat. Pure logic: no database, no Gemini. Simple words, so it works with no key.
// Rules:
// - A question about a mind is answered from the real daily log, never from a guess.
// - An order names a mind, or Buddy asks which mind once. An order is stored as waiting, never as done.
// - Minds cannot publish, send, spend or change prices. Buddy says so when an order touches those.

import { ownerClock } from "./mindsNightReport.ts";

export const MIND_KEYS = ["analyst", "strategist", "ceo", "executioner", "auditor"] as const;
export type MindName = (typeof MIND_KEYS)[number];

export const MIND_LABELS: Record<MindName, string> = {
  analyst: "Analyst",
  strategist: "Strategist",
  ceo: "CEO",
  executioner: "Executioner",
  auditor: "Auditor",
};

export const ASK_WHICH_MIND_LINE =
  "Which mind should take this: Analyst, Strategist, CEO, Executioner or Auditor? Reply with one name.";
export const RESTRICTED_LINE =
  "Minds will not publish, send, spend or change prices, so any part like that waits for you.";
export const MAX_ORDER_CHARS = 1000;
export const LOG_ANSWER_ROWS = 10;

/** Words that mean the owner wants something a mind is never allowed to do by itself. */
const RESTRICTED_WORDS = /\b(publish|send|email|e-mail|spend|pay|refund|price|prices|pricing|discount|delete|post)\b/i;
/** A message that starts with an action word is an order. */
const IMPERATIVE = /^(please\s+)?(tell|ask|have|get|make|set|check|review|look|plan|prepare|sort|draft|find|fix|update|write|schedule|follow|watch|research|compare|list|build|run|keep|put|send|publish|pause|resume|start|stop|pull)\b/i;
/** A question: a question mark, or a question word at the start. */
const QUESTION = /\?\s*$|^(what|which|how|why|who|when|where|has|have|did|does|do|is|are|was|were|can|could|would)\b/i;

export type Route =
  | { kind: "mind_log"; mind: MindName }
  | { kind: "order"; mind: MindName; instruction: string; resolvesPending: boolean }
  | { kind: "ask_which_mind"; instruction: string }
  | { kind: "chat" };

export interface PendingOrder {
  instruction: string;
}

/** The one mind named in the message. Naming two different minds is unclear, so it is null. */
export function namedMind(message: string): MindName | null {
  const found = new Set<MindName>();
  for (const key of MIND_KEYS) {
    const pattern = key === "ceo" ? /\bceo\b/i : new RegExp(`\\b${key}s?\\b`, "i");
    if (pattern.test(message)) found.add(key);
  }
  return found.size === 1 ? [...found][0] : null;
}

export function isRestricted(message: string): boolean {
  return RESTRICTED_WORDS.test(message);
}

export function cleanInstruction(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, MAX_ORDER_CHARS);
}

/**
 * Decides what one owner message is. `pending` is an order Buddy is waiting to file once a mind is named.
 * Only one route is returned. When the answer to a pending order arrives, `resolvesPending` is true.
 */
export function routeMessage(message: string, pending: PendingOrder | null): Route {
  const text = message.trim();
  const mind = namedMind(text);
  const question = QUESTION.test(text);
  const imperative = IMPERATIVE.test(text);
  const words = text.split(/\s+/).filter(Boolean).length;

  if (pending && mind && words <= 5 && !imperative && !question) {
    return { kind: "order", mind, instruction: pending.instruction, resolvesPending: true };
  }
  if (mind && question) return { kind: "mind_log", mind };
  if (mind && imperative) return { kind: "order", mind, instruction: cleanInstruction(text), resolvesPending: false };
  if (!mind && imperative && !question) return { kind: "ask_which_mind", instruction: cleanInstruction(text) };
  return { kind: "chat" };
}

export interface MindLogLine {
  happened_at: string;
  day: string;
  mind: string;
  action: string;
  outcome: string;
  detail: string;
}

const OUTCOME_WORD: Record<string, string> = { done: "Done", skipped: "Skipped", blocked: "Blocked", failed: "Failed" };

/** The answer to "what did the Analyst do?", built only from real log rows. Honest when there are none. */
export function answerFromLog(mind: MindName, rows: MindLogLine[] | null): string {
  const label = MIND_LABELS[mind];
  if (rows === null) return `I could not read the log just now, so I cannot say what the ${label} did. Nothing was changed. Try again shortly.`;
  const own = rows.filter((row) => row.mind === mind).slice(0, LOG_ANSWER_ROWS);
  if (own.length === 0) return `The ${label} has not logged any action yet.`;
  const lines = own.map((row) => {
    const detail = row.detail.trim() ? ` ${row.detail.trim()}` : "";
    return `${row.day} ${ownerClock(row.happened_at)}: ${row.action}. ${OUTCOME_WORD[row.outcome] ?? "Logged"}.${detail}`;
  });
  return [`What the ${label} did, newest first:`, ...lines].join("\n");
}
