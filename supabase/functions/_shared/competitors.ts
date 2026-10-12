// Phase I slice 5: the rival pages the owner asked Buddy to watch, and the honest line when one of them changes.
//
// Rules kept here:
// - Public pages only. An https address on a public host, with no sign-in inside the address, no local or private
//   address, and nothing longer than a normal link. Anything else is refused with a plain reason and never fetched.
// - Ten pages a day at most, oldest read first, and each saved page read once a day.
// - An honest change line or nothing. The only two things ever claimed are the headline it can see and that the
//   page text changed. Nothing else is guessed, and an unreadable page says so.
// Pure logic: no database, no network, no Deno globals, so it runs under Vitest.

import { blockedDetail } from "./runDay.ts";
import type { KillScope } from "./placementRun.ts";

export const COMPETITOR_READ_LIMIT = 10;
export const COMPETITOR_SAVE_LIMIT = 100;
export const COMPETITOR_URL_LIMIT = 300;
export const COMPETITOR_LABEL_LIMIT = 80;
export const COMPETITOR_TITLE_LIMIT = 200;
export const COMPETITOR_TEXT_LIMIT = 20000;
export const COMPETITOR_NOTE_LIMIT = 200;
export const COMPETITOR_CHANGE_KIND = "competitor_changed";

/** The words that make a message a watch ask. A question is never one, and neither is a plain pasted link. */
const WATCH_WORD = /\b(watch|watching|keep an eye|monitor|monitoring|track|tracking|rivals?|competitors?|competition|these links?|those links?|following links?)\b/i;

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/gi;

export const WATCH_NONE_LINE = "Nothing was saved to watch.";
export const WATCH_SAVE_FAILED_LINE = "The links could not be saved just now. Nothing was saved. Try again shortly.";
export const WATCH_NOTHING_TODAY = "No rival page is waiting to be read today.";

/** Plain reasons for a link that is not a public page. The words the owner gets, never a code. */
export const URL_PROBLEMS = {
  not_secure: "it does not start with https",
  has_sign_in: "the address carries a sign-in",
  not_public: "the address is not a public one",
  too_long: "the address is too long",
  list_full: "the list of watched pages is full",
  save_failed: "it could not be saved just now",
} as const;
export type UrlProblem = keyof typeof URL_PROBLEMS;

export interface RefusedUrl {
  url: string;
  problem: UrlProblem;
}

export interface WatchRequest {
  /** The links that may be saved, in the order they were written. */
  wanted: string[];
  /** The links that may not be saved, each with its plain reason. */
  refused: RefusedUrl[];
}

export interface SavedCompetitor {
  id: string;
  url: string;
  label: string;
  lastReadAt: string | null;
  /** What the last read saw. Null means the page has never been read, so no change can be claimed yet. */
  lastTitle: string | null;
  lastFingerprint: string | null;
}

export interface CompetitorRead {
  id: string;
  url: string;
  label: string;
}

export interface CompetitorPage {
  title: string | null;
  fingerprint: string;
}

export interface CompetitorChange {
  read: CompetitorRead;
  line: string;
  /** The notable that buzzes the phone: written once per page per day by the run. */
  title: string;
  detail: string;
  key: string;
}

export interface CompetitorRunInput {
  localDay: string;
  takeover: boolean;
  killScope: KillScope;
}

export type CompetitorFetch = { ok: true; html: string } | { ok: false; reason: string };

export interface CompetitorRunPorts {
  readSaved(): Promise<SavedCompetitor[]>;
  /** The ids already read today. A failed read returns an empty set: a page may be read again, never twice in one run. */
  readReadToday(): Promise<Set<string>>;
  /** One public page, as its html. Never throws: a failure comes back as a plain reason. */
  readPage(url: string): Promise<CompetitorFetch>;
  /** Records one read. False means the day's ten are used up, and the step stops. */
  recordRead(read: CompetitorRead, page: CompetitorPage, changeNote: string | null, localDay: string): Promise<boolean>;
  /** One plain log line. The run turns it into the daily log row. */
  log(line: string): Promise<void>;
}

export interface CompetitorRunResult {
  status: "held" | "nothing_to_do" | "done" | "failed";
  detail: string;
  read: number;
  changes: CompetitorChange[];
}

/** The plain reason a link may not be watched, or null when it is a public page. Textual rules only: nothing is fetched here. */
export function publicPageProblem(raw: string): UrlProblem | null {
  const url = raw.trim();
  if (url.length > COMPETITOR_URL_LIMIT) return "too_long";
  if (!/^https:\/\//i.test(url)) return "not_secure";
  const withoutScheme = url.replace(/^https:\/\//i, "");
  const authority = withoutScheme.split(/[/?#]/, 1)[0] ?? "";
  if (!authority || authority.includes("@")) return "has_sign_in";
  const host = (authority.split(":")[0] ?? "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return "not_public";
  // An address that is only digits and dots is a machine address, and a machine address is never a public page.
  if (/^[0-9.]+$/.test(host) || host.startsWith("[") || host.includes(":")) return "not_public";
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) return "not_public";
  return null;
}

/** The label a page is kept under: its host, without the www. A failed read gives the plain word "a page". */
export function competitorLabel(url: string): string {
  const host = url.trim().replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0]?.split(":")[0]?.toLowerCase() ?? "";
  const label = host.replace(/^www\./, "");
  if (!label || !label.includes(".")) return "a page";
  return label.length > COMPETITOR_LABEL_LIMIT ? `${label.slice(0, COMPETITOR_LABEL_LIMIT - 1)}…` : label;
}

/** Every address written in the message, in order, without repeats and without trailing punctuation. */
export function urlsInMessage(text: string): string[] {
  const out: string[] = [];
  for (const match of text.match(URL_IN_TEXT) ?? []) {
    const url = match.replace(/[.,;:!?]+$/, "");
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * The links in a watch ask. Null when the message is not a watch ask: no watch words, a question, or no link at all.
 * A pasted link with no watch words is not saved, because the owner may have meant something else by it.
 */
export function watchAsk(text: string): WatchRequest | null {
  const flat = text.trim();
  if (!flat || /\?\s*$/.test(flat)) return null;
  // The words are read with the addresses taken out, so "rival" inside an address is never a watch word.
  const wordsOnly = flat.replace(URL_IN_TEXT, " ");
  if (!WATCH_WORD.test(wordsOnly)) return null;
  const urls = urlsInMessage(flat);
  if (urls.length === 0) return null;
  const wanted: string[] = [];
  const refused: RefusedUrl[] = [];
  for (const url of urls) {
    const problem = publicPageProblem(url);
    if (problem) refused.push({ url, problem });
    else wanted.push(url);
  }
  return { wanted, refused };
}

/** The plain line for the links that were saved. Nothing is promised beyond the ten-a-day rule. */
export function watchSavedLine(labels: readonly string[]): string {
  if (labels.length === 0) return WATCH_NONE_LINE;
  const list = labels.join(", ");
  const pages = labels.length === 1 ? "page" : "pages";
  return `Watching ${labels.length} ${pages}: ${list}. I read up to ten public pages a day, oldest first, and tell you only what changed.`;
}

/** The plain line for the links that were not saved, or null when every link was fine. */
export function watchRefusedLine(refused: readonly RefusedUrl[]): string | null {
  if (refused.length === 0) return null;
  const parts = refused.map((item) => `${item.url} (${URL_PROBLEMS[item.problem]})`);
  return `Not watched: ${parts.join(", ")}.`;
}

/**
 * Which saved pages the day reads: the ones not read today, oldest read first, and never more than ten.
 * A page that has never been read comes first.
 */
export function planCompetitorReads(saved: readonly SavedCompetitor[], readToday: ReadonlySet<string>, limit: number = COMPETITOR_READ_LIMIT): CompetitorRead[] {
  return saved
    .filter((page) => page.id && page.url && !readToday.has(page.id))
    .sort((a, b) => {
      const at = a.lastReadAt ? Date.parse(a.lastReadAt) : 0;
      const bt = b.lastReadAt ? Date.parse(b.lastReadAt) : 0;
      if (at === bt) return a.url.localeCompare(b.url);
      return at - bt;
    })
    .slice(0, limit)
    .map((page) => ({ id: page.id, url: page.url, label: page.label || competitorLabel(page.url) }));
}

/** The text of a page, with scripts, styles, comments and tags taken out. Used only to compare one read with the next. */
export function pageText(html: string): string {
  const withoutHead = html
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<title[\s\S]*?<\/title>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ");
  return withoutHead
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, COMPETITOR_TEXT_LIMIT);
}

/** The page's own headline: its title tag, or the larger heading. Null when the page gives none. */
export function pageTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const heading = title ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const flat = (heading ?? "").replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > COMPETITOR_TITLE_LIMIT ? `${flat.slice(0, COMPETITOR_TITLE_LIMIT - 1)}…` : flat;
}

/** A short stable mark of the page text: the same text gives the same mark, a changed text does not. */
export function fingerprintOf(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const mark = (hash >>> 0).toString(16).padStart(8, "0");
  return `${mark}:${text.length}`;
}

/** One read of a page: what the comparison needs, and nothing more. */
export function readPageParts(html: string): CompetitorPage {
  const text = pageText(html);
  return { title: pageTitle(html), fingerprint: fingerprintOf(text) };
}

/**
 * The honest change line, or null when nothing changed. A first read never claims a change: it only learns the page.
 * Only two things are ever said: the headline it can read now, or that the text changed.
 */
export function changeLine(previous: { title: string | null; fingerprint: string | null } | null, next: CompetitorPage): string | null {
  if (!previous || !previous.fingerprint) return null;
  if (previous.fingerprint === next.fingerprint) return null;
  if (next.title && previous.title && previous.title !== next.title) return `The headline is now "${next.title}".`;
  if (next.title && !previous.title) return `The page now has a headline: "${next.title}".`;
  return "The page text changed.";
}

/** The notable one changed page writes: told once per page per day, and it buzzes the phone. */
export function competitorChange(read: CompetitorRead, line: string, localDay: string): CompetitorChange {
  const title = `Rival page changed: "${read.label}"`.slice(0, 160);
  const detail = `${line} ${read.url}`.slice(0, 500);
  return { read, line, title, detail, key: `competitor_changed:${read.id}:${localDay}` };
}

/**
 * Reads the saved rival pages for the day: at most ten, oldest first, public pages only. Nothing runs when Takeover
 * is off or Kill stops the minds. A page that cannot be read says so and is left for the next run; it is never
 * recorded as read, so nothing is claimed about it. Nothing here writes to the site.
 */
export async function runCompetitorReads(input: CompetitorRunInput, ports: CompetitorRunPorts): Promise<CompetitorRunResult> {
  const gate = blockedDetail(input.takeover, input.killScope);
  if (gate) return { status: "held", detail: gate, read: 0, changes: [] };

  const saved = await ports.readSaved();
  if (saved.length === 0) return { status: "nothing_to_do", detail: "No rival page is saved yet. Send Buddy the links you want watched.", read: 0, changes: [] };

  let readToday: Set<string>;
  try {
    readToday = await ports.readReadToday();
  } catch {
    // Today's reads could not be read. Nothing is guessed and no page is read twice: the step stops and says so.
    return {
      status: "failed",
      detail: "The pages already read today could not be read, so no page was read this run. Nothing is claimed about any of them.",
      read: 0,
      changes: [],
    };
  }
  const planned = planCompetitorReads(saved, readToday);
  if (planned.length === 0) return { status: "nothing_to_do", detail: WATCH_NOTHING_TODAY, read: 0, changes: [] };

  const changes: CompetitorChange[] = [];
  let read = 0;
  for (const page of planned) {
    const fetched = await ports.readPage(page.url);
    if (!fetched.ok) {
      await ports.log(`${page.label} could not be read today: ${fetched.reason} Nothing is claimed about it.`);
      continue;
    }
    const parts = readPageParts(fetched.html);
    // The comparison uses only what the last read recorded: the page's own stored parts, read with the saved list.
    const stored = saved.find((item) => item.id === page.id) ?? null;
    const line = changeLine(stored ? { title: stored.lastTitle, fingerprint: stored.lastFingerprint } : null, parts);
    const note = line ? line.slice(0, COMPETITOR_NOTE_LIMIT) : null;
    const recorded = await ports.recordRead(page, parts, note, input.localDay);
    if (!recorded) {
      await ports.log("The ten pages for today are used up, so nothing else was read.");
      break;
    }
    read += 1;
    if (line) {
      const change = competitorChange(page, line, input.localDay);
      changes.push(change);
      await ports.log(`${page.label} changed. ${change.detail}`);
    } else {
      await ports.log(`${page.label} was read. Nothing changed.`);
    }
  }

  const detail = read === 0
    ? "No rival page could be read today. Nothing changed and nothing is claimed about any of them."
    : `Read ${read} ${read === 1 ? "page" : "pages"} today. ${changes.length === 0 ? "Nothing changed." : `${changes.length} changed.`}`;
  return { status: "done", detail, read, changes };
}
