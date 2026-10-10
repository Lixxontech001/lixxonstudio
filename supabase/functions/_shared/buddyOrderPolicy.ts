// Buddy's closed list of orders, and the one refusal line for everything else.
// Pure rules: no database, no model. The router uses it for the owner's words, and the chat path uses it for an
// order the model proposes. A refused request is never filed, so it can never sit as a silent maybe.

/** The only kinds of order Buddy may run or file. Anything else is refused. */
export const ALLOWED_ORDERS = [
  "run_today", // run today, or make the packs (the day run)
  "pause_resume_free_door", // pause or resume one free door
  "kill_or_start_mind", // stop or start one mind, or all of them; never the Auditor
  "product_line_apply", // place an existing shop product on an article (the placement run does it)
  "mind_work", // ask a named mind to look at, plan, check, draft or review; it files and waits
] as const;
export type AllowedOrder = (typeof ALLOWED_ORDERS)[number];

/** The one kind of order a model may file: a named mind asked to do work. The other kinds come only from owner rules. */
export const MODEL_FILEABLE_ORDER: AllowedOrder = "mind_work";

/** Reads a kind from a model answer. Anything not on the closed list is null, so it is never filed. */
export function closedOrderKind(value: unknown): AllowedOrder | null {
  return typeof value === "string" && (ALLOWED_ORDERS as readonly string[]).includes(value) ? (value as AllowedOrder) : null;
}

export const REFUSAL_LINE =
  "Buddy will not do that. Refunds, deletes, emails to your list, replies to readers, price changes, and posting or publishing stay with you. Nothing was filed or changed.";

/** A question about one of these is answered as a question. Only a request is refused. */
const QUESTION_OPENER = /^\s*(please\s+)?(what|which|how|why|who|when|where|did|does|is|are|was|were|tell me|show me)\b/i;

/** True when the text reads as a question. A question is answered, never filed. */
export function isQuestionText(text: string): boolean {
  const trimmed = text.trim();
  return /\?\s*$/.test(trimmed) || QUESTION_OPENER.test(trimmed);
}

/** Requests outside the closed list. Each pattern names the action and what it touches. */
const REFUSED_REQUESTS: RegExp[] = [
  /\brefund(s|ed|ing)?\b/i,
  /\b(delete|erase|trash|remove)\b[^.?!]*\b(article|post|page|product|comment|comments|draft|image|picture|video|order)s?\b/i,
  /\b(email|e-mail|newsletter|blast|mail)\b[^.?!]*\b(list|subscribers?|readers?|customers?|everyone|followers?|members?)\b/i,
  /\b(reply|respond|answer|write back)\b[^.?!]*\b(comments?|reviews?|messages?|readers?|customers?|buyers?|subscribers?)\b/i,
  /\b(change|set|raise|lower|cut|drop|update|discount|reduce|increase)\b[^.?!]*\bprices?\b/i,
  /\bprices?\b[^.?!]*\b(change|set|raise|lower|cut|drop|update|discount|reduce|increase)\b/i,
  /\b(publish|post|send|share|tweet)\b[^.?!]*\b(now|right away|immediately|this|it|article|post)\b/i,
];

/** A request starts with the action word (after a name or \"please\"), or asks for it outright. */
const REQUEST_START = /^(refund|delete|erase|trash|remove|email|e-mail|mail|blast|reply|respond|answer|change|set|raise|lower|cut|drop|update|discount|reduce|increase|publish|post|send|share|tweet)\b/i;
const REQUEST_MARK = /\b(can|could|would|will) you\b|\bplease\b|\bi (want|need) (you )?to\b|\blet'?s\b|\bgo ahead\b/i;
/**
 * Phase E: an outside action asked for after "and", "then", a comma or a semicolon ("Swap the kit onto the article and
 * email the list"). Only the words that the refused patterns are about. Narrows what is filed; adds no kind.
 */
const REQUEST_CLAUSE = /(\band\b|\bthen\b|[,;])\s*(refund|delete|erase|trash|email|e-mail|blast|reply|respond|change|set|raise|lower|cut|drop|update|discount|reduce|increase|publish|tweet)\b/i;

/** True when the message asks for something outside the closed list. Questions and plain statements are never refused. */
export function refusedRequest(message: string): boolean {
  const text = message.trim();
  if (!text || QUESTION_OPENER.test(text)) return false;
  const body = text.replace(/^[A-Za-z]+,\s*/, "");
  if (!REQUEST_START.test(body) && !REQUEST_MARK.test(text) && !REQUEST_CLAUSE.test(text)) return false;
  return REFUSED_REQUESTS.some((pattern) => pattern.test(text));
}

/**
 * `line` is the owner-facing refusal. It is null for a question: a question is answered, never filed, and gets no refusal.
 */
export type FilingGate = { ok: true; kind: AllowedOrder } | { ok: false; line: string | null };

/**
 * The one gate every filed order passes (router, model answer, or any other route into the waiting list).
 * An order is filed only when its kind is on the closed list, its text is not an outside request, and it is not a
 * question. Anything else is not saved: an outside request or an off-list kind gets REFUSAL_LINE, a question gets none.
 */
export function gateOrder(kind: unknown, instruction: string): FilingGate {
  if (isQuestionText(instruction)) return { ok: false, line: null };
  const closed = closedOrderKind(kind);
  if (!closed) return { ok: false, line: REFUSAL_LINE };
  if (refusedRequest(instruction)) return { ok: false, line: REFUSAL_LINE };
  return { ok: true, kind: closed };
}

/**
 * A swap, or a placement of a shop product onto an article, is the product_line_apply kind. Anything else a mind is
 * asked to do is mind_work. The lane (buddyOrders) still decides whether the run may take it.
 */
const PRODUCT_LINE_APPLY = /\b(swap|replace|put|place|add)\b[^.?!]*\b(onto|on to|into|in|on|to)\b[^.?!]*\b(article|articles|post|guide|blog|page)\b/i;
export function filingKindFor(instruction: string): AllowedOrder {
  return PRODUCT_LINE_APPLY.test(instruction) ? "product_line_apply" : MODEL_FILEABLE_ORDER;
}

/** A model may file only mind_work. The other four kinds come from the owner's own words, never from a model reply. */
export function gateModelOrder(kind: unknown, instruction: string): FilingGate {
  const gate = gateOrder(kind, instruction);
  if (!gate.ok) return gate;
  return gate.kind === MODEL_FILEABLE_ORDER ? gate : { ok: false, line: REFUSAL_LINE };
}
