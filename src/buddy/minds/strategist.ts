import { MIND_RULES, factsPrompt, runThinkingMind } from './mindCore';
import type { MindContext, MindPorts, MindRun } from './mindTypes';

/** The Strategist suggests what to do next, and why. One thinking call. */
export const STRATEGIST_ROLE = 'Your job: suggest what to do next, and why. Use kind "suggest".';

export function runStrategist(ports: MindPorts, context: MindContext): Promise<MindRun> {
  return runThinkingMind(ports, 'strategist', context, {
    action: 'Suggested next steps',
    system: `${MIND_RULES} ${STRATEGIST_ROLE}`,
    prompt: factsPrompt(context),
  });
}
