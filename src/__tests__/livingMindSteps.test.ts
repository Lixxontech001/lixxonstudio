import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as server from '../../supabase/functions/_shared/buddyLivingMinds';
import { buildBriefing, type BriefingFacts, type BriefingMindRow } from '../../supabase/functions/_shared/buddyBriefing';
import * as srcCore from '../buddy/minds/mindCore';
import * as srcAnalyst from '../buddy/minds/analyst';
import * as srcStrategist from '../buddy/minds/strategist';
import * as srcCeo from '../buddy/minds/ceo';
import * as srcGuards from '../buddy/minds/mindGuards';

// Phase D slice 5: the Analyst, the Strategist and the CEO run on the day run. They are not stubs: each one thinks
// through the brain chain (a fake here) and writes one daily-log row. The briefing reads those rows.
// Every think in these tests is a fake. The server copy must match the src originals word for word.

const CONTEXT = { takeover: true, killScope: 'none' as const, facts: 'Last 7 days: 3 article views.', orders: ['Sort the spring kit plan'] };

function fakeWorld(thinkImpl: (request: server.LivingThinkRequest) => Promise<server.LivingThinkResult>) {
  const logs: server.LivingLogEntry[] = [];
  const think = vi.fn(thinkImpl);
  const ports: server.LivingMindPorts = {
    think,
    log: vi.fn(async (entry: server.LivingLogEntry) => {
      logs.push(entry);
    }),
  };
  return { ports, logs, think };
}

const GOOD_REPLY = JSON.stringify({ summary: 'Views went up a little.', proposals: [{ kind: 'note', text: 'Views rose by two.' }] });

describe('the day run calls the three living minds, in order, and each writes its own row', () => {
  it('Analyst, Strategist and CEO each think once, in that order, and each logs one done row', async () => {
    const { ports, logs, think } = fakeWorld(async () => ({ ok: true, text: GOOD_REPLY }));
    const runs = await server.runLivingMinds(ports, CONTEXT);
    expect(think.mock.calls.map((call) => call[0].mind)).toEqual(['analyst', 'strategist', 'ceo']);
    expect(logs.map((row) => row.mind)).toEqual(['analyst', 'strategist', 'ceo']);
    expect(logs.map((row) => row.outcome)).toEqual(['done', 'done', 'done']);
    expect(logs.map((row) => row.action)).toEqual(['Read the site numbers', 'Suggested next steps', 'Put the orders in order']);
    expect(runs).toHaveLength(3);
  });

  it('none of the three is a stub: each one reads the facts and the waiting orders into its prompt', async () => {
    const { ports, think } = fakeWorld(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(ports, CONTEXT);
    for (const call of think.mock.calls) {
      expect(call[0].prompt).toContain('Last 7 days: 3 article views.');
      expect(call[0].prompt).toContain('Sort the spring kit plan');
      expect(call[0].system).toContain(server.MIND_RULES);
    }
    expect(think.mock.calls[0][0].system).toContain(server.ANALYST_ROLE);
    expect(think.mock.calls[1][0].system).toContain(server.STRATEGIST_ROLE);
    expect(think.mock.calls[2][0].system).toContain(server.CEO_ROLE);
  });

  it('a proposal of a kind the minds may not make is refused, counted, and not kept', async () => {
    const reply = JSON.stringify({ summary: 'Done.', proposals: [{ kind: 'publish', text: 'Publish it now' }, { kind: 'note', text: 'Fine note' }] });
    const { ports, logs } = fakeWorld(async () => ({ ok: true, text: reply }));
    const runs = await server.runLivingStep(ports, 'analyst', CONTEXT);
    expect(runs.proposals).toEqual([{ kind: 'note', text: 'Fine note' }]);
    expect(runs.refused).toBe(1);
    expect(logs[0].detail).toMatch(/Refused 1 step/);
  });

  it('no brain key saved: each mind writes the honest "Cannot think" row, and nothing is made up', async () => {
    const { ports, logs } = fakeWorld(async () => ({ ok: false, reason: 'no_key' }));
    await server.runLivingMinds(ports, CONTEXT);
    expect(logs.map((row) => row.outcome)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(logs.every((row) => row.action === server.NO_KEY_ACTION)).toBe(true);
  });

  it('every brain failing is an honest failed row for that mind, and the next mind still runs', async () => {
    const { ports, logs, think } = fakeWorld(async () => ({ ok: false, reason: 'rate_limited' }));
    await server.runLivingMinds(ports, CONTEXT);
    expect(think).toHaveBeenCalledTimes(3);
    expect(logs.map((row) => row.outcome)).toEqual(['failed', 'failed', 'failed']);
    expect(logs[0].detail).toBe('The brains are busy. Try again later.');
  });

  it('a think that throws is an honest "could not think", and does not stop the run', async () => {
    const { ports, logs } = fakeWorld(async () => {
      throw new Error('network');
    });
    await server.runLivingMinds(ports, CONTEXT);
    expect(logs).toHaveLength(3);
    expect(logs.every((row) => row.outcome === 'failed')).toBe(true);
  });

  it('Kill all stops every living mind before it thinks', async () => {
    const { ports, logs, think } = fakeWorld(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(ports, { ...CONTEXT, killScope: 'all' });
    expect(think).not.toHaveBeenCalled();
    expect(logs.every((row) => row.action === server.STOPPED_ACTION && row.detail === server.STOPPED_DETAIL)).toBe(true);
  });

  it('Kill the CEO only stops the CEO: the Analyst and the Strategist still run', async () => {
    const { ports, logs, think } = fakeWorld(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(ports, { ...CONTEXT, killScope: 'ceo' });
    expect(think.mock.calls.map((call) => call[0].mind)).toEqual(['analyst', 'strategist']);
    expect(logs.map((row) => row.outcome)).toEqual(['done', 'done', 'skipped']);
  });

  it('the day run guards the steps: they run only on a run with no order named, a done mind is not run again today, and the steps read facts through a fixed read', () => {
    const placement = readFileSync(resolve(__dirname, '../../supabase/functions/minds-run-placement/index.ts'), 'utf8');
    expect(placement).toMatch(/if \(orderId === null\) \{\s*try \{\s*await runLivingMindsForDay/);
    expect(placement).toMatch(/\.in\("mind", \[\.\.\.LIVING_MINDS\]\);\s*if \(today\.error\) return;/);
    expect(placement).toMatch(/doneToday\.length === LIVING_MINDS\.length\) return;/);
    expect(placement).toMatch(/log: async \(entry\) => \{\s*await sb\.from\("minds_daily_log"\)\.insert\(\{/);
  });
});

describe('the briefing reads the living minds rows', () => {
  it('a living step row shows in "The five minds" section of the morning briefing', async () => {
    const { ports, logs } = fakeWorld(async () => ({ ok: true, text: GOOD_REPLY }));
    await server.runLivingMinds(ports, CONTEXT);
    const rows: BriefingMindRow[] = logs.map((row, index) => ({
      happened_at: `2026-10-10T0${index + 1}:00:00Z`,
      mind: row.mind,
      action: row.action,
      outcome: row.outcome,
      detail: row.detail,
    }));
    const facts: BriefingFacts = {
      articles: { ok: true, count: 0, titles: [] },
      orders: { ok: true, paidCount: 0, usdTotal: 0 },
      views: { ok: true, count: 0 },
      failures: { ok: true, count: 0, codes: [] },
      minds: { ok: true, rows },
    };
    const result = buildBriefing(facts, new Date('2026-10-10T08:00:00Z'), '2026-10-09T08:00:00Z', false);
    expect(result.quiet).toBe(false);
    const section = result.sections.find((item) => item.id === 'minds');
    expect(section?.lines.some((line) => line.startsWith('Analyst: Read the site numbers. Done.'))).toBe(true);
    expect(section?.lines.some((line) => line.startsWith('Strategist: Suggested next steps. Done.'))).toBe(true);
    expect(section?.lines.some((line) => line.startsWith('CEO: Put the orders in order. Done.'))).toBe(true);
  });
});

describe('the server copy matches the src originals (parity)', () => {
  it('the rules, the roles, the actions and the Kill and no-key wording are the same words', () => {
    expect(server.MIND_RULES).toBe(srcCore.MIND_RULES);
    expect(server.ANALYST_ROLE).toBe(srcAnalyst.ANALYST_ROLE);
    expect(server.STRATEGIST_ROLE).toBe(srcStrategist.STRATEGIST_ROLE);
    expect(server.CEO_ROLE).toBe(srcCeo.CEO_ROLE);
    expect(server.NO_KEY_ACTION).toBe(srcGuards.NO_KEY_ACTION);
    expect(server.NO_KEY_DETAIL).toBe(srcGuards.NO_KEY_DETAIL);
    expect(server.STOPPED_ACTION).toBe(srcGuards.STOPPED_ACTION);
    expect(server.STOPPED_DETAIL).toBe(srcGuards.STOPPED_DETAIL);
    expect(server.SUMMARY_LIMIT).toBe(srcCore.SUMMARY_LIMIT);
    expect(server.DETAIL_LIMIT).toBe(srcCore.DETAIL_LIMIT);
    expect(server.PROPOSAL_LIMIT).toBe(srcCore.PROPOSAL_LIMIT);
    expect([...server.PROPOSAL_KINDS]).toEqual([...srcGuards.PROPOSAL_KINDS]);
  });

  it('the action names match the src analyst, strategist and CEO steps', async () => {
    const sent: string[] = [];
    const ports = {
      think: async () => ({ ok: true as const, text: GOOD_REPLY }),
      log: async (entry: { action: string }) => {
        sent.push(entry.action);
      },
    };
    await server.runLivingMinds(ports, CONTEXT);
    expect(sent).toEqual(['Read the site numbers', 'Suggested next steps', 'Put the orders in order']);
  });

  it('the reply parser gives the same answer as the src parser on the same fixtures', () => {
    const fixtures = [
      GOOD_REPLY,
      '```json\n' + GOOD_REPLY + '\n```',
      'Just a plain sentence, no JSON at all.',
      '{"summary": "Two", "proposals": [{"kind": "sort", "text": "Put the kit first"}, "junk"]}',
      '{"summary": 5, "proposals": "none"}',
      '',
    ];
    for (const text of fixtures) {
      expect(server.parseMindReply(text)).toEqual(srcCore.parseMindReply(text));
    }
  });

  it('the prompt builder gives the same prompt as the src builder', () => {
    const ctx = { takeover: true, killScope: 'none' as const, facts: 'A fact.', orders: ['One order', 'Two order'] };
    const srcCtx = { takeover: true, killScope: 'none' as const, facts: 'A fact.', orders: ['One order', 'Two order'] };
    expect(server.factsPrompt(ctx)).toBe(srcCore.factsPrompt(srcCtx));
    expect(server.factsPrompt({ ...ctx, facts: '', orders: [] })).toBe(srcCore.factsPrompt({ ...srcCtx, facts: '', orders: [] }));
  });

  it('the failure wording and the refusal wording match the src originals', () => {
    const reasons = ['no_key', 'rejected', 'rate_limited', 'unavailable', 'empty'] as const;
    for (const reason of reasons) {
      expect(server.failureDetail(reason)).toBe(srcCore.failureDetail(reason));
    }
    expect(server.refusedDetail(1)).toBe(srcGuards.refusedDetail(1));
    expect(server.refusedDetail(2)).toBe(srcGuards.refusedDetail(2));
  });
});
