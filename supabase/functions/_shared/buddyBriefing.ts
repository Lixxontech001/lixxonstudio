// Buddy's morning briefing rules. Pure logic: the facts come in already read from the database.
// Rule: say "quiet" only when every source was read and none had anything real to report.

import { MIND_KEYS, MIND_LABELS } from "./buddyRouter.ts";

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
}

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

function problemLines(failures: BriefingFacts["failures"]): string[] {
  if (!failures.ok) return ["I cannot read the error log yet."];
  if (failures.count === 0) return ["No errors since you left."];
  const codes = failures.codes.length ? ` (${failures.codes.join(", ")})` : "";
  return [`${failures.count} failed automation ${plural(failures.count, "step", "steps")} since you left${codes}.`];
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

function jobLines(waiting: BriefingFacts["waiting"]): string[] {
  if (!waiting) return ["I cannot read your orders yet."];
  if (!waiting.ok) return ["I cannot read your orders yet."];
  if (waiting.count === 0) return ["No orders waiting."];
  return [`${waiting.count} ${plural(waiting.count, "order", "orders")} waiting for you.`];
}

function nextMove(facts: BriefingFacts): string {
  const anyUnread = !facts.articles.ok || !facts.orders.ok || !facts.views.ok || !facts.failures.ok;
  if (anyUnread) return "Some numbers could not be read. Ask me again in a little while.";
  if (facts.failures.count > 0) return "Look at the problems above before anything else.";
  if (facts.orders.paidCount > 0) return "Check the new paid orders in Admin.";
  if (facts.articles.count > 0) return "Read the new articles once, as a reader would.";
  return "Nothing needs you right now.";
}

export function buildBriefing(facts: BriefingFacts, now: Date, sinceIso: string, firstVisit: boolean): BriefingResult {
  // The minds' log is part of "all read" once it is supplied. The database read always supplies it.
  const mindsRead = facts.minds ? facts.minds.ok : true;
  const waitingRead = facts.waiting ? facts.waiting.ok : true;
  const allRead = facts.articles.ok && facts.orders.ok && facts.views.ok && facts.failures.ok && mindsRead && waitingRead;
  const mindsReal = (facts.minds?.rows ?? []).some((row) => REAL_OUTCOMES.includes(row.outcome));
  // An order still waiting for the owner is not quiet, even when nothing else happened.
  const ordersWaiting = (facts.waiting?.count ?? 0) > 0;
  const nothingReal = facts.articles.count === 0 && facts.orders.paidCount === 0 && facts.failures.count === 0 && !mindsReal && !ordersWaiting;
  if (allRead && nothingReal) return { quiet: true, sections: [], text: QUIET_LINE };

  const awayMs = now.getTime() - Date.parse(sinceIso);
  const went = ["Nothing yet. Takeover is off."];
  const article = articleLine(facts.articles);
  if (article) went.push(article);

  const sections: BriefingSection[] = [
    {
      id: "since",
      title: "Since you left",
      lines: [firstVisit ? `First visit here. Buddy looks back ${FIRST_VISIT_WINDOW_HOURS} hours.` : `You were away for ${describeAway(awayMs)}.`],
    },
    { id: "went_out", title: "What went out", lines: went },
    { id: "money", title: "Money & readers", lines: moneyLines(facts) },
    { id: "minds", title: "The five minds", lines: mindLines(facts.minds) },
    { id: "problems", title: "Problems", lines: problemLines(facts.failures) },
    { id: "jobs", title: "Your jobs", lines: jobLines(facts.waiting) },
    { id: "next", title: "Your next move", lines: [nextMove(facts)] },
  ];

  return { quiet: false, sections, text: briefingText(sections) };
}

/** The plain-text version of a briefing, kept in the chat so Buddy can refer back to it. */
export function briefingText(sections: BriefingSection[]): string {
  return sections.map((section) => `${section.title}: ${section.lines.join(" ")}`).join("\n");
}
