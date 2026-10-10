/**
 * The five background minds, and the owner's Kill and Takeover settings for them.
 * Buddy is the only voice the owner hears. The minds never talk to the owner directly.
 */
export const MIND_KEYS = ['analyst', 'strategist', 'ceo', 'executioner', 'auditor'] as const;
export type MindKey = (typeof MIND_KEYS)[number];

/** Kill stops nothing, everything, or one named mind. */
export type KillScope = 'none' | 'all' | MindKey;

export type MindInfo = { key: MindKey; name: string; job: string };

export const MINDS: readonly MindInfo[] = [
  { key: 'analyst', name: 'Analyst', job: 'Reads the site numbers and says what changed.' },
  { key: 'strategist', name: 'Strategist', job: 'Suggests what to do next, and why.' },
  { key: 'ceo', name: 'CEO', job: 'Sorts the plans and puts them in order.' },
  { key: 'executioner', name: 'Executioner', job: 'Prepares packs and the free-door send. Publishes nothing while Takeover is off. Never posts the four you post by hand.' },
  { key: 'auditor', name: 'Auditor', job: 'Checks every plan before it moves. Only you can switch it off.' },
];

export const KILL_OPTIONS: readonly { value: KillScope; label: string }[] = [
  { value: 'none', label: 'Nothing stopped' },
  { value: 'all', label: 'Stop all five minds' },
  ...MINDS.map((mind) => ({ value: mind.key, label: `Stop ${mind.name} only` })),
];

export function isKillScope(value: unknown): value is KillScope {
  return value === 'none' || value === 'all' || (typeof value === 'string' && (MIND_KEYS as readonly string[]).includes(value));
}

/** True when the Kill setting stops this mind. Kill all stops every mind. */
export function isKilled(scope: KillScope, key: MindKey): boolean {
  return scope === 'all' || scope === key;
}

/** The short status line on a mind's card. Plain words. "Nothing has run yet" only when the log is empty for it. */
export function mindStatus(takeover: boolean, scope: KillScope, key: MindKey, hasRun = false): string {
  if (isKilled(scope, key)) return 'Stopped by Kill.';
  if (hasRun) return 'Waiting for the next run.';
  if (takeover) return 'Takeover is on. Nothing has run yet.';
  return 'Waiting. Nothing has run yet.';
}
