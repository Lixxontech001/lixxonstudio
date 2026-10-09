import { isKilled } from './mindRoster';
import { thinkOnce, clip } from './mindCore';
import { NO_KEY_ACTION, STOPPED_ACTION, STOPPED_DETAIL, isProposalKind } from './mindGuards';
import type { AuditVerdict, MindContext, MindPorts, Proposal } from './mindTypes';

export const AUDITOR_ACTION = 'Checked a plan';
export const AUDITOR_RULES = [
  'You are the Auditor. Check one proposed step against the rules.',
  'Block anything that publishes, edits article text, changes prices, creates products,',
  'sends email or messages, spends money, switches off a mind, or speaks to a customer as the owner.',
  'Reply with JSON only, in this shape: {"verdict": "allow" or "block", "fix": "one plain sentence telling the owner what to change, or why it is fine"}.',
].join(' ');

export const AUDITOR_STOPPED_FIX = 'The Auditor is stopped by Kill, so no plan can pass. Set Kill back to Nothing stopped in Minds.';
export const AUDITOR_NO_KEY_FIX = 'Add the Google key in Admin under Automation keys, so the Auditor can check plans.';
export const AUDITOR_UNCLEAR_FIX = 'The Auditor could not give a clear answer. Try again later.';
export const AUDITOR_KIND_FIX = 'Remove that step, or ask Buddy for a plan that stays within the rules.';

/** Reads the Auditor's reply. Only an exact "allow" or "block" counts. Anything else is treated as a block. */
export function parseAuditReply(text: string): { verdict: 'allow' | 'block' | null; fix: string } {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return { verdict: null, fix: '' };
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const verdict = typeof parsed.verdict === 'string' ? parsed.verdict.trim().toLowerCase() : '';
    const fix = typeof parsed.fix === 'string' ? clip(parsed.fix, 300) : '';
    if (verdict === 'allow' || verdict === 'block') return { verdict, fix };
    return { verdict: null, fix: '' };
  } catch {
    return { verdict: null, fix: '' };
  }
}

/**
 * The Auditor checks one proposed step. It allows only with a clear "allow" from the model.
 * It blocks when stopped, when the kind is not allowed, when there is no key, and when unsure.
 * Nothing in the system can switch the Auditor off: see requestDisable in mindGuards.
 */
export async function runAuditor(ports: MindPorts, context: MindContext, plan: Proposal | { kind: unknown; text: string }): Promise<AuditVerdict> {
  if (isKilled(context.killScope, 'auditor')) {
    await ports.log({ mind: 'auditor', action: STOPPED_ACTION, outcome: 'skipped', detail: STOPPED_DETAIL });
    return { verdict: 'block', fix: AUDITOR_STOPPED_FIX };
  }
  if (!isProposalKind(plan.kind)) {
    await ports.log({ mind: 'auditor', action: AUDITOR_ACTION, outcome: 'blocked', detail: `Blocked. ${AUDITOR_KIND_FIX}` });
    return { verdict: 'block', fix: AUDITOR_KIND_FIX };
  }

  const result = await thinkOnce(ports, 'auditor', AUDITOR_RULES, `Proposed step (${plan.kind}): ${plan.text}`);
  if (!result.ok) {
    if (result.reason === 'no_key') {
      await ports.log({ mind: 'auditor', action: NO_KEY_ACTION, outcome: 'skipped', detail: '' });
      return { verdict: 'block', fix: AUDITOR_NO_KEY_FIX };
    }
    await ports.log({ mind: 'auditor', action: 'Could not check a plan', outcome: 'failed', detail: AUDITOR_UNCLEAR_FIX });
    return { verdict: 'block', fix: AUDITOR_UNCLEAR_FIX };
  }

  const reply = parseAuditReply(result.text);
  if (!reply.verdict) {
    await ports.log({ mind: 'auditor', action: 'Could not check a plan', outcome: 'failed', detail: AUDITOR_UNCLEAR_FIX });
    return { verdict: 'block', fix: AUDITOR_UNCLEAR_FIX };
  }
  if (reply.verdict === 'allow') {
    const fix = reply.fix || 'No problems found.';
    await ports.log({ mind: 'auditor', action: AUDITOR_ACTION, outcome: 'done', detail: `Allowed. ${fix}` });
    return { verdict: 'allow', fix };
  }
  const fix = reply.fix || 'Change the step so it stays within the rules.';
  await ports.log({ mind: 'auditor', action: AUDITOR_ACTION, outcome: 'blocked', detail: `Blocked. ${fix}` });
  return { verdict: 'block', fix };
}
