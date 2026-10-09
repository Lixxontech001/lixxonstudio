import { supabase } from '../../lib/supabaseClient';
import type { MindKey } from './mindRoster';
import type { StepOutcome } from './mindTypes';

/** The newest log row for each mind (and Buddy). Read-only: the browser never writes the log. */
export interface LastAction {
  action: string;
  outcome: StepOutcome;
  detail: string;
  happened_at: string;
}
export type LastActions = Partial<Record<MindKey | 'buddy', LastAction>>;

const OUTCOME_WORDS: Record<StepOutcome, string> = { done: 'Done', skipped: 'Skipped', blocked: 'Blocked', failed: 'Failed' };
const KNOWN_MINDS = ['buddy', 'analyst', 'strategist', 'ceo', 'executioner', 'auditor'] as const;
const KNOWN_OUTCOMES = Object.keys(OUTCOME_WORDS) as StepOutcome[];

/** Keeps the first (newest) row for each mind. Rows that do not match the log shape are ignored. */
export function latestPerMind(rows: unknown[]): LastActions {
  const result: LastActions = {};
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const mind = row.mind;
    if (typeof mind !== 'string' || !(KNOWN_MINDS as readonly string[]).includes(mind)) continue;
    const key = mind as keyof LastActions;
    if (result[key]) continue;
    if (typeof row.action !== 'string' || typeof row.happened_at !== 'string') continue;
    const outcome = KNOWN_OUTCOMES.find((item) => item === row.outcome);
    if (!outcome) continue;
    result[key] = {
      action: row.action,
      outcome,
      detail: typeof row.detail === 'string' ? row.detail : '',
      happened_at: row.happened_at,
    };
  }
  return result;
}

export async function loadLastActions(): Promise<{ ok: true; value: LastActions } | { ok: false }> {
  try {
    const { data, error } = await supabase
      .from('minds_daily_log')
      .select('mind,action,outcome,detail,happened_at')
      .order('happened_at', { ascending: false })
      .limit(100);
    if (error) return { ok: false };
    return { ok: true, value: latestPerMind(Array.isArray(data) ? data : []) };
  } catch {
    return { ok: false };
  }
}

/** The card line. Says what happened in plain words, or that nothing is logged, or that it could not be read. */
export function lastActionLine(last: LastAction | undefined, readable: boolean): string {
  if (!readable) return 'Last action: could not be read.';
  if (!last) return 'Last action: none logged yet.';
  const detail = last.detail.trim() ? ` ${last.detail.trim()}` : '';
  return `Last action: ${last.action}. ${OUTCOME_WORDS[last.outcome]}.${detail}`;
}
