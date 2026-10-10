import { runAnalyst } from './analyst';
import { runCeo } from './ceo';
import { runExecutioner } from './executioner';
import { runStrategist } from './strategist';
import type { MindContext, MindPorts, MindRun } from './mindTypes';

/**
 * One pass over the four minds that do the day's thinking, in a fixed order.
 * The Auditor is not run on its own here: it checks the Executioner's plans inside that run.
 * The server day run does not call this function. It runs the Analyst, the Strategist and the CEO through its own
 * copy (_shared/buddyLivingMinds.ts, in the functions folder), checked word for word by livingMindSteps.test.ts.
 * This aggregate, with the Executioner too, is not wired to a button or a schedule yet.
 */
export async function runAllMinds(ports: MindPorts, context: MindContext): Promise<MindRun[]> {
  const runs: MindRun[] = [];
  runs.push(await runAnalyst(ports, context));
  runs.push(await runStrategist(ports, context));
  runs.push(await runCeo(ports, context));
  runs.push(await runExecutioner(ports, context));
  return runs;
}
