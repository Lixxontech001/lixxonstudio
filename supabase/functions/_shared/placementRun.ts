// One run of the Executioner on one waiting product-line order. Pure logic: the database and Gemini are passed in as
// ports, so tests can run it with fake data. Nothing here writes to the database directly.
//
// Order of checks, first failure wins and nothing is written:
//   1. Takeover must be on. 2. Kill must not stop the Executioner. 3. Strategist plans, Auditor checks.
//   4. The edit must fit: at most 3 products, the drip limit, the paragraph unchanged (checksum).
// Only then does the apply port run, and it does all its writes in one database transaction.

import { auditPlacement, planPlacement, type PlacementCandidate, type ShopProduct } from "./productPlacement.ts";
import { DRIP_DAILY_LIMIT, PRODUCT_CAP, paragraphChecksum } from "./postEdits.ts";
import type { MindThinkResult } from "./mindThink.ts";

/** How many articles one run will try, best fit first. Keeps one run small and the Gemini calls few. */
export const MAX_ARTICLES_PER_RUN = 2;
const RANK_TEXT_LIMIT = 2000;

export const TAKEOVER_OFF_ACTION = "Held for you";
export const TAKEOVER_OFF_DETAIL = "Takeover is off, so nothing changed on the site.";
export const STOPPED_ACTION = "Did not run";
export const STOPPED_DETAIL = "Stopped by Kill.";
export const NO_KEY_ACTION = "Cannot think: no Google key";
export const NO_KEY_DETAIL = "Add the Google key in Admin under Automation keys.";
export const APPLY_ACTION = "Added a product line to an article";
export const GAP_ACTION = "Found a product gap";
export const GAP_REASON = "The shop has no product that fits. Create one, then ask again.";
export const GAP_NOTE = "No product in the shop fits these articles yet. Create one in the shop, then ask Buddy again.";
export const AUDITOR_STOPPED_DETAIL = "The Auditor is stopped by Kill, so no plan can pass. Set Kill back to Nothing stopped in Minds.";
export const STRATEGIST_STOPPED_DETAIL = "The Strategist is stopped by Kill, so no plan can be made. Set Kill back to Nothing stopped in Minds.";
export const DRIP_HELD_DETAIL = "Three articles already got a product line today. This order waits until tomorrow.";
export const NO_FIT_ACTION = "Looked for a fit";
export const NO_FIT_DETAIL = "No product fits a paragraph of this article honestly.";
export const CAP_BLOCK_DETAIL = "This article already has three products, and none can be swapped out safely. Nothing changed.";

export type KillScope = "none" | "all" | "analyst" | "strategist" | "ceo" | "executioner" | "auditor";
export type LogOutcome = "done" | "skipped" | "blocked" | "failed";

export interface RunArticle {
  id: string;
  title: string;
  content: string | null;
  /** Shop products that are live on this article (placed by the minds, not yet removed). */
  liveProductIds: string[];
  /** Edits the minds made that are still fully live, oldest first. Used to find a swap. */
  liveEdits: Array<{ id: string; productIds: string[]; sentencesAdded: string }>;
}

export interface RunInput {
  order: { id: string; instruction: string };
  /** The owner's local calendar day, YYYY-MM-DD, sent by the browser. */
  localDay: string;
  takeover: boolean;
  killScope: KillScope;
  shop: ShopProduct[];
  /** Published articles, newest first. */
  articles: RunArticle[];
  /** Article ids already counted for the owner's day. */
  touchedToday: string[];
}

export interface ApplyEdit {
  orderId: string;
  postId: string;
  localDay: string;
  lineIndex: number;
  beforeLine: string;
  afterLine: string;
  beforeChecksum: string;
  afterChecksum: string;
  sentencesAdded: string;
  productIds: string[];
  removedProductIds: string[];
  auditorNote: string;
  title: string;
  detail: string;
}

export interface GapRecord {
  orderId: string;
  postId: string | null;
  localDay: string;
  angle: string;
  note: string;
  reason: string;
  title: string;
}

export type PortResult = { ok: true } | { ok: false; reason: string };

export interface RunLog {
  mind: "strategist" | "auditor" | "executioner";
  action: string;
  outcome: LogOutcome;
  detail: string;
}

export interface RunPorts {
  think: (request: { mind: string; system: string; prompt: string }) => Promise<MindThinkResult>;
  applyEdit: (edit: ApplyEdit) => Promise<PortResult>;
  recordGap: (gap: GapRecord) => Promise<PortResult>;
  log: (entry: RunLog) => Promise<void>;
  notable: (kind: "auditor_blocked", title: string, detail: string) => Promise<void>;
}

export type RunOutcome =
  | { status: "applied"; postId: string; detail: string }
  | { status: "held"; detail: string }
  | { status: "cannot_think"; detail: string }
  | { status: "gap"; detail: string }
  | { status: "blocked"; detail: string }
  | { status: "failed"; detail: string };

const STOP_WORDS = new Set([
  "about", "also", "back", "best", "daily", "easy", "from", "guide", "have", "help", "here", "into", "just", "like",
  "make", "more", "most", "need", "simple", "some", "that", "their", "them", "then", "they", "this", "what", "when",
  "with", "your", "will", "over", "under", "each", "very",
]);

function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
  );
}

/**
 * Best fit first. An article scores for each shop product whose name shares a word with it. Digital products
 * count a little more, because they are the revenue priority. Ties keep the newer article first.
 */
export function rankArticles(articles: RunArticle[], shop: ShopProduct[]): RunArticle[] {
  const scored = articles.map((article, position) => {
    const words = wordsOf(`${article.title} ${(article.content ?? "").slice(0, RANK_TEXT_LIMIT)}`);
    let score = 0;
    for (const product of shop) {
      const shared = [...wordsOf(product.name)].some((word) => words.has(word));
      if (shared) score += product.isDigital ? 1.5 : 1;
    }
    return { article, score, position };
  });
  scored.sort((a, b) => b.score - a.score || a.position - b.position);
  return scored.map((item) => item.article);
}

/**
 * Which live products (and the sentences that named them) must come off the article so the new products fit under
 * the cap. Only edits the minds made are candidates: each must be fully live, keep none of the new products, and sit in
 * the same paragraph (`line`) as the edit being made. Returns null when there is no safe way to make room.
 */
export function swapFor(article: RunArticle, newProductIds: string[], line: string): { removeProductIds: string[]; removeSentences: string[] } | null {
  const live = new Set(article.liveProductIds);
  let over = live.size + newProductIds.length - PRODUCT_CAP;
  if (over <= 0) return { removeProductIds: [], removeSentences: [] };
  const keep = new Set(newProductIds);
  const removeProductIds: string[] = [];
  const removeSentences: string[] = [];
  for (const edit of article.liveEdits) {
    if (over <= 0) break;
    if (edit.productIds.length === 0 || !edit.productIds.every((id) => live.has(id))) continue;
    if (edit.productIds.some((id) => keep.has(id))) continue;
    // A swap works inside one paragraph only: the sentences to remove must be in the paragraph being edited.
    if (!edit.sentencesAdded.trim() || !line.includes(edit.sentencesAdded)) continue;
    removeProductIds.push(...edit.productIds);
    removeSentences.push(edit.sentencesAdded);
    over -= edit.productIds.length;
  }
  return over <= 0 ? { removeProductIds, removeSentences } : null;
}

/**
 * The paragraph after the edit: the old sentences taken out (if any), then the new sentences added at the end.
 * Returns null when a sentence to remove is not in the paragraph any more, so nothing is guessed at.
 */
export function lineAfter(before: string, removeSentences: string[], addSentences: string[]): string | null {
  let text = before.replace(/\s+$/, "");
  for (const sentence of removeSentences) {
    const index = text.indexOf(sentence);
    if (index === -1) return null;
    const start = index > 0 && text[index - 1] === " " ? index - 1 : index;
    text = text.slice(0, start) + text.slice(index + sentence.length);
  }
  return [text.trimEnd(), addSentences.join(" ")].filter((part) => part.length > 0).join(" ");
}

/** The article text with one line replaced. Every other line is kept exactly as it was. */
export function replaceLine(content: string, lineIndex: number, line: string): string {
  const lines = content.split("\n");
  lines[lineIndex] = line;
  return lines.join("\n");
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function applyFailure(reason: string): RunOutcome {
  if (reason === "takeover_off" || reason === "killed") {
    return { status: "held", detail: reason === "killed" ? STOPPED_DETAIL : TAKEOVER_OFF_DETAIL };
  }
  return { status: "failed", detail: "The change did not fit the article any more, so nothing changed. It stays waiting." };
}

async function tryPlacement(
  article: RunArticle,
  candidate: PlacementCandidate,
  input: RunInput,
  ports: RunPorts,
): Promise<RunOutcome | null> {
  const lines = (article.content ?? "").split("\n");
  const before = lines[candidate.paragraphIndex];
  if (before === undefined) return null;

  // The Auditor checks again on the text as it is now, not as it was when the plan was made.
  const verdict = auditPlacement(candidate, article.content, input.shop);
  if (verdict.verdict === "block") {
    await ports.log({ mind: "auditor", action: "Checked a plan", outcome: "blocked", detail: clip(`Blocked. ${verdict.fix}`, 500) });
    await ports.notable("auditor_blocked", `Auditor blocked a change to "${clip(article.title, 80)}"`, clip(verdict.fix, 500));
    return null;
  }

  if (candidate.productIds.some((id) => article.liveProductIds.includes(id))) {
    await ports.log({ mind: "auditor", action: "Checked a plan", outcome: "blocked", detail: "Blocked. That product is already on this article." });
    return null;
  }

  const swap = swapFor(article, candidate.productIds, before);
  if (swap === null) {
    await ports.log({ mind: "auditor", action: "Checked a plan", outcome: "blocked", detail: CAP_BLOCK_DETAIL });
    return null;
  }

  const after = lineAfter(before, swap.removeSentences, candidate.sentences);
  if (after === null || after === before) {
    await ports.log({ mind: "auditor", action: "Checked a plan", outcome: "blocked", detail: "Blocked. The paragraph could not be changed cleanly." });
    return null;
  }

  const beforeChecksum = await paragraphChecksum(before);
  const afterChecksum = await paragraphChecksum(after);
  const names = candidate.productIds
    .map((id) => input.shop.find((product) => product.id === id)?.name ?? "a product")
    .join(", ");
  const sentencesAdded = candidate.sentences.join(" ");
  const edit: ApplyEdit = {
    orderId: input.order.id,
    postId: article.id,
    localDay: input.localDay,
    lineIndex: candidate.paragraphIndex,
    beforeLine: before,
    afterLine: after,
    beforeChecksum,
    afterChecksum,
    sentencesAdded,
    productIds: candidate.productIds,
    removedProductIds: swap.removeProductIds,
    auditorNote: clip(verdict.fix || "Allowed.", 300),
    title: APPLY_ACTION,
    detail: clip(`Added ${names} to "${article.title}". Only one paragraph changed.`, 500),
  };
  const result = await ports.applyEdit(edit);
  if (!result.ok) return applyFailure(result.reason);
  return { status: "applied", postId: article.id, detail: edit.detail };
}

/** One run for one order. Returns what happened in plain words, and the order is only marked done by the apply port. */
export async function runPlacementOrder(input: RunInput, ports: RunPorts): Promise<RunOutcome> {
  if (!input.takeover) {
    await ports.log({ mind: "executioner", action: TAKEOVER_OFF_ACTION, outcome: "skipped", detail: TAKEOVER_OFF_DETAIL });
    return { status: "held", detail: TAKEOVER_OFF_DETAIL };
  }
  // Kill stops the Executioner, and also the Strategist and the Auditor: no plan can be made or checked without them.
  if (input.killScope === "all" || input.killScope === "executioner") {
    await ports.log({ mind: "executioner", action: STOPPED_ACTION, outcome: "skipped", detail: STOPPED_DETAIL });
    return { status: "held", detail: STOPPED_DETAIL };
  }
  if (input.killScope === "strategist") {
    await ports.log({ mind: "strategist", action: STOPPED_ACTION, outcome: "skipped", detail: STRATEGIST_STOPPED_DETAIL });
    return { status: "held", detail: STRATEGIST_STOPPED_DETAIL };
  }
  if (input.killScope === "auditor") {
    await ports.log({ mind: "auditor", action: STOPPED_ACTION, outcome: "skipped", detail: AUDITOR_STOPPED_DETAIL });
    return { status: "held", detail: AUDITOR_STOPPED_DETAIL };
  }

  const ranked = rankArticles(input.articles, input.shop).slice(0, MAX_ARTICLES_PER_RUN);
  if (ranked.length === 0) {
    const detail = "There is no published article to place a product on yet. This order waits.";
    await ports.log({ mind: "executioner", action: "Held for you", outcome: "skipped", detail });
    return { status: "held", detail };
  }

  let sawNoFit = false;
  let sawBlock = false;
  let dripSkipped = 0;
  const touched = new Set(input.touchedToday);

  for (const article of ranked) {
    if (!touched.has(article.id) && touched.size >= DRIP_DAILY_LIMIT) {
      dripSkipped += 1;
      continue;
    }
    const plan = await planPlacement(
      { id: article.id, title: article.title, content: article.content },
      input.shop,
      ports.think,
    );

    if (plan.status === "cannot_think") {
      await ports.log({ mind: "strategist", action: NO_KEY_ACTION, outcome: "skipped", detail: NO_KEY_DETAIL });
      // The owner reads the same words the planner gives: "Cannot think: no Google key."
      return { status: "cannot_think", detail: plan.detail };
    }
    if (plan.status === "failed") {
      await ports.log({ mind: "strategist", action: "Could not think", outcome: "failed", detail: plan.detail });
      return { status: "failed", detail: plan.detail };
    }
    if (plan.status === "no_fit") {
      sawNoFit = true;
      await ports.log({ mind: "strategist", action: NO_FIT_ACTION, outcome: "skipped", detail: NO_FIT_DETAIL });
      continue;
    }
    if (plan.status === "blocked" || !plan.candidate) {
      sawBlock = true;
      await ports.log({ mind: "auditor", action: "Checked a plan", outcome: "blocked", detail: clip(`Blocked. ${plan.detail}`, 500) });
      await ports.notable("auditor_blocked", `Auditor blocked a plan for "${clip(article.title, 80)}"`, clip(plan.detail, 500));
      continue;
    }

    const outcome = await tryPlacement(article, plan.candidate, input, ports);
    if (outcome) return outcome;
    sawBlock = true;
  }

  if (sawNoFit && !sawBlock && dripSkipped === 0) {
    const result = await ports.recordGap({
      orderId: input.order.id,
      postId: ranked[0]?.id ?? null,
      localDay: input.localDay,
      angle: clip(input.order.instruction, 300),
      note: GAP_NOTE,
      reason: GAP_REASON,
      title: GAP_ACTION,
    });
    if (!result.ok) return { status: "failed", detail: "The gap could not be saved. The order stays waiting." };
    return { status: "gap", detail: GAP_REASON };
  }
  if (dripSkipped > 0 && !sawBlock && !sawNoFit) {
    await ports.log({ mind: "executioner", action: "Held for you", outcome: "skipped", detail: DRIP_HELD_DETAIL });
    return { status: "held", detail: DRIP_HELD_DETAIL };
  }
  const detail = "The Auditor did not allow any change for this order. It stays waiting for you.";
  return { status: "blocked", detail };
}
