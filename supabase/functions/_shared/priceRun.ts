// Phase I slice 5: the day's one US dollar price change, as the Executioner runs it.
//
// Order: check the gate, read the shop and the facts, ask the Strategist, put the answer through the Auditor, allow
// one fix when the Auditor blocks, then apply through the database's own door. Nothing is written before the
// Auditor allows it, and the words the owner gets are the dollars the database recorded.
// Pure logic: the shop, the brain, the apply door and the log all come in through `ports`.

import { blockedDetail } from "./runDay.ts";
import type { KillScope } from "./placementRun.ts";
import type { MindThinkResult } from "./mindThink.ts";
import { auditorBlockedAct, priceChangedAct, type ActWords } from "./mindActs.ts";
import { auditPriceChange, fixPriceOnce, planPriceChange, type PriceCandidate, type PriceProduct } from "./priceChanges.ts";

export const PRICE_CHECKED_ACTION = "Checked the shop prices";
export const NO_KEY_DETAIL = "Cannot think: no brain key saved.";
export const FIX_ONCE_REFUSED_DETAIL = "The Auditor blocked the price twice, so the change was stopped.";

export interface PriceRunInput {
  localDay: string;
  takeover: boolean;
  killScope: KillScope;
}

export interface PriceRunLogEntry {
  action: string;
  outcome: "done" | "skipped" | "blocked" | "failed";
  detail: string;
}

export interface PriceRunPorts {
  /** The live shop, US dollar prices only. Null prices are kept, so the Auditor can say what is missing. */
  readShop(): Promise<PriceProduct[]>;
  /** The site facts the Strategist reads. One honest line, or a plain note when they cannot be read. */
  readFacts(): Promise<string>;
  think(request: { mind: string; system: string; prompt: string }): Promise<MindThinkResult>;
  /** The database's own door. It re-checks everything and returns the prices it recorded. */
  apply(candidate: PriceCandidate): Promise<{ ok: true; fromUsd: number; newUsd: number } | { ok: false; reason: string }>;
  log(entry: PriceRunLogEntry): Promise<void>;
}

export type PriceRunResult =
  | { status: "held"; detail: string; act: null }
  | { status: "nothing_to_do"; detail: string; act: null }
  | { status: "cannot_think"; detail: string; act: null }
  | { status: "failed"; detail: string; act: null }
  | { status: "changed"; detail: string; act: ActWords }
  | { status: "blocked"; detail: string; act: ActWords };

/**
 * One price change at most, once a day, and only when Takeover is on and Kill does not stop the minds. The logs it
 * writes itself are the ones that are not acts: a check that changed nothing, a missing key, a failed apply. A
 * change and a block come back as act words, so the caller tells them four ways through the act list.
 */
export async function runPriceChange(input: PriceRunInput, ports: PriceRunPorts): Promise<PriceRunResult> {
  const gate = blockedDetail(input.takeover, input.killScope);
  if (gate) return { status: "held", detail: gate, act: null };

  const shop = await ports.readShop();
  if (shop.length === 0) {
    const detail = "The shop has no live product priced in US dollars, so no price was touched.";
    await ports.log({ action: PRICE_CHECKED_ACTION, outcome: "skipped", detail });
    return { status: "nothing_to_do", detail, act: null };
  }

  const facts = await ports.readFacts();
  const plan = await planPriceChange(shop, facts, ports.think);
  if (plan.status === "cannot_think") {
    await ports.log({ action: PRICE_CHECKED_ACTION, outcome: "skipped", detail: NO_KEY_DETAIL });
    return { status: "cannot_think", detail: NO_KEY_DETAIL, act: null };
  }
  if (plan.status === "failed") {
    await ports.log({ action: PRICE_CHECKED_ACTION, outcome: "failed", detail: plan.detail });
    return { status: "failed", detail: plan.detail, act: null };
  }
  if (plan.status === "nothing" || !plan.candidate) {
    await ports.log({ action: PRICE_CHECKED_ACTION, outcome: "skipped", detail: plan.detail });
    return { status: "nothing_to_do", detail: plan.detail, act: null };
  }

  let candidate: PriceCandidate = plan.candidate;
  let product: PriceProduct | null = plan.product;
  let verdict = plan.verdict;

  // One allowed fix after a block, then the Auditor checks again. Still blocked means the change is stopped, and the
  // telling says the price was checked twice.
  if (verdict.verdict === "block") {
    const fixed = await fixPriceOnce(shop, facts, candidate, verdict.fix, ports.think);
    if (fixed) {
      candidate = fixed;
      product = shop.find((item) => item.id === fixed.productId) ?? null;
      verdict = auditPriceChange(fixed, product);
    }
    if (verdict.verdict === "block") {
      verdict = { verdict: "block", fix: `${verdict.fix} ${FIX_ONCE_REFUSED_DETAIL}`.trim(), reasons: verdict.reasons };
    }
  }

  if (verdict.verdict === "block") {
    const act = auditorBlockedAct(product?.name ?? "a shop price", verdict.fix);
    return { status: "blocked", detail: verdict.fix, act };
  }

  const applied = await ports.apply(candidate);
  if (!applied.ok) {
    await ports.log({ action: PRICE_CHECKED_ACTION, outcome: "failed", detail: applied.reason });
    return { status: "failed", detail: applied.reason, act: null };
  }

  const act = priceChangedAct(product?.name ?? "a product", applied.fromUsd, applied.newUsd, input.localDay);
  return { status: "changed", detail: act.detail, act };
}
