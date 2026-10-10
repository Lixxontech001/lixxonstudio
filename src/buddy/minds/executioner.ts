import { MIND_RULES, factsPrompt, finish, runThinkingMind, stoppedRun } from './mindCore';
import { NO_WRITER_DETAIL, TAKEOVER_OFF_ACTION, TAKEOVER_OFF_DETAIL } from './mindGuards';
import { runAuditor } from './auditor';
import type { MindContext, MindPorts, MindRun } from './mindTypes';

/** The Executioner prepares work for an approved change. It never carries one out. */
export const EXECUTIONER_ROLE = 'Your job: prepare a short plan for an approved change. Use kind "prepare". You do not carry it out.';
/** At most this many plans are checked in one run, so a run stays small. */
export const MAX_PLANS = 3;

/**
 * Rules, in order:
 * 1. Kill stops it first.
 * 2. Takeover off means it does nothing at all: no thinking, no checks, no site changes.
 * 3. Takeover on: it plans once, and every plan goes to the Auditor. An allowed plan is still
 *    held, because no site writer is connected. Nothing changes on the site in this phase.
 */
export async function runExecutioner(ports: MindPorts, context: MindContext): Promise<MindRun> {
  const stopped = stoppedRun(ports, 'executioner', context);
  if (stopped) return stopped;

  if (!context.takeover) {
    return finish(ports, { mind: 'executioner', action: TAKEOVER_OFF_ACTION, outcome: 'skipped', detail: TAKEOVER_OFF_DETAIL });
  }

  const planned = await runThinkingMind(ports, 'executioner', context, {
    action: 'Prepared work for review',
    system: `${MIND_RULES} ${EXECUTIONER_ROLE}`,
    prompt: factsPrompt(context),
  });
  if (planned.entry.outcome !== 'done') return planned;

  const plans = planned.proposals.slice(0, MAX_PLANS);
  if (plans.length === 0) {
    return finish(ports, { mind: 'executioner', action: 'Held for you', outcome: 'skipped', detail: 'No plan to check. Nothing changed on the site.' }, [], planned.refused);
  }

  let allowed = 0;
  for (const plan of plans) {
    const verdict = await runAuditor(ports, context, plan);
    if (verdict.verdict === 'allow') allowed += 1;
  }
  const detail = allowed > 0
    ? `${allowed} plan${allowed === 1 ? '' : 's'} passed the Auditor. ${NO_WRITER_DETAIL}`
    : 'No plan passed the Auditor. Nothing changed on the site.';
  return finish(ports, { mind: 'executioner', action: 'Held for a site writer', outcome: 'skipped', detail }, [], planned.refused);
}
