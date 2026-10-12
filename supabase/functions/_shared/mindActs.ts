// Phase I slice 3: every act is told four ways. One daily-log row, one notable event (which buzzes the owner's
// phone), one line in the morning briefing, and one line in the night report. The briefing and the night report both
// read the notable events, so an act that writes its row and its notable is told in all four places. This file is the
// one list of acts and the one place their plain words are written: a new act cannot be told three ways out of four,
// because the words and the telling live together.
//
// Rules kept here: English only, no engine words, no country, no city, no currency other than US dollars.
// Pure logic: no database, no Deno globals, so it runs under Vitest.

export const ACT_KINDS = ["door_posted", "door_skipped", "price_changed", "pack_saved", "product_looks_dead", "auditor_blocked"] as const;
export type ActKind = (typeof ACT_KINDS)[number];

/** The mind that did the act, as the daily log names it. */
export type ActMind = "analyst" | "strategist" | "ceo" | "executioner" | "auditor";

export interface ActWords {
  kind: ActKind;
  mind: ActMind;
  /** The daily-log action, and the sentence the notable title opens with. */
  action: string;
  /** The notable title: this is what the phone shows. */
  title: string;
  /** The notable detail and the log row's detail. The same words in both, so the log and the phone agree. */
  detail: string;
  /** The log outcome. An act that happened is done; a step that did not run is skipped; a held change is blocked. */
  outcome: "done" | "skipped" | "blocked" | "failed";
  /** Writes this act once per owner. Null when the act may happen more than once in a day. */
  key: string | null;
}

const clip = (value: string, limit: number): string => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

/** Money, always in US dollars, with the dollar sign. Two decimals, because a price is written to the cent. */
export function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * A door posted the day's article. `fromArchive` is true when the article is older than the seven-day window:
 * it went out because nothing new was published, and the telling says so rather than calling it new.
 */
export function doorPostedAct(doorLabel: string, articleTitle: string, day: string, fromArchive = false): ActWords {
  const archive = fromArchive ? " from the archive" : "";
  const detail = fromArchive
    ? "This one is older than a week. Nothing new was published in the last 7 days, so an older article went out. The post is live and it is in the log with the day it went out."
    : "The post is live. It is in the log with the day it went out.";
  return {
    kind: "door_posted",
    mind: "executioner",
    action: `Posted to ${doorLabel}`,
    title: `${doorLabel}: posted "${clip(articleTitle, 80)}"${archive}`,
    detail,
    outcome: "done",
    key: `door_posted:${doorLabel}:${day}`,
  };
}

/** A door did not post today, with its own plain reason. Skipping is an act too: it is never silent. */
export function doorSkippedAct(doorLabel: string, reason: string, day: string): ActWords {
  return {
    kind: "door_skipped",
    mind: "executioner",
    action: `Nothing went out to ${doorLabel}`,
    title: `${doorLabel}: nothing went out today`,
    detail: clip(reason, 400),
    outcome: "skipped",
    key: `door_skipped:${doorLabel}:${day}`,
  };
}

/** A shop price changed, in US dollars. The old price and the new one are both named. */
export function priceChangedAct(productName: string, fromUsd: number, toUsd: number, day: string): ActWords {
  return {
    kind: "price_changed",
    mind: "executioner",
    action: `Changed the price of "${clip(productName, 60)}"`,
    title: `Price changed: "${clip(productName, 60)}" is now ${usd(toUsd)}`,
    detail: `It was ${usd(fromUsd)} and it is now ${usd(toUsd)}. The shop shows the new price.`,
    outcome: "done",
    key: `price_changed:${productName}:${day}`,
  };
}

/** The packs step saved packs for the day. Ready ones wait for the owner's hand; blocked ones say why. */
export function packSavedAct(ready: number, blocked: number, day: string): ActWords {
  const saved = ready + blocked;
  const readyLine = ready === 0
    ? "None is ready to post yet."
    : `${ready} ${ready === 1 ? "is" : "are"} ready for you to post by hand.`;
  const blockedLine = blocked === 0 ? "" : ` ${blocked} ${blocked === 1 ? "is" : "are"} blocked, and the reason is on each one.`;
  return {
    kind: "pack_saved",
    mind: "executioner",
    action: "Saved the day's packs",
    title: `${saved} ${saved === 1 ? "pack" : "packs"} saved today`,
    detail: `The packs are saved for ${day}. ${readyLine}${blockedLine} Nothing was posted for you.`,
    outcome: saved > 0 ? "done" : "skipped",
    key: `pack_saved:${day}`,
  };
}

/** The Strategist's own finding: a product that looks dead, from this week and last week of paid orders. Never a delete. */
export function productLooksDeadAct(productName: string, thisWeek: number, lastWeek: number, day: string): ActWords {
  return {
    kind: "product_looks_dead",
    mind: "strategist",
    action: `"${clip(productName, 60)}" looks dead`,
    title: `Looks dead: "${clip(productName, 60)}"`,
    detail: `Paid orders: ${thisWeek} this week and ${lastWeek} last week. Nothing was deleted. You decide: write an article that fits it, or make a new product yourself.`,
    outcome: "done",
    key: `product_looks_dead:${productName}:${day}`,
  };
}

/** The Auditor held a change. It is logged with the plain reason, and the owner is told. */
export function auditorBlockedAct(articleTitle: string, fix: string): ActWords {
  return {
    kind: "auditor_blocked",
    mind: "auditor",
    action: `Blocked a change to "${clip(articleTitle, 80)}"`,
    title: `Auditor blocked a change to "${clip(articleTitle, 80)}"`,
    detail: clip(fix, 400),
    outcome: "blocked",
    key: null,
  };
}

/** Everything the acts need: the daily log and the notable events (which buzz the phone). */
export interface ActPorts {
  log(entry: { mind: ActMind; action: string; outcome: ActWords["outcome"]; detail: string }): Promise<void>;
  /** Writes one notable event. `key` makes it once per owner; the buzz happens inside the run's notable writer. */
  notable(kind: ActKind, title: string, detail: string, key: string | null): Promise<unknown>;
}

export interface ActTelling {
  logged: boolean;
  noticed: boolean;
}

/**
 * Tells the owner about one act: the log row first, then the notable that buzzes the phone and appears in the
 * briefing and the night report. Both are attempted even when one fails, and a failure is reported, never raised,
 * so an act is never lost because the phone was unreachable.
 */
export async function reportAct(act: ActWords, ports: ActPorts): Promise<ActTelling> {
  let logged = false;
  let noticed = false;
  try {
    await ports.log({ mind: act.mind, action: act.action, outcome: act.outcome, detail: act.detail });
    logged = true;
  } catch {
    logged = false;
  }
  try {
    await ports.notable(act.kind, act.title, act.detail, act.key);
    noticed = true;
  } catch {
    noticed = false;
  }
  return { logged, noticed };
}
