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

/** A model order with no kind, or a kind only the owner's own words can start. Nothing is filed. */
export const NOT_ON_LIST_LINE =
  "Buddy can only file work for a named mind from here. Nothing was filed or changed. Name the mind and say what you want done.";

/** A question about one of these is answered as a question. Only a request is refused. */
const QUESTION_OPENER = /^\s*(please\s+)?(what|which|how|why|who|when|where|did|does|is|are|was|were|tell me|show me)\b/i;

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

/** True when the message asks for something outside the closed list. Questions and plain statements are never refused. */
export function refusedRequest(message: string): boolean {
  const text = message.trim();
  if (!text || QUESTION_OPENER.test(text)) return false;
  const body = text.replace(/^[A-Za-z]+,\s*/, "");
  if (!REQUEST_START.test(body) && !REQUEST_MARK.test(text)) return false;
  return REFUSED_REQUESTS.some((pattern) => pattern.test(text));
}
