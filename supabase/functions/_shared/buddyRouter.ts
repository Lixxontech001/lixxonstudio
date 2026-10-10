// Buddy's routing rules: which of the owner's messages are orders, which are questions about a mind,
// and which go to the normal chat. Pure logic: no database, no Gemini. Simple words, so it works with no key.
// Rules:
// - A question about a mind is answered from the real daily log, never from a guess.
// - An order names a mind, or Buddy asks which mind once. An order is stored as waiting, never as done.
// - Ordinary action words are orders. "Do the new article" is an order. Only question forms are questions.
// - Minds cannot publish, send, spend or change prices. Buddy says so when an order touches those.

import { ownerClock } from "./mindsNightReport.ts";
import { brainHowTo, howToDoor, type HowToDoor } from "./buddyHowTo.ts";
import type { BrainId } from "./brains.ts";
import { parseControlRequest, type ControlAction } from "./buddyControls.ts";
import { REFUSAL_LINE, filingKindFor, gateOrder, refusedRequest, type FilingGate } from "./buddyOrderPolicy.ts";

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
/** Action words that start an order. "do" is one of them, so "Do the new article" is an order. */
const IMPERATIVE =
  /^(tell|ask|have|get|make|set|check|review|look|plan|prepare|sort|draft|find|fix|update|write|schedule|follow|watch|research|compare|list|build|run|keep|put|send|publish|pause|resume|start|stop|pull|do|add|move|swap|place|read|open|close|remove|change|create|edit|share|reply|answer)\b/i;
/** Polite openers that do not change what the owner asked for. Removed before the action word is read. */
const POLITE_OPENER = /^(please|kindly|could you|can you|would you|will you|could we|can we|would you please)\s+/i;
/** A question form at the start: "what", "did", "do you", and so on. */
const QUESTION_START =
  /^(what|which|how|why|who|when|where|did|does|is|are|was|were|do you|do we|do i|have you|have we|has it|has the|is there|are there|can i|should we|should i|tell me|show me)\b/i;
const QUESTION_MARK = /\?\s*$/;

/**
 * "Run the products", "make today's posts", "run today", "daily run". No mind is named: this is the owner's
 * request for the day's run, so it is filed as an order and never asked about. Channel words are not checked
 * here; the order lane holds anything that asks for a channel.
 */
const RUN_DAY =
  /^(please\s+|could you\s+|can you\s+|would you\s+)?((run|start|kick off)\s+(the\s+|today'?s\s+|todays\s+|my\s+|all\s+)?(products?|posts?|jobs?|orders?|day|run|today)\b|(run|start|kick off|make|do)\s+(today'?s\s+|todays\s+|the\s+)(posts?|jobs?|products?|packs?|run)\b|daily run\b)/i;

/** "Make the packs" runs the same day run, so it is a run-today request too. */
const PACKS = /^(please\s+|could you\s+|can you\s+|would you\s+)?(make|run|start|do)\s+(the\s+|today'?s\s+|my\s+)?packs?\b/i;

export function isRunDayRequest(message: string): boolean {
  const core = coreOf(message.trim());
  return RUN_DAY.test(core) || PACKS.test(core);
}

export type Route =
  | { kind: "mind_log"; mind: MindName }
  | { kind: "order"; mind: MindName; instruction: string; resolvesPending: boolean }
  | { kind: "run_day"; instruction: string }
  | { kind: "control"; action: ControlAction; instruction: string }
  | { kind: "control_refused"; line: string }
  | { kind: "refused"; line: string }
  | { kind: "ask_which_mind"; instruction: string }
  | { kind: "how_to"; door: HowToDoor }
  | { kind: "brain_how_to"; brain: BrainId }
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

/** Replies for requests a mind never does, whatever the model would say. Checked before any model call. */
export const NEVER_LIST_LINES = {
  reader: "Buddy does not reply to readers as you. Tell me and I will leave that message for you to answer yourself.",
  spend: "Buddy does not spend money or buy ads. Nothing was bought, and nothing was changed.",
  product: "Buddy does not create shop products. Make it in the shop yourself, then tell me and I can place it on an article.",
  rewrite: "Buddy changes one or two sentences in an article at most, never the whole article. Nothing was changed.",
} as const;

const READER_REPLY = /\b(reply|respond|answer|dm|message|write back)\b[^.?!]*\b(reader|readers|customer|customers|buyer|buyers|commenter|commenters|subscriber|subscribers)\b|\bdm\b/i;
const SPEND = /\b(spend|buy (an? )?ads?|buy advertising|pay for (an? )?ad|ad budget|boost (the |this |a )?post)\b/i;
const CREATE_PRODUCT = /\b(create|add|make|set up|new)\s+(a\s+|an\s+|one\s+)?(new\s+)?(shop\s+)?product\b/i;
const FULL_REWRITE = /\brewrite\b[^.?!]*\b(whole|entire|full|all of)\b|\brewrite (the |this |my |our )?(article|post)\b/i;

/** The plain line for a never-list request, or null when the message is not one. */
export function neverListLine(message: string): string | null {
  if (READER_REPLY.test(message)) return NEVER_LIST_LINES.reader;
  if (SPEND.test(message)) return NEVER_LIST_LINES.spend;
  if (CREATE_PRODUCT.test(message)) return NEVER_LIST_LINES.product;
  if (FULL_REWRITE.test(message)) return NEVER_LIST_LINES.rewrite;
  return null;
}

export function cleanInstruction(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, MAX_ORDER_CHARS);
}

/** The message with polite openers removed, so the action word can be read. */
export function coreOf(message: string): string {
  let text = message.trim();
  let before = "";
  while (before !== text) {
    before = text;
    text = text.replace(POLITE_OPENER, "");
  }
  return text;
}

/** True when the message reads as a question to Buddy, so it is never filed as an order. */
export function isQuestionLike(message: string): boolean {
  const text = message.trim();
  return QUESTION_MARK.test(text) || QUESTION_START.test(coreOf(text));
}

/**
 * Decides what one owner message is, with simple rules only (no key needed).
 * `pending` is an order Buddy is waiting to file once a mind is named.
 * Only one route is returned. When the answer to a pending order arrives, `resolvesPending` is true.
 */
export function routeMessage(message: string, pending: PendingOrder | null): Route {
  const text = message.trim();
  const mind = namedMind(text);
  const question = isQuestionLike(text);
  // A question is never an action, even when it starts with an action word ("Do you know ...?").
  const imperative = !question && IMPERATIVE.test(coreOf(text));
  const words = text.split(/\s+/).filter(Boolean).length;

  if (pending && mind && words <= 5 && !imperative && !question) {
    return { kind: "order", mind, instruction: pending.instruction, resolvesPending: true };
  }
  // Pause, resume, stop or start a door or a mind. A question about one is left to the rules below.
  if (!question) {
    const control = parseControlRequest(text);
    if (control) {
      return control.ok
        ? { kind: "control", action: control.action, instruction: cleanInstruction(text) }
        : { kind: "control_refused", line: control.refusal };
    }
  }
  // Outside the closed list (refunds, deletes, email to the list, reader replies, price changes, posting): one line,
  // nothing filed. Today's run is never refused here, and a question is never refused.
  if (!isRunDayRequest(text) && refusedRequest(text)) return { kind: "refused", line: REFUSAL_LINE };
  if (mind && question && !imperative) return { kind: "mind_log", mind };
  // "How do I connect YouTube?" is answered with fixed steps. A mind named in the same message is left to the rules above.
  if (!mind) {
    const door = howToDoor(text);
    if (door) return { kind: "how_to", door };
    const brain = brainHowTo(text);
    if (brain) return { kind: "brain_how_to", brain };
  }
  // Asking for today's run is an order with no mind to name. It must not fall through to "which mind?".
  if (!mind && !question && isRunDayRequest(text)) return { kind: "run_day", instruction: cleanInstruction(text) };
  if (mind && imperative) return { kind: "order", mind, instruction: cleanInstruction(text), resolvesPending: false };
  if (!mind && imperative && !question) return { kind: "ask_which_mind", instruction: cleanInstruction(text) };
  return { kind: "chat" };
}

/** The closed-list kind a routed message would file as. Control requests split into their two kinds. */
function controlKind(action: ControlAction): string {
  return action.kind === "pause_door" || action.kind === "resume_door" ? "pause_resume_free_door" : "kill_or_start_mind";
}

/**
 * The gate every routed order passes before anything is saved. Null for routes that file nothing.
 * A route that would file outside the closed list, or whose words are an outside request, is refused here.
 */
export function routeFilingGate(route: Route): FilingGate | null {
  if (route.kind === "order") return gateOrder(filingKindFor(route.instruction), route.instruction);
  if (route.kind === "run_day") return gateOrder("run_today", route.instruction);
  if (route.kind === "control") return gateOrder(controlKind(route.action), route.instruction);
  return null;
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
