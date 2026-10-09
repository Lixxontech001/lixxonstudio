import { MIND_RULES, factsPrompt, runThinkingMind } from './mindCore';
import type { MindContext, MindPorts, MindRun } from './mindTypes';

/** The Analyst reads the site facts and says what changed. One thinking call. No site access of its own. */
export const ANALYST_ROLE = 'Your job: read the site facts and say what changed, in plain words. Use kind "note".';

export function runAnalyst(ports: MindPorts, context: MindContext): Promise<MindRun> {
  return runThinkingMind(ports, 'analyst', context, {
    action: 'Read the site numbers',
    system: `${MIND_RULES} ${ANALYST_ROLE}`,
    prompt: factsPrompt(context),
  });
}
