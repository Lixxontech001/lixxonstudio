import { MIND_RULES, factsPrompt, runThinkingMind } from './mindCore';
import type { MindContext, MindPorts, MindRun } from './mindTypes';

/** The CEO puts the owner's waiting orders and plans in order of priority. One thinking call. */
export const CEO_ROLE = 'Your job: put the waiting orders and plans in order of priority. Use kind "sort".';

export function runCeo(ports: MindPorts, context: MindContext): Promise<MindRun> {
  return runThinkingMind(ports, 'ceo', context, {
    action: 'Put the orders in order',
    system: `${MIND_RULES} ${CEO_ROLE}`,
    prompt: factsPrompt(context),
  });
}
