// The morning pipeline, as a team: the Analyst reads, the Strategist plans, the CEO puts the day in order, and then
// the Executioner acts. Pure logic: the minds are the same three the owner path runs (buddyLivingMinds.ts), the
// brains arrive through the think port, and the Executioner is one port the caller provides.
//
// Rules kept here:
// - Takeover off: the pipeline returns before any port is called. Nothing is read, nothing is logged, nothing runs.
// - A mind the Kill switch stops writes its one stopped row (that is the thinking step's own rule) and is not asked.
// - A mind with a done row today is not run again today, so a second tick in the same morning thinks once.
// - The three minds hand their work forward as one brief. The brief goes to the Executioner, which is told the day's
//   plans in the minds' own words, not as a canned line.
// - Every mind is given the facts and the memory (the last telling and the owner's own chat) as one block, and a
//   telling the owner already heard is never made again: that rule lives in mindMemory.ts.
// - Every live change the Executioner makes goes through the Auditor first. That check lives with the change
//   (placementRun.ts for a product placement; the door send for a door post); the pipeline never skips it and never
//   applies anything itself.
// - A day whose run is already done is not run again: the Executioner port is not called, and the plain line says so.

import {
  LIVING_MINDS,
  STOPPED_ACTION,
  runLivingMinds,
  type LivingLogEntry,
  type LivingMind,
  type LivingMindPorts,
  type LivingMindRun,
  type LivingThinkResult,
} from "./buddyLivingMinds.ts";
import type { KillScope } from "./placementRun.ts";
import { factsWithMemory } from "./mindMemory.ts";
import { blockedDetail, TAKEOVER_OFF_DETAIL } from "./runDay.ts";

/** The order the day runs in. The Executioner is last, because it acts. */
export const PIPELINE_ORDER = ["analyst", "strategist", "ceo", "executioner"] as const;
export type PipelineMind = (typeof PIPELINE_ORDER)[number];

/** How much of the minds' work is carried into the Executioner's brief. */
export const BRIEF_LIMIT = 1200;
export const ALREADY_RAN_DETAIL = "Today's run is already done. Nothing ran twice.";

export interface PipelineBrief {
  day: string;
  /** One line per thinking mind, in pipeline order, in its own words. */
  voices: Array<{ mind: LivingMind; summary: string }>;
  /** The plans the three minds put forward, in the order they were made. */
  plans: string[];
}

/** The brief as plain text: what the Executioner is told, and what is written in the log. */
export function briefText(brief: PipelineBrief): string {
  const voices = brief.voices.map((voice) => `${voice.mind}: ${voice.summary}`).join(" | ");
  const plans = brief.plans.length ? ` Plans: ${brief.plans.join(" | ")}` : " No plans were put forward.";
  const text = `${voices}${plans}`.replace(/\s+/g, " ").trim();
  return text.length > BRIEF_LIMIT ? `${text.slice(0, BRIEF_LIMIT - 1)}…` : text;
}

/** What the Executioner reports back. `changed` counts the live changes that went through the Auditor. */
export interface PipelineExecution {
  status: string;
  detail: string;
  changed: number;
}

export interface PipelinePorts {
  think: (request: { mind: string; system: string; prompt: string }) => Promise<LivingThinkResult>;
  /** One log row, the same table and shape the owner path writes. */
  log: (entry: LivingLogEntry) => Promise<void>;
  /** The Executioner: the day's run, with the Auditor inside it before every live change. */
  runExecutioner: (brief: PipelineBrief) => Promise<PipelineExecution>;
}

export interface PipelineInput {
  day: string;
  takeover: boolean;
  killScope: KillScope;
  /** Read-only site facts, already read by the caller. */
  facts: string;
  /**
   * What the minds remember, as one plain block: the facts, the last thing the owner was told, and the owner's own
   * chat (Phase I slice 4). Optional, so a caller without memory still works; the minds then get the facts alone.
   */
  memory?: string | null;
  /** The owner's waiting orders, in the owner's words. */
  orders: string[];
  doneToday?: readonly LivingMind[];
  stoppedToday?: readonly LivingMind[];
  /** True when today's run already finished. The Executioner is not called again. */
  alreadyRanToday?: boolean;
}

export interface PipelineStep {
  mind: PipelineMind;
  action: string;
  outcome: LivingLogEntry["outcome"];
  detail: string;
  plans: number;
}

export interface PipelineResult {
  status: "held" | "done" | "already_ran";
  detail: string;
  steps: PipelineStep[];
  plans: number;
  changed: number;
  execution: PipelineExecution | null;
}

/** The three thinking minds' runs become the brief: their own summaries and the plans they put forward. */
export function briefFrom(day: string, runs: readonly LivingMindRun[]): PipelineBrief {
  const voices: PipelineBrief["voices"] = [];
  const plans: string[] = [];
  for (const run of runs) {
    if (run.entry.outcome !== "done") continue;
    voices.push({ mind: run.entry.mind, summary: run.entry.detail });
    for (const proposal of run.proposals) plans.push(`${proposal.kind}: ${proposal.text}`);
  }
  return { day, voices, plans };
}

/**
 * One morning: the three thinking minds in order, then the Executioner with their brief.
 * Takeover off returns first. A finished day returns before the Executioner port is called.
 */
export async function runMindPipeline(input: PipelineInput, ports: PipelinePorts): Promise<PipelineResult> {
  if (!input.takeover) {
    return { status: "held", detail: TAKEOVER_OFF_DETAIL, steps: [], plans: 0, changed: 0, execution: null };
  }

  const thinkingPorts: LivingMindPorts = {
    think: (request) => ports.think(request),
    log: (entry) => ports.log(entry),
  };
  const runs = await runLivingMinds(thinkingPorts, {
    takeover: input.takeover,
    killScope: input.killScope,
    // Every mind reads the facts and the memory in one block, so a mind cannot be run without remembering.
    facts: factsWithMemory(input.facts, input.memory),
    orders: input.orders,
    doneToday: input.doneToday,
    stoppedToday: input.stoppedToday,
  });

  const steps: PipelineStep[] = runs.map((run) => ({
    mind: run.entry.mind,
    action: run.entry.action,
    outcome: run.entry.outcome,
    detail: run.entry.detail,
    plans: run.proposals.length,
  }));
  const brief = briefFrom(input.day, runs);
  const plans = brief.plans.length;

  if (input.alreadyRanToday) {
    return { status: "already_ran", detail: ALREADY_RAN_DETAIL, steps, plans, changed: 0, execution: null };
  }

  // A Kill that stops the run is the run's own rule, asked here so the day is not started at all. The same call
  // is made again inside the run, so a change can never slip past it.
  const runStopped = blockedDetail(input.takeover, input.killScope);
  if (runStopped) {
    steps.push({ mind: "executioner", action: STOPPED_ACTION, outcome: "skipped", detail: runStopped, plans: 0 });
    return { status: "done", detail: runStopped, steps, plans, changed: 0, execution: null };
  }

  let execution: PipelineExecution;
  try {
    execution = await ports.runExecutioner(brief);
  } catch {
    execution = { status: "failed", detail: "The day's run could not be finished. Nothing else changed.", changed: 0 };
  }
  steps.push({ mind: "executioner", action: "Ran the day", outcome: execution.changed > 0 ? "done" : "skipped", detail: execution.detail, plans: 0 });

  return {
    status: "done",
    detail: execution.detail,
    steps,
    plans,
    changed: execution.changed,
    execution,
  };
}

/** The pipeline's own count line for the log and the tick's answer: how many minds ran, and how many changes. */
export function pipelineSummaryLine(result: PipelineResult): string {
  const ran = result.steps.filter((step) => step.mind !== "executioner").length;
  const changes = result.changed === 1 ? "1 change" : `${result.changed} changes`;
  return `${ran} of ${LIVING_MINDS.length} minds ran, then the Executioner: ${changes}.`;
}
