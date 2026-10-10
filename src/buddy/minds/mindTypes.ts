import type { KillScope, MindKey } from './mindRoster';
import type { ProposalKind } from './mindGuards';

export type StepOutcome = 'done' | 'skipped' | 'blocked' | 'failed';

/** One row for the daily log. */
export interface MindLogEntry {
  mind: MindKey;
  action: string;
  outcome: StepOutcome;
  detail: string;
}

export type ThinkFailure = 'no_key' | 'rejected' | 'rate_limited' | 'unavailable' | 'empty';
export type ThinkResult = { ok: true; text: string } | { ok: false; reason: ThinkFailure };
export interface ThinkRequest {
  mind: MindKey;
  system: string;
  prompt: string;
}

/** One way to think. On the server it walks the brain chain, through the existing key path. */
export type ThinkPort = (request: ThinkRequest) => Promise<ThinkResult>;
/** One way to write a log row. Nothing else leaves a mind. */
export type LogPort = (entry: MindLogEntry) => Promise<void>;

/**
 * The only doors a mind has: thinking and logging. There is no database port, no site port,
 * no email port and no spending port, so a mind cannot write to posts, products or customers.
 */
export interface MindPorts {
  think: ThinkPort;
  log: LogPort;
}

/** What a mind is allowed to see for one run. Facts are read by the caller, never by a mind. */
export interface MindContext {
  takeover: boolean;
  killScope: KillScope;
  facts: string;
  orders: string[];
}

export interface Proposal {
  kind: ProposalKind;
  text: string;
}

export interface MindRun {
  entry: MindLogEntry;
  proposals: Proposal[];
  refused: number;
}

export type AuditVerdict = { verdict: 'allow'; fix: string } | { verdict: 'block'; fix: string };
