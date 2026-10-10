// Buddy's morning briefing rules. Pure logic: the facts come in already read from the database.
// Rule: say "quiet" only when every source was read and none had anything real to report.

import { MIND_KEYS, MIND_LABELS } from "./buddyRouter.ts";
import { DOORS, isDoorId } from "./doorRegistry.ts";
import { HONEST_SKIP_LINE_LIMIT, isHonestSkip } from "./honestSkips.ts";
import { isRssDoor } from "./rssHub.ts";

export const QUIET_LINE = "Quiet since you left.";
/** A first visit has no earlier "left" time, so Buddy looks back this far. */
export const FIRST_VISIT_WINDOW_HOURS = 24;

export interface BriefingMindRow {
  happened_at: string;
  mind: string;
  action: string;
  outcome: string;
  detail: string;
}

export interface BriefingFacts {
  articles: { ok: boolean; count: number; titles: string[] };
  orders: { ok: boolean; paidCount: number; usdTotal: number };
  views: { ok: boolean; count: number };
  failures: { ok: boolean; count: number; codes: string[] };
  /** The minds' daily log since the owner last looked, newest first. */
  minds?: { ok: boolean; rows: BriefingMindRow[] };
  /** The owner's orders still waiting (not since last seen: waiting orders stay waiting). */
  waiting?: { ok: boolean; count: number };
  /** Article changes the minds made since the owner last looked, newest first. */
  applied?: { ok: boolean; rows: BriefingApplied[] };
  /** Product gaps not yet marked seen. Each one asks the owner to create a product. */
  gaps?: { ok: boolean; rows: BriefingGap[] };
  /** The owner's recent packs that still need him (ready to post by hand, or blocked). Owner session. */
  packs?: { ok: boolean; rows: BriefingPack[] };
  /** The free-door send log since the owner last looked, newest first (the real record of what went out). */
  doors?: { ok: boolean; rows: BriefingDoorPost[] };
  /** The notable events the minds wrote since the owner last looked, newest first. Only the briefing's kinds. */
  notables?: { ok: boolean; rows: BriefingNotable[] };
  /** How many reader form messages arrived since the owner last looked. A count only: never a name, an address or the text. */
  messages?: { ok: boolean; count: number };
}

/** One notable event the briefing can show. Plain fields only: its kind, its title and its detail. */
export interface BriefingNotable {
  kind: string;
  title: string;
  detail: string;
}

/** The notable kinds the briefing reads. Summary kinds written for later reading are never listed, so they cannot become the morning briefing. */
export const BRIEFING_NOTABLE_KINDS: readonly string[] = [
  "takeover_changed",
  "kill_changed",
  "door_posted",
  "sale",
  "product_click",
  "traffic_new_kind",
  "auditor_blocked",
  "order_blocked",
  "pack_ready",
  "door_failed",
  "mind_failed",
];
const WENT_OUT_NOTABLE_KINDS = ["door_posted"];
const MONEY_NOTABLE_KINDS = ["sale", "product_click", "traffic_new_kind"];
const JOB_NOTABLE_KINDS = ["order_blocked"];
// The Auditor holding a change, a door that failed and a mind that failed all belong under Problems.
const PROBLEM_NOTABLE_KINDS = ["auditor_blocked", "door_failed", "mind_failed"];
// Takeover and Kill switch changes are part of what happened since you left.
const SINCE_NOTABLE_KINDS = ["takeover_changed", "kill_changed"];
export const NOTABLE_LINE_LIMIT = 3;

/** One door post the owner can see. `status` is the send log's own word: queued, posted or failed. */
export interface BriefingDoorPost {
  door: string;
  status: "queued" | "posted" | "failed";
  postTitle: string;
  errorNote: string | null;
}

export const NOTHING_SENT_LINE = "No mind has sent anything out.";
export const DOOR_LINE_LIMIT = 8;
const DOOR_NOTE_LIMIT = 200;

/** One pack the owner can act on. Only plain fields: the channel, the article title and why it is blocked. */
export interface BriefingPack {
  channel: string;
  status: string;
  articleTitle: string;
  blockedReason: string | null;
}

export interface BriefingApplied {
  postTitle: string;
  productNames: string[];
}

export interface BriefingGap {
  angle: string;
}

export const APPLIED_LINE_LIMIT = 5;
export const GAP_LINE_LIMIT = 3;
export const PACK_LINE_LIMIT = 3;

const PACK_CHANNEL_NAMES: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  pinterest: "Pinterest",
};

export interface BriefingSection {
  id: string;
  title: string;
  lines: string[];
}

export type BriefingResult =
  | { quiet: true; sections: []; text: string }
  | { quiet: false; sections: BriefingSection[]; text: string };

/** Plain words for how long Buddy was away. Never a clock time, never a country. */
export function describeAway(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 60) return "less than an hour";
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours === 1 ? "about 1 hour" : `about ${hours} hours`;
  return `about ${Math.floor(hours / 24)} days`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function articleLine(articles: BriefingFacts["articles"]): string | null {
  if (!articles.ok) return "I cannot read the new articles yet.";
  if (articles.count === 0) return null;
  const titles = articles.titles.map((title) => `"${title}"`).join(", ");
  const more = articles.count > articles.titles.length ? ` and ${articles.count - articles.titles.length} more` : "";
  return `${articles.count} new ${plural(articles.count, "article is", "articles are")} live: ${titles}${more}.`;
}

/** One line for the reader form messages. The briefing says there is one; the owner reads it in Admin. Buddy never replies. */
export function messageLines(messages: BriefingFacts["messages"]): string[] {
  if (!messages) return [];
  if (!messages.ok) return ["I cannot read your messages yet."];
  if (messages.count === 0) return [];
  if (messages.count === 1) return ["There is a message for you."];
  return [`There are ${messages.count} messages for you.`];
}

function moneyLines(facts: BriefingFacts): string[] {
  const lines: string[] = [];
  if (!facts.orders.ok) {
    lines.push("I cannot read orders yet.");
  } else if (facts.orders.paidCount === 0) {
    lines.push("No paid orders since you left.");
  } else {
    const total = facts.orders.usdTotal.toFixed(2);
    lines.push(`${facts.orders.paidCount} paid ${plural(facts.orders.paidCount, "order", "orders")} since you left, USD ${total} in total.`);
  }
  if (!facts.views.ok) {
    lines.push("I cannot read article views yet.");
  } else if (facts.views.count === 0) {
    lines.push("No article views since you left.");
  } else {
    lines.push(`${facts.views.count} article ${plural(facts.views.count, "view", "views")} since you left.`);
  }
  return lines;
}

/** The honest skips and closed doors since the owner last looked, plus blocked packs. Plain words, never a guess. */
function honestProblemLines(minds: BriefingMindRow[], packs: BriefingPack[]): string[] {
  const lines: string[] = [];
  for (const row of minds) {
    const text = row.detail.trim();
    if (text && isHonestSkip(text) && !lines.includes(text)) lines.push(text);
  }
  for (const pack of packs) {
    if (pack.status !== "blocked" || !pack.blockedReason) continue;
    const line = `${pack.channel} for "${pack.articleTitle}": ${pack.blockedReason}`;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines.slice(0, HONEST_SKIP_LINE_LIMIT);
}

/** Maps the notable rows the server read into the briefing's shape. Kinds the briefing does not read are dropped. */
export function briefingNotables(rows: Array<{ kind?: unknown; title?: unknown; detail?: unknown }>): BriefingNotable[] {
  return rows
    .filter((row) => typeof row.kind === "string" && BRIEFING_NOTABLE_KINDS.includes(row.kind) && typeof row.title === "string" && row.title.trim().length > 0)
    .map((row) => ({ kind: String(row.kind), title: String(row.title), detail: typeof row.detail === "string" ? row.detail : "" }));
}

/** One plain line per notable of the given kinds, newest first. A door failure shows its own sentence, which names the door. */
function notableLines(notables: BriefingFacts["notables"], kinds: string[]): string[] {
  if (!notables || !notables.ok) return [];
  return notables.rows
    .filter((row) => kinds.includes(row.kind))
    .slice(0, NOTABLE_LINE_LIMIT)
    .map((row) => {
      const detail = row.detail.trim();
      if (row.kind === "door_failed" && detail) return detail.slice(0, DOOR_NOTE_LIMIT);
      return `${clipTitle(row.title).replace(/[.!?]+$/, "")}.`;
    });
}

function problemLines(failures: BriefingFacts["failures"], minds: BriefingMindRow[], packs: BriefingPack[], notables: BriefingFacts["notables"]): string[] {
  const honest = [...honestProblemLines(minds, packs), ...notableLines(notables, PROBLEM_NOTABLE_KINDS)];
  if (notables && !notables.ok) honest.push("I cannot read the notable events yet.");
  if (!failures.ok) return ["I cannot read the error log yet.", ...honest];
  if (failures.count === 0) return honest.length > 0 ? honest : ["No errors since you left."];
  const codes = failures.codes.length ? ` (${failures.codes.join(", ")})` : "";
  return [`${failures.count} failed automation ${plural(failures.count, "step", "steps")} since you left${codes}.`, ...honest];
}

const REAL_OUTCOMES = ["done", "blocked", "failed"];

/** One line per mind: its newest action since you left. Honest about a missing log and an empty one. */
function mindLines(minds: BriefingFacts["minds"]): string[] {
  if (!minds || !minds.ok) return ["I cannot read the minds' log yet."];
  if (minds.rows.length === 0) return ["No mind has logged anything since you left."];
  const lines: string[] = [];
  for (const key of MIND_KEYS) {
    const row = minds.rows.find((item) => item.mind === key);
    if (!row) continue;
    const outcome = row.outcome.charAt(0).toUpperCase() + row.outcome.slice(1);
    const detail = row.detail.trim() ? ` ${row.detail.trim()}` : "";
    lines.push(`${MIND_LABELS[key]}: ${row.action}. ${outcome}.${detail}`);
  }
  if (lines.length === 0) return ["No mind has logged anything since you left."];
  return lines.slice(0, 5);
}

/** One line per pack that needs the owner: ready to post by hand, or blocked with its plain reason. */
export function packLines(packs: BriefingFacts["packs"]): string[] {
  if (!packs) return [];
  if (!packs.ok) return ["I cannot read your packs yet."];
  return packs.rows.slice(0, PACK_LINE_LIMIT).map((row) => {
    const name = PACK_CHANNEL_NAMES[row.channel] || "A channel";
    const title = clipTitle(row.articleTitle);
    if (row.status === "ready") return `${name} pack for "${title}" is ready to post by hand.`;
    const reason = (row.blockedReason || "it is blocked").replace(/[.!?]+$/, "");
    return `${name} pack for "${title}" is blocked: ${reason}.`;
  });
}

function jobLines(waiting: BriefingFacts["waiting"], gaps: BriefingFacts["gaps"], packs: BriefingFacts["packs"], notables: BriefingFacts["notables"]): string[] {
  const lines: string[] = [];
  if (!waiting || !waiting.ok) lines.push("I cannot read your orders yet.");
  else if (waiting.count === 0) lines.push("No orders waiting.");
  else lines.push(`${waiting.count} ${plural(waiting.count, "order", "orders")} waiting for you.`);
  lines.push(...packLines(packs));
  lines.push(...notableLines(notables, JOB_NOTABLE_KINDS));
  if (!gaps) return lines;
  if (!gaps.ok) return [...lines, "I cannot read the product gaps yet."];
  for (const gap of gaps.rows.slice(0, GAP_LINE_LIMIT)) {
    lines.push(`No product fits "${clipTitle(gap.angle)}" yet. Create one in the shop, then ask me again.`);
  }
  return lines;
}

/** Maps the pack rows the server read into the briefing's shape. A missing title is a plain fallback, never guessed. */
export function briefingPacks(rows: Array<{ channel?: unknown; status?: unknown; blocked_reason?: unknown; post_id?: unknown }>, postTitles: Record<string, string>): BriefingPack[] {
  return rows
    .filter((row) => typeof row.channel === "string" && (row.status === "ready" || row.status === "blocked"))
    .map((row) => ({
      channel: String(row.channel),
      status: String(row.status),
      articleTitle: postTitles[String(row.post_id || "")] || "an article",
      blockedReason: typeof row.blocked_reason === "string" ? row.blocked_reason : null,
    }));
}

function clipTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

/** One chief-of-staff line per article change. Only what the database recorded: the title and the product names. */
export function appliedLines(applied: BriefingFacts["applied"]): string[] {
  if (!applied) return [];
  if (!applied.ok) return ["I cannot read the article changes yet."];
  return applied.rows.slice(0, APPLIED_LINE_LIMIT).map((row) => {
    const names = row.productNames.length ? row.productNames.join(", ") : "a product";
    return `I added ${names} to "${clipTitle(row.postTitle)}". One paragraph changed.`;
  });
}

/** Maps the rows the server read into the briefing's shape. A missing title or name is shown as a plain fallback, never guessed. */
export function briefingApplied(
  edits: Array<{ post_id: unknown; product_ids: unknown }>,
  postTitles: Record<string, string>,
  productNames: Record<string, string>,
): BriefingApplied[] {
  return edits
    .filter((edit) => typeof edit.post_id === "string")
    .map((edit) => {
      const ids = Array.isArray(edit.product_ids) ? edit.product_ids.filter((id): id is string => typeof id === "string") : [];
      return {
        postTitle: postTitles[String(edit.post_id)] || "an article",
        productNames: ids.map((id) => productNames[id]).filter((name): name is string => Boolean(name)),
      };
    });
}

/** Keeps the angle of each open gap note. Rows without a text angle are dropped. */
export function briefingGaps(rows: Array<{ angle: unknown }>): BriefingGap[] {
  return rows.filter((row) => typeof row.angle === "string" && row.angle.trim().length > 0).map((row) => ({ angle: String(row.angle) }));
}

/** One plain line for one door post. Only the door's label, the article title and the send log's note are used. */
function doorPostLine(row: BriefingDoorPost): string {
  const label = isDoorId(row.door) ? DOORS[row.door].label : "A free door";
  const title = `"${clipTitle(row.postTitle)}"`;
  // An RSS door only pings the hub: the feed was updated and the hub was told. It never posts anywhere.
  if (row.status === "posted") return isRssDoor(row.door) ? `RSS updated and pinged for ${label}: ${title}.` : `Posted to ${label}: ${title}.`;
  if (row.status === "failed") {
    const note = row.errorNote ? row.errorNote.slice(0, DOOR_NOTE_LIMIT) : "Nothing was posted.";
    if (isRssDoor(row.door)) return `${label} did not take the ping for ${title}. ${note}`;
    return `${label} did not post ${title}. ${note}`;
  }
  return `${label} is still saving a post for ${title}.`;
}

/**
 * The first lines of "What went out", from the door send log. A failed read says so. No read asked for, or no post
 * in the log, shows the nothing-sent line. The line is never shown above a real posted row.
 */
export function doorSentLines(doors: BriefingFacts["doors"]): string[] {
  if (!doors) return [NOTHING_SENT_LINE];
  if (!doors.ok) return ["I cannot read the send log just now."];
  const rows = doors.rows.slice(0, DOOR_LINE_LIMIT);
  const lines = rows.map(doorPostLine);
  if (!rows.some((row) => row.status === "posted")) lines.unshift(NOTHING_SENT_LINE);
  return lines;
}

/** Maps the send log rows the server read into the briefing's shape. A missing title is a plain fallback, never guessed. */
export function briefingDoors(
  rows: Array<{ door?: unknown; status?: unknown; post_id?: unknown; error_note?: unknown }>,
  postTitles: Record<string, string>,
): BriefingDoorPost[] {
  const out: BriefingDoorPost[] = [];
  for (const row of rows) {
    const status = row.status;
    if (!isDoorId(row.door)) continue;
    if (status !== "queued" && status !== "posted" && status !== "failed") continue;
    out.push({
      door: row.door,
      status,
      postTitle: postTitles[String(row.post_id)] || "an article",
      errorNote: typeof row.error_note === "string" && row.error_note.trim() ? row.error_note : null,
    });
  }
  return out;
}

function nextMove(facts: BriefingFacts): string {
  const anyUnread = !facts.articles.ok || !facts.orders.ok || !facts.views.ok || !facts.failures.ok || (facts.notables ? !facts.notables.ok : false);
  if (anyUnread) return "Some numbers could not be read. Ask me again in a little while.";
  if (facts.failures.count > 0 || notableLines(facts.notables, PROBLEM_NOTABLE_KINDS).length > 0) return "Look at the problems above before anything else.";
  if (facts.orders.paidCount > 0) return "Check the new paid orders in Admin.";
  if (facts.messages && facts.messages.count > 0) return "Read the new reader message in Admin.";
  if (notableLines(facts.notables, ["pack_ready"]).length > 0) return "Post the ready pack by hand, then tap I posted this.";
  if (facts.articles.count > 0) return "Read the new articles once, as a reader would.";
  return "Nothing needs you right now.";
}

export function buildBriefing(facts: BriefingFacts, now: Date, sinceIso: string, firstVisit: boolean): BriefingResult {
  // The minds' log is part of "all read" once it is supplied. The database read always supplies it.
  const mindsRead = facts.minds ? facts.minds.ok : true;
  const waitingRead = facts.waiting ? facts.waiting.ok : true;
  const appliedRead = facts.applied ? facts.applied.ok : true;
  const gapsRead = facts.gaps ? facts.gaps.ok : true;
  const packsRead = facts.packs ? facts.packs.ok : true;
  const doorsRead = facts.doors ? facts.doors.ok : true;
  const notablesRead = facts.notables ? facts.notables.ok : true;
  const messagesRead = facts.messages ? facts.messages.ok : true;
  const allRead = facts.articles.ok && facts.orders.ok && facts.views.ok && facts.failures.ok && mindsRead && waitingRead && appliedRead && gapsRead && packsRead && doorsRead && notablesRead && messagesRead;
  // A door post that went out, failed or is still saving is news, so the day is not quiet.
  const doorsReal = (facts.doors?.rows.length ?? 0) > 0;
  // An honest skip or a closed door is a problem the owner should see, so it also keeps the day from being quiet.
  const mindsReal = (facts.minds?.rows ?? []).some((row) => REAL_OUTCOMES.includes(row.outcome) || isHonestSkip(row.detail));
  // An order still waiting for the owner is not quiet, even when nothing else happened.
  const ordersWaiting = (facts.waiting?.count ?? 0) > 0;
  // An article change or an open product gap is real news too, so the day is not quiet.
  const changesReal = (facts.applied?.rows.length ?? 0) > 0 || (facts.gaps?.rows.length ?? 0) > 0;
  // A pack ready to post by hand, or blocked, is something the owner needs to see, so the day is not quiet.
  const packsReal = (facts.packs?.rows.length ?? 0) > 0;
  // A notable the minds wrote since the owner last looked (a sale, a door failure, a blocked job) is news too.
  const notablesReal = (facts.notables?.rows ?? []).some((row) => BRIEFING_NOTABLE_KINDS.includes(row.kind));
  // A reader's form message is something the owner should read, so it is not quiet either.
  const messagesReal = (facts.messages?.count ?? 0) > 0;
  const nothingReal =
    facts.articles.count === 0 && facts.orders.paidCount === 0 && facts.failures.count === 0 && !mindsReal && !ordersWaiting && !changesReal && !packsReal && !doorsReal && !notablesReal && !messagesReal;
  if (allRead && nothingReal) return { quiet: true, sections: [], text: QUIET_LINE };

  const awayMs = now.getTime() - Date.parse(sinceIso);
  // The door send log decides the first lines. "No mind has sent anything out" is shown only when no door post went out.
  const went = doorSentLines(facts.doors);
  const article = articleLine(facts.articles);
  if (article) went.push(article);
  went.push(...appliedLines(facts.applied));
  went.push(...notableLines(facts.notables, WENT_OUT_NOTABLE_KINDS));

  const sections: BriefingSection[] = [
    {
      id: "since",
      title: "Since you left",
      lines: [firstVisit ? `First visit here. Buddy looks back ${FIRST_VISIT_WINDOW_HOURS} hours.` : `You were away for ${describeAway(awayMs)}.`, ...notableLines(facts.notables, SINCE_NOTABLE_KINDS)],
    },
    { id: "went_out", title: "What went out", lines: went },
    { id: "money", title: "Money & readers", lines: [...moneyLines(facts), ...messageLines(facts.messages), ...notableLines(facts.notables, MONEY_NOTABLE_KINDS)] },
    { id: "minds", title: "The five minds", lines: mindLines(facts.minds) },
    { id: "problems", title: "Problems", lines: problemLines(facts.failures, facts.minds?.rows ?? [], facts.packs?.rows ?? [], facts.notables) },
    { id: "jobs", title: "Your jobs", lines: jobLines(facts.waiting, facts.gaps, facts.packs, facts.notables) },
    { id: "next", title: "Your next move", lines: [nextMove(facts)] },
  ];

  return { quiet: false, sections, text: briefingText(sections) };
}

/** The plain-text version of a briefing, kept in the chat so Buddy can refer back to it. */
export function briefingText(sections: BriefingSection[]): string {
  return sections.map((section) => `${section.title}: ${section.lines.join(" ")}`).join("\n");
}
