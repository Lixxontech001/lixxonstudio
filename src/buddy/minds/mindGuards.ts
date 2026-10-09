import type { MindKey } from './mindRoster';

/**
 * The only kinds of step a mind may propose. Anything else is refused.
 * Minds may never publish, edit articles, write post content, send email or messages,
 * create products, change prices, spend money, switch off another mind, or speak as the owner.
 * None of those kinds is on this list, so none can be proposed.
 */
export const PROPOSAL_KINDS = ['note', 'suggest', 'sort', 'prepare'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export function isProposalKind(value: unknown): value is ProposalKind {
  return typeof value === 'string' && (PROPOSAL_KINDS as readonly string[]).includes(value);
}

/** The last action when a mind has no Google key. Plain words, no em dash. */
export const NO_KEY_ACTION = 'Cannot think: no Google key';
export const NO_KEY_DETAIL = 'Add the Google key in Admin under Automation keys.';
export const STOPPED_ACTION = 'Did not run';
export const STOPPED_DETAIL = 'Stopped by Kill.';
export const TAKEOVER_OFF_ACTION = 'Held for you';
export const TAKEOVER_OFF_DETAIL = 'Takeover is off, so nothing changed on the site.';
export const NO_WRITER_DETAIL = 'No site writer is connected yet, so nothing changed on the site.';

export function refusedDetail(count: number): string {
  return `Refused ${count} step${count === 1 ? '' : 's'}: minds cannot make that kind of change.`;
}

/** The only answer to "may this mind switch that mind off?" Minds are never allowed to, and the Auditor never. */
export function requestDisable(by: MindKey | 'owner', target: MindKey): { ok: true } | { ok: false; reason: string } {
  if (target === 'auditor') return { ok: false, reason: 'The Auditor cannot be switched off.' };
  if (by !== 'owner') return { ok: false, reason: 'Minds cannot switch off other minds.' };
  return { ok: true };
}
