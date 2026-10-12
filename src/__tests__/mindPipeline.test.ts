// Phase I slice 2: the morning pipeline. The four minds in order, the brief handed forward, and the gates that stop
// the day before anything is thought or changed. Fake brains and fake ports only: no model, no database, no push.
import { describe, expect, it, vi } from 'vitest';
import type { LivingLogEntry, LivingMind, LivingThinkRequest, LivingThinkResult } from '../../supabase/functions/_shared/buddyLivingMinds';
import { TAKEOVER_OFF_DETAIL } from '../../supabase/functions/_shared/runDay';
import {
  ALREADY_RAN_DETAIL,
  BRIEF_LIMIT,
  PIPELINE_ORDER,
  briefFrom,
  briefText,
  pipelineSummaryLine,
  runMindPipeline,
  type PipelineBrief,
  type PipelineExecution,
  type PipelinePorts,
} from '../../supabase/functions/_shared/mindPipeline';
import { runLivingMinds } from '../../supabase/functions/_shared/buddyLivingMinds';

const DAY = '2026-10-14';
const FACTS = 'Last 7 days: 42 article views and 3 paid orders. The 7 days before: 30 article views and 1 paid orders.';
const ORDERS = ['Sort the spring kit plan'];

const reply = (summary: string, proposals: Array<{ kind: string; text: string }> = []) =>
  JSON.stringify({ summary, proposals });

const MINDS_REPLY: Record<string, string> = {
  analyst: reply('Views went up a little.', [{ kind: 'note', text: 'Views rose by twelve.' }]),
  strategist: reply('The kit plan is worth a push.', [{ kind: 'suggest', text: 'Place the skin kit on the guide.' }]),
  ceo: reply('The kit plan comes first.', [{ kind: 'sort', text: 'First the kit plan, then the guides.' }]),
};

/** A world with fake brains, fake logs and a fake Executioner. */
function fakeWorld(overrides: Partial<Record<string, LivingThinkResult>> = {}, execution?: PipelineExecution) {
  const logs: LivingLogEntry[] = [];
  const think = vi.fn(async (request: LivingThinkRequest) => {
    const forced = overrides[request.mind as LivingMind];
    if (forced) return forced;
    return { ok: true as const, text: MINDS_REPLY[request.mind] ?? reply('Nothing to add.') };
  });
  const runExecutioner = vi.fn(async () => execution ?? { status: 'applied', detail: 'Added the kit to the guide.', changed: 1 });
  const ports: PipelinePorts = {
    think,
    log: vi.fn(async (entry: LivingLogEntry) => {
      logs.push(entry);
    }),
    runExecutioner,
  };
  return { ports, logs, think, runExecutioner };
}

const input = (overrides: Partial<Parameters<typeof runMindPipeline>[0]> = {}) => ({
  day: DAY,
  takeover: true,
  killScope: 'none' as const,
  facts: FACTS,
  orders: ORDERS,
  ...overrides,
});

describe('Phase I slice 2: the order of the morning team', () => {
  it('the pipeline is Analyst, Strategist, CEO, then the Executioner', () => {
    expect([...PIPELINE_ORDER]).toEqual(['analyst', 'strategist', 'ceo', 'executioner']);
  });

  it('the three minds think in order, each logs one row, and then the Executioner runs', async () => {
    const { ports, logs, think, runExecutioner } = fakeWorld();
    const result = await runMindPipeline(input(), ports);
    expect(think.mock.calls.map((call) => call[0].mind)).toEqual(['analyst', 'strategist', 'ceo']);
    expect(logs.map((row) => row.mind)).toEqual(['analyst', 'strategist', 'ceo']);
    expect(runExecutioner).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('done');
    expect(result.steps.map((step) => step.mind)).toEqual(['analyst', 'strategist', 'ceo', 'executioner']);
    expect(result.changed).toBe(1);
  });

  it('the Executioner is never called before the three minds have thought', async () => {
    const calls: string[] = [];
    const { ports, think } = fakeWorld();
    think.mockImplementation(async (request: LivingThinkRequest) => {
      calls.push(`think:${request.mind}`);
      return { ok: true as const, text: MINDS_REPLY[request.mind] ?? reply('Nothing to add.') };
    });
    const original = ports.runExecutioner;
    ports.runExecutioner = vi.fn(async (brief: PipelineBrief) => {
      calls.push('executioner');
      return original(brief);
    });
    await runMindPipeline(input(), ports);
    expect(calls).toEqual(['think:analyst', 'think:strategist', 'think:ceo', 'executioner']);
  });

  it('the day is the one the clock named, and the brief carries it', async () => {
    const { ports, runExecutioner } = fakeWorld();
    await runMindPipeline(input(), ports);
    expect(runExecutioner.mock.calls[0][0].day).toBe(DAY);
  });

  it('the minds read the facts and the owner orders, not a canned string', async () => {
    const { ports, think } = fakeWorld();
    await runMindPipeline(input(), ports);
    for (const call of think.mock.calls) {
      expect(call[0].prompt).toContain('42 article views');
      expect(call[0].prompt).toContain(ORDERS[0]);
    }
  });
});

describe('Phase I slice 2: Takeover off means nothing runs', () => {
  it('with Takeover off no port is called at all', async () => {
    const { ports, think, runExecutioner } = fakeWorld();
    const result = await runMindPipeline(input({ takeover: false }), ports);
    expect(result).toEqual({ status: 'held', detail: TAKEOVER_OFF_DETAIL, steps: [], plans: 0, changed: 0, execution: null });
    expect(think).not.toHaveBeenCalled();
    expect(runExecutioner).not.toHaveBeenCalled();
    expect((ports.log as unknown as { mock: { calls: unknown[] } }).mock.calls).toEqual([]);
  });

  it('a Kill that stops the run never starts the day: the Executioner is not called', async () => {
    for (const killScope of ['all', 'strategist', 'executioner', 'auditor'] as const) {
      const { ports, runExecutioner } = fakeWorld();
      const result = await runMindPipeline(input({ killScope }), ports);
      expect(runExecutioner, killScope).not.toHaveBeenCalled();
      expect(result.changed, killScope).toBe(0);
      expect(result.steps.at(-1)?.detail, killScope).toMatch(/Kill/);
    }
  });

  it('a Kill that leaves the run alone still runs the day, and the stopped mind writes its one row', async () => {
    for (const killScope of ['none', 'analyst', 'ceo'] as const) {
      const { ports, logs, runExecutioner } = fakeWorld();
      const result = await runMindPipeline(input({ killScope }), ports);
      expect(runExecutioner, killScope).toHaveBeenCalledTimes(1);
      expect(result.changed, killScope).toBe(1);
      if (killScope !== 'none') {
        const stopped = logs.find((row) => row.mind === killScope);
        expect(stopped?.action, killScope).toBe('Did not run');
      }
    }
  });

  it('the run rule decides a Kill, and it is the same rule the run itself uses', async () => {
    // The pipeline asks blockedDetail; the Executioner asks it again before any change. One rule, two places.
    const { ports } = fakeWorld();
    const stopped = await runMindPipeline(input({ killScope: 'auditor' }), ports);
    expect(stopped.changed).toBe(0);
    expect(stopped.execution).toBeNull();
    const running = await runMindPipeline(input({ killScope: 'ceo' }), ports);
    expect(running.changed).toBe(1);
  });
});

describe('Phase I slice 2: the day runs once, and a finished day stays finished', () => {
  it('a mind with a done row today is not asked again', async () => {
    const { ports, think } = fakeWorld();
    const result = await runMindPipeline(input({ doneToday: ['analyst'] }), ports);
    expect(think.mock.calls.map((call) => call[0].mind)).toEqual(['strategist', 'ceo']);
    expect(result.steps.map((step) => step.mind)).toEqual(['strategist', 'ceo', 'executioner']);
  });

  it('a finished day does not call the Executioner, and says so', async () => {
    const { ports, runExecutioner } = fakeWorld();
    const result = await runMindPipeline(input({ alreadyRanToday: true }), ports);
    expect(runExecutioner).not.toHaveBeenCalled();
    expect(result.status).toBe('already_ran');
    expect(result.detail).toBe(ALREADY_RAN_DETAIL);
  });

  it('a brain that cannot answer is an honest row, and the day still runs', async () => {
    // A missing key is "skipped" (nothing to do about it); any other brain failure is an honest "failed" row.
    const cases: Array<{ reason: string; outcome: string }> = [
      { reason: 'no_key', outcome: 'skipped' },
      { reason: 'unavailable', outcome: 'failed' },
      { reason: 'empty', outcome: 'failed' },
      { reason: 'rate_limited', outcome: 'failed' },
      { reason: 'rejected', outcome: 'failed' },
    ];
    for (const item of cases) {
      const { ports, logs, runExecutioner } = fakeWorld({ analyst: { ok: false, reason: item.reason } as never });
      const pipeline = await runMindPipeline(input(), ports);
      expect(logs[0].outcome, item.reason).toBe(item.outcome);
      expect(runExecutioner, item.reason).toHaveBeenCalledTimes(1);
      expect(pipeline.execution?.changed).toBe(1);
    }
  });

  it('a thrown brain is caught by the thinking step and never breaks the day', async () => {
    const { ports, runExecutioner } = fakeWorld();
    (ports.think as unknown as { mockImplementation: (fn: () => Promise<never>) => void }).mockImplementation(async () => {
      throw new Error('the brain is down');
    });
    const result = await runMindPipeline(input(), ports);
    expect(result.steps.slice(0, 3).every((step) => step.outcome === 'failed')).toBe(true);
    expect(runExecutioner).toHaveBeenCalledTimes(1);
  });

  it('a thrown Executioner is caught, and nothing claims a change', async () => {
    const { ports } = fakeWorld();
    ports.runExecutioner = vi.fn(async () => {
      throw new Error('the run is down');
    });
    const result = await runMindPipeline(input(), ports);
    expect(result.status).toBe('done');
    expect(result.changed).toBe(0);
    expect(result.steps.at(-1)?.detail).toMatch(/could not be finished/);
  });
});

describe('Phase I slice 2: the brief the team hands to the Executioner', () => {
  it('the brief carries each mind in its own words, in order, and the plans it put forward', () => {
    const brief = briefFrom(DAY, [
      { entry: { mind: 'analyst', action: 'Read the site numbers', outcome: 'done', detail: 'Views went up a little.' }, proposals: [{ kind: 'note', text: 'Views rose by twelve.' }], refused: 0 },
      { entry: { mind: 'strategist', action: 'Suggested next steps', outcome: 'done', detail: 'The kit plan is worth a push.' }, proposals: [{ kind: 'suggest', text: 'Place the skin kit on the guide.' }], refused: 0 },
      { entry: { mind: 'ceo', action: 'Put the orders in order', outcome: 'done', detail: 'The kit plan comes first.' }, proposals: [{ kind: 'sort', text: 'First the kit plan, then the guides.' }], refused: 0 },
    ]);
    expect(brief.voices.map((voice) => voice.mind)).toEqual(['analyst', 'strategist', 'ceo']);
    expect(brief.plans).toEqual([
      'note: Views rose by twelve.',
      'suggest: Place the skin kit on the guide.',
      'sort: First the kit plan, then the guides.',
    ]);
    const text = briefText(brief);
    expect(text).toContain('analyst: Views went up a little.');
    expect(text).toContain('suggest: Place the skin kit on the guide.');
  });

  it('a mind that did not finish is not put in the brief', () => {
    const brief = briefFrom(DAY, [
      { entry: { mind: 'analyst', action: 'Could not think', outcome: 'failed', detail: 'No brain could be reached.' }, proposals: [], refused: 0 },
    ]);
    expect(brief.voices).toEqual([]);
    expect(brief.plans).toEqual([]);
    expect(briefText(brief)).toContain('No plans were put forward.');
  });

  it('the brief is clipped, so one long mind cannot flood the run', () => {
    const brief = briefFrom(DAY, [
      { entry: { mind: 'analyst', action: 'Read the site numbers', outcome: 'done', detail: 'x'.repeat(5000) }, proposals: [], refused: 0 },
    ]);
    expect(briefText(brief).length).toBe(BRIEF_LIMIT);
  });

  it('the brief that goes to the Executioner is the one the three minds made', async () => {
    const { ports, runExecutioner, logs } = fakeWorld();
    await runMindPipeline(input(), ports);
    const brief = runExecutioner.mock.calls[0][0];
    expect(brief.voices.map((voice) => voice.mind)).toEqual(['analyst', 'strategist', 'ceo']);
    expect(briefText(brief)).toContain('Place the skin kit on the guide.');
    // The same rows the owner can read: three thinking rows plus the Executioner's own line.
    expect(logs.map((row) => row.action)).toEqual(['Read the site numbers', 'Suggested next steps', 'Put the orders in order']);
  });

  it('the summary line counts the minds, the plans and the changes', async () => {
    const { ports } = fakeWorld();
    const result = await runMindPipeline(input(), ports);
    expect(pipelineSummaryLine(result)).toBe('3 of 3 minds ran, then the Executioner: 1 change.');
    expect(await runLivingMinds({ think: ports.think, log: ports.log }, { takeover: true, killScope: 'none', facts: FACTS, orders: ORDERS })).toHaveLength(3);
  });
});
