// The Analyst, the Strategist and the CEO, as the day run runs them. Pure logic: no Deno globals, no database.
// The day run passes in two doors: think (the brain chain, through makeMindThink) and log (one daily-log row).
//
// This is a server copy of src/buddy/minds (analyst.ts, strategist.ts, ceo.ts, mindCore.ts, mindGuards.ts).
// The browser code cannot be imported by an Edge Function, so the wording and the reply rules are copied here.
// src/__tests__/livingMindsParity.test.ts checks every copied constant and reply rule against the src originals,
// so the two copies cannot drift apart silently.

import type { KillScope } from "./placementRun.ts";

export type LivingMind = "analyst" | "strategist" | "ceo";
export const LIVING_MINDS: readonly LivingMind[] = ["analyst", "strategist", "ceo"];

export const MIND_RULES = [
  "You are one of Buddy's background minds for an owner-run site. You are not talking to the owner.",
  "Never publish, write or edit article text, change prices, create products, send email or messages,",
  "spend money, switch off another mind, or speak to a customer as the owner.",
  'Reply with JSON only, in this shape: {"summary": "one or two plain sentences", "proposals": [{"kind": "note|suggest|sort|prepare", "text": "plain English"}]}.',
  "Use an empty proposals list when you have nothing to add. Plain English, no jargon.",
].join(" ");

export const ANALYST_ROLE = 'Your job: read the site facts and say what changed, in plain words. Use kind "note".';
export const STRATEGIST_ROLE = 'Your job: suggest what to do next, and why. Use kind "suggest".';
export const CEO_ROLE = 'Your job: put the waiting orders and plans in order of priority. Use kind "sort".';

export const ANALYST_ACTION = "Read the site numbers";
export const STRATEGIST_ACTION = "Suggested next steps";
export const CEO_ACTION = "Put the orders in order";

export const SUMMARY_LIMIT = 500;
export const DETAIL_LIMIT = 300;
export const PROPOSAL_LIMIT = 300;

/** The proposal kinds a mind may give. Anything else is refused. Same list as src/buddy/minds/mindGuards.ts. */
export const PROPOSAL_KINDS = ["note", "suggest", "sort", "prepare"] as const;

export const NO_KEY_ACTION = "Cannot think: no brain key saved";
export const NO_KEY_DETAIL = "Add a brain key on the Brains page, under Automation in Admin.";
export const STOPPED_ACTION = "Did not run";
export const STOPPED_DETAIL = "Stopped by Kill.";

export type LivingOutcome = "done" | "skipped" | "blocked" | "failed";
export interface LivingLogEntry {
  mind: LivingMind;
  action: string;
  outcome: LivingOutcome;
  detail: string;
}

export type LivingThinkFailure = "no_key" | "rejected" | "rate_limited" | "unavailable" | "empty";
export type LivingThinkResult = { ok: true; text: string } | { ok: false; reason: LivingThinkFailure };
export interface LivingThinkRequest {
  mind: LivingMind;
  system: string;
  prompt: string;
}

export interface LivingMindPorts {
  think: (request: LivingThinkRequest) => Promise<LivingThinkResult>;
  log: (entry: LivingLogEntry) => Promise<void>;
}

export interface LivingMindContext {
  takeover: boolean;
  killScope: KillScope;
  /** Read-only site facts, already read by the caller. A mind never reads the site itself. */
  facts: string;
  /** The owner's waiting orders, in the owner's words. */
  orders: string[];
  /** Minds that already have a 'done' row today. They are not run again today (Phase E: a done row never retries). */
  doneToday?: readonly LivingMind[];
  /** Minds that already have today's stopped row. Kill writes one stopped row per mind per day, not one per run. */
  stoppedToday?: readonly LivingMind[];
}

export interface LivingMindRun {
  entry: LivingLogEntry;
  proposals: Array<{ kind: string; text: string }>;
  refused: number;
}

export function clip(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Reads a reply. Anything that is not the agreed shape becomes a plain summary and no proposals. */
export function parseMindReply(text: string): { summary: string; proposals: Array<{ kind: unknown; text: unknown }> } {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      const summary = typeof parsed.summary === "string" ? clip(parsed.summary, SUMMARY_LIMIT) : "";
      const proposals = Array.isArray(parsed.proposals)
        ? parsed.proposals
            .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
            .map((item) => ({ kind: item.kind, text: item.text }))
        : [];
      return { summary, proposals };
    } catch {
      // Fall through to a plain summary.
    }
  }
  return { summary: clip(cleaned, SUMMARY_LIMIT), proposals: [] };
}

export function isProposalKind(value: unknown): boolean {
  return typeof value === "string" && (PROPOSAL_KINDS as readonly string[]).includes(value);
}

export function refusedDetail(count: number): string {
  return `Refused ${count} step${count === 1 ? "" : "s"}: minds cannot make that kind of change.`;
}

export function failureDetail(reason: LivingThinkFailure): string {
  switch (reason) {
    case "no_key":
      return NO_KEY_DETAIL;
    case "rejected":
      return "A brain refused its key. Check it on the Brains page.";
    case "rate_limited":
      return "The brains are busy. Try again later.";
    case "unavailable":
      return "No brain could be reached. Try again later.";
    case "empty":
      return "No brain sent back anything usable.";
  }
}

/** True when the Kill setting stops this mind. Kill all stops every mind. Same rule as src/buddy/minds/mindRoster.ts. */
export function isKilled(scope: KillScope, mind: LivingMind): boolean {
  return scope === "all" || scope === mind;
}

export function factsPrompt(context: LivingMindContext): string {
  const orders = context.orders.length ? context.orders.map((order) => `- ${order}`).join("\n") : "- none";
  return `Site facts (read-only):\n${context.facts || "none read"}\n\nWaiting orders from the owner:\n${orders}`;
}

const ROLE: Record<LivingMind, { action: string; role: string }> = {
  analyst: { action: ANALYST_ACTION, role: ANALYST_ROLE },
  strategist: { action: STRATEGIST_ACTION, role: STRATEGIST_ROLE },
  ceo: { action: CEO_ACTION, role: CEO_ROLE },
};

async function finish(ports: LivingMindPorts, entry: LivingLogEntry, proposals: LivingMindRun["proposals"] = [], refused = 0): Promise<LivingMindRun> {
  await ports.log(entry);
  return { entry, proposals, refused };
}

/**
 * One thinking step: stop if Kill stops this mind, think once through the brain chain, check the reply, log one row.
 * A thrown think becomes an honest "could not think". Same shape as src/buddy/minds/mindCore.ts runThinkingMind.
 */
export async function runLivingStep(ports: LivingMindPorts, mind: LivingMind, context: LivingMindContext): Promise<LivingMindRun> {
  if (isKilled(context.killScope, mind)) {
    return finish(ports, { mind, action: STOPPED_ACTION, outcome: "skipped", detail: STOPPED_DETAIL });
  }
  const spec = ROLE[mind];
  let result: LivingThinkResult;
  try {
    result = await ports.think({ mind, system: `${MIND_RULES} ${spec.role}`, prompt: factsPrompt(context) });
  } catch {
    result = { ok: false, reason: "unavailable" };
  }
  if (!result.ok) {
    if (result.reason === "no_key") {
      return finish(ports, { mind, action: NO_KEY_ACTION, outcome: "skipped", detail: NO_KEY_DETAIL });
    }
    return finish(ports, { mind, action: "Could not think", outcome: "failed", detail: failureDetail(result.reason) });
  }

  const reply = parseMindReply(result.text);
  const proposals: LivingMindRun["proposals"] = [];
  let refused = 0;
  for (const item of reply.proposals) {
    if (isProposalKind(item.kind) && typeof item.text === "string" && item.text.trim()) {
      proposals.push({ kind: String(item.kind), text: clip(item.text, PROPOSAL_LIMIT) });
    } else {
      refused += 1;
    }
  }
  const detail = [reply.summary, refused ? refusedDetail(refused) : ""].filter(Boolean).join(" ");
  return finish(ports, { mind, action: spec.action, outcome: "done", detail: clip(detail, DETAIL_LIMIT) }, proposals, refused);
}

/**
 * The day run's living minds, in a fixed order: Analyst, then Strategist, then CEO. Each writes its own row.
 * Phase E: a mind with a 'done' row today is not run again. A mind that failed, was skipped (no key, unavailable,
 * rate limited, empty) or has no row yet is run, so a later run the same local day may retry it. A mind that Kill
 * stops writes one stopped row per day: if today's stopped row is already there, nothing more is written.
 */
export async function runLivingMinds(ports: LivingMindPorts, context: LivingMindContext): Promise<LivingMindRun[]> {
  const runs: LivingMindRun[] = [];
  for (const mind of LIVING_MINDS) {
    if (context.doneToday?.includes(mind)) continue;
    if (isKilled(context.killScope, mind) && context.stoppedToday?.includes(mind)) continue;
    runs.push(await runLivingStep(ports, mind, context));
  }
  return runs;
}
