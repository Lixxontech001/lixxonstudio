import { describe, expect, it, vi } from 'vitest';
import analystSource from '../buddy/minds/analyst.ts?raw';
import strategistSource from '../buddy/minds/strategist.ts?raw';
import ceoSource from '../buddy/minds/ceo.ts?raw';
import executionerSource from '../buddy/minds/executioner.ts?raw';
import auditorSource from '../buddy/minds/auditor.ts?raw';
import mindCoreSource from '../buddy/minds/mindCore.ts?raw';
import mindGuardsSource from '../buddy/minds/mindGuards.ts?raw';
import mindTypesSource from '../buddy/minds/mindTypes.ts?raw';
import { runAnalyst } from '../buddy/minds/analyst';
import { runStrategist } from '../buddy/minds/strategist';
import { runCeo } from '../buddy/minds/ceo';
import { runExecutioner, MAX_PLANS } from '../buddy/minds/executioner';
import { runAuditor, AUDITOR_NO_KEY_FIX, AUDITOR_STOPPED_FIX, parseAuditReply } from '../buddy/minds/auditor';
// The four day-run minds in their fixed order. Phase F removed the unwired client aggregate (mindRun.ts);
// this test file is its only caller, so the order lives here, next to the tests that pin it.
async function runAllMinds(ports: MindPorts, context: MindContext) {
  return [
    await runAnalyst(ports, context),
    await runStrategist(ports, context),
    await runCeo(ports, context),
    await runExecutioner(ports, context),
  ];
}
import {
  NO_KEY_ACTION,
  NO_WRITER_DETAIL,
  PROPOSAL_KINDS,
  STOPPED_ACTION,
  TAKEOVER_OFF_ACTION,
  requestDisable,
} from '../buddy/minds/mindGuards';
import { MINDS, type MindKey } from '../buddy/minds/mindRoster';
import type { MindContext, MindLogEntry, MindPorts, ThinkRequest, ThinkResult } from '../buddy/minds/mindTypes';

type ThinkFn = (request: ThinkRequest) => Promise<ThinkResult>;

/** Fake ports: the only two doors a mind has. Every call is recorded. */
function fakePorts(think: ThinkFn) {
  const thinkCalls: ThinkRequest[] = [];
  const logs: MindLogEntry[] = [];
  const ports: MindPorts = {
    think: async (request) => {
      thinkCalls.push(request);
      return think(request);
    },
    log: async (entry) => {
      logs.push(entry);
    },
  };
  return { ports, thinkCalls, logs };
}

function context(overrides: Partial<MindContext> = {}): MindContext {
  return { takeover: false, killScope: 'none', facts: 'Two articles were published this week.', orders: ['Check the spring guide'], ...overrides };
}

const OK_REPLY = JSON.stringify({ summary: 'Sales were steady.', proposals: [{ kind: 'note', text: 'Sales were steady this week.' }] });
const AUDIT_ALLOW = JSON.stringify({ verdict: 'allow', fix: 'Fine to go ahead.' });
const AUDIT_BLOCK = JSON.stringify({ verdict: 'block', fix: 'Remove the price change.' });

const FORBIDDEN_KINDS = [
  'publish_post', 'write_post_content', 'edit_article', 'send_email', 'send_push', 'create_product',
  'change_price', 'spend', 'reply_as_owner', 'message_customer', 'disable_mind',
];

describe('no Google key', () => {
  const noKey: ThinkFn = async () => ({ ok: false, reason: 'no_key' });

  it('reads "Cannot think: no brain key saved" as the last action for each thinking mind', async () => {
    const runs = [
      await runAnalyst(fakePorts(noKey).ports, context()),
      await runStrategist(fakePorts(noKey).ports, context()),
      await runCeo(fakePorts(noKey).ports, context()),
    ];
    for (const run of runs) {
      expect(run.entry.action).toBe(NO_KEY_ACTION);
      expect(run.entry.outcome).toBe('skipped');
      expect(run.proposals).toEqual([]);
    }
    expect(NO_KEY_ACTION).toBe('Cannot think: no brain key saved');
  });

  it('the Executioner with Takeover on, and the Auditor, also say they cannot think', async () => {
    const executioner = fakePorts(noKey);
    const run = await runExecutioner(executioner.ports, context({ takeover: true }));
    expect(run.entry.action).toBe(NO_KEY_ACTION);
    expect(executioner.logs[executioner.logs.length - 1]?.action).toBe(NO_KEY_ACTION);

    const auditor = fakePorts(noKey);
    const verdict = await runAuditor(auditor.ports, context(), { kind: 'prepare', text: 'Prepare a draft' });
    expect(verdict).toEqual({ verdict: 'block', fix: AUDITOR_NO_KEY_FIX });
    expect(auditor.logs[0]).toMatchObject({ mind: 'auditor', action: NO_KEY_ACTION, outcome: 'skipped' });
  });

  it('a mind that cannot think never guesses work: nothing is proposed', async () => {
    const { ports, logs } = fakePorts(noKey);
    await runAllMinds(ports, context({ takeover: true }));
    expect(logs.every((entry) => entry.outcome !== 'done')).toBe(true);
  });
});

describe('Kill and Takeover', () => {
  it('Kill all means no run: no mind thinks, and each logs a stopped step', async () => {
    const { ports, thinkCalls, logs } = fakePorts(async () => ({ ok: true, text: OK_REPLY }));
    const runs = await runAllMinds(ports, context({ takeover: true, killScope: 'all' }));
    expect(thinkCalls).toHaveLength(0);
    expect(runs).toHaveLength(4);
    for (const run of runs) expect(run.entry).toMatchObject({ action: STOPPED_ACTION, outcome: 'skipped', detail: 'Stopped by Kill.' });
    expect(logs).toHaveLength(4);
  });

  it('Kill on one mind stops only that mind', async () => {
    const { ports, thinkCalls } = fakePorts(async () => ({ ok: true, text: OK_REPLY }));
    await runAllMinds(ports, context({ killScope: 'ceo' }));
    const minds = thinkCalls.map((call) => call.mind);
    expect(minds).toEqual(['analyst', 'strategist']);
  });

  it('a stopped Auditor blocks every plan, so the Executioner cannot pass anything', async () => {
    const { ports, thinkCalls } = fakePorts(async () => ({ ok: true, text: AUDIT_ALLOW }));
    const verdict = await runAuditor(ports, context({ killScope: 'auditor' }), { kind: 'prepare', text: 'Prepare a draft' });
    expect(verdict).toEqual({ verdict: 'block', fix: AUDITOR_STOPPED_FIX });
    expect(thinkCalls).toHaveLength(0);
  });

  it('Takeover off means no site changes: the Executioner does not think, the Auditor is never called, and nothing is written', async () => {
    const { ports, thinkCalls, logs } = fakePorts(async () => ({ ok: true, text: OK_REPLY }));
    const run = await runExecutioner(ports, context({ takeover: false }));
    expect(thinkCalls).toHaveLength(0);
    expect(run.entry).toMatchObject({ action: TAKEOVER_OFF_ACTION, outcome: 'skipped' });
    expect(run.entry.detail).toBe('Takeover is off, so nothing changed on the site.');
    expect(logs).toHaveLength(1);
  });

  it('Takeover off across a full run: no mind acts on the site, and no Auditor call happens', async () => {
    const { ports, thinkCalls, logs } = fakePorts(async () => ({ ok: true, text: OK_REPLY }));
    await runAllMinds(ports, context({ takeover: false }));
    expect(thinkCalls.map((call) => call.mind)).not.toContain('auditor');
    expect(logs.find((entry) => entry.mind === 'executioner')?.outcome).toBe('skipped');
  });

  it('Takeover on still holds every allowed plan, because no site writer is connected', async () => {
    const { ports, thinkCalls, logs } = fakePorts(async (request) => {
      if (request.mind === 'executioner') return { ok: true, text: JSON.stringify({ summary: 'Plan ready.', proposals: [{ kind: 'prepare', text: 'Draft a short note.' }] }) };
      return { ok: true, text: AUDIT_ALLOW };
    });
    const run = await runExecutioner(ports, context({ takeover: true }));
    expect(thinkCalls.map((call) => call.mind)).toEqual(['executioner', 'auditor']);
    expect(run.entry).toMatchObject({ action: 'Held for a site writer', outcome: 'skipped' });
    expect(run.entry.detail).toContain(NO_WRITER_DETAIL);
    expect(logs.map((entry) => entry.mind)).toEqual(['executioner', 'auditor', 'executioner']);
  });

  it('Takeover on and the Auditor blocks: nothing passes and the owner is told why', async () => {
    const { ports } = fakePorts(async (request) => {
      if (request.mind === 'executioner') return { ok: true, text: JSON.stringify({ summary: 'Plan.', proposals: [{ kind: 'prepare', text: 'Change a price.' }] }) };
      return { ok: true, text: AUDIT_BLOCK };
    });
    const run = await runExecutioner(ports, context({ takeover: true }));
    expect(run.entry.detail).toBe('No plan passed the Auditor. Nothing changed on the site.');
  });

  it('the Executioner checks at most a few plans in one run', async () => {
    const plans = Array.from({ length: 9 }, (_, index) => ({ kind: 'prepare', text: `Plan ${index}` }));
    const { ports, thinkCalls } = fakePorts(async (request) => {
      if (request.mind === 'executioner') return { ok: true, text: JSON.stringify({ summary: 'Many.', proposals: plans }) };
      return { ok: true, text: AUDIT_ALLOW };
    });
    await runExecutioner(ports, context({ takeover: true }));
    expect(thinkCalls.filter((call) => call.mind === 'auditor')).toHaveLength(MAX_PLANS);
  });
});

describe('refusals', () => {
  it.each([
    ['analyst', runAnalyst],
    ['strategist', runStrategist],
    ['ceo', runCeo],
  ] as const)('%s refuses every forbidden kind and keeps only allowed proposals', async (_name, run) => {
    const reply = JSON.stringify({
      summary: 'Checked.',
      proposals: [
        { kind: 'note', text: 'A fine note.' },
        ...FORBIDDEN_KINDS.map((kind) => ({ kind, text: 'Do the forbidden thing.' })),
      ],
    });
    const { ports } = fakePorts(async () => ({ ok: true, text: reply }));
    const result = await run(ports, context());
    expect(result.proposals.map((proposal) => proposal.kind)).toEqual(['note']);
    expect(result.refused).toBe(FORBIDDEN_KINDS.length);
    expect(result.entry.detail).toContain(`Refused ${FORBIDDEN_KINDS.length} steps`);
    for (const proposal of result.proposals) expect(PROPOSAL_KINDS).toContain(proposal.kind);
  });

  it('the Executioner never passes a forbidden kind to the Auditor', async () => {
    const { ports, thinkCalls } = fakePorts(async (request) => {
      if (request.mind === 'executioner') {
        return { ok: true, text: JSON.stringify({ summary: 'Plan.', proposals: FORBIDDEN_KINDS.map((kind) => ({ kind, text: 'Do it.' })) }) };
      }
      return { ok: true, text: AUDIT_ALLOW };
    });
    const run = await runExecutioner(ports, context({ takeover: true }));
    expect(thinkCalls.map((call) => call.mind)).toEqual(['executioner']);
    expect(run.entry.detail).toBe('No plan to check. Nothing changed on the site.');
  });

  it('a reply that is not JSON is kept as a plain summary with no proposals', async () => {
    const { ports } = fakePorts(async () => ({ ok: true, text: 'Sales look steady this week.' }));
    const run = await runAnalyst(ports, context());
    expect(run.proposals).toEqual([]);
    expect(run.entry).toMatchObject({ outcome: 'done', detail: 'Sales look steady this week.' });
  });

  it('a failed call is logged as failed, never as done', async () => {
    const { ports } = fakePorts(async () => ({ ok: false, reason: 'rate_limited' }));
    const run = await runStrategist(ports, context());
    expect(run.entry).toMatchObject({ outcome: 'failed', detail: 'The brains are busy. Try again later.' });
  });

  it('a thrown error from the think port is an honest failure, not a crash', async () => {
    const { ports } = fakePorts(async () => {
      throw new Error('network down');
    });
    const run = await runAnalyst(ports, context());
    expect(run.entry.outcome).toBe('failed');
  });
});

describe('Auditor', () => {
  it('blocks a step of a kind that is not allowed, without calling the model', async () => {
    const { ports, thinkCalls, logs } = fakePorts(async () => ({ ok: true, text: AUDIT_ALLOW }));
    const verdict = await runAuditor(ports, context(), { kind: 'publish_post', text: 'Publish the guide.' });
    expect(verdict.verdict).toBe('block');
    expect(verdict.fix).toMatch(/Remove that step/);
    expect(thinkCalls).toHaveLength(0);
    expect(logs[0].outcome).toBe('blocked');
  });

  it('allows only on a clear allow from the model, with its plain fix', async () => {
    const { ports } = fakePorts(async () => ({ ok: true, text: AUDIT_ALLOW }));
    expect(await runAuditor(ports, context(), { kind: 'prepare', text: 'Draft a short note.' })).toEqual({ verdict: 'allow', fix: 'Fine to go ahead.' });
  });

  it('blocks with a plain fix when the model says block', async () => {
    const { ports } = fakePorts(async () => ({ ok: true, text: AUDIT_BLOCK }));
    expect(await runAuditor(ports, context(), { kind: 'prepare', text: 'Change a price.' })).toEqual({ verdict: 'block', fix: 'Remove the price change.' });
  });

  it('blocks when the model is unclear, and never reads an unclear answer as allow', async () => {
    for (const text of ['maybe', '{"verdict":"Allow?"}', '{"verdict":"sure","fix":""}', '']) {
      const { ports } = fakePorts(async () => ({ ok: true, text }));
      const verdict = await runAuditor(ports, context(), { kind: 'prepare', text: 'Draft a note.' });
      expect(verdict.verdict).toBe('block');
    }
  });

  it('parseAuditReply accepts only exact allow or block', () => {
    expect(parseAuditReply('{"verdict":"ALLOW","fix":"ok"}').verdict).toBe('allow');
    expect(parseAuditReply('{"verdict":"allowed","fix":"ok"}').verdict).toBeNull();
  });
});

describe('the Auditor cannot be disabled', () => {
  it('no mind, and not even the owner through this path, can switch the Auditor off', () => {
    for (const by of [...MINDS.map((mind) => mind.key), 'owner'] as const) {
      expect(requestDisable(by, 'auditor').ok).toBe(false);
    }
  });

  it('a mind cannot switch off any other mind', () => {
    for (const by of MINDS.map((mind) => mind.key) as MindKey[]) {
      for (const target of MINDS.map((mind) => mind.key) as MindKey[]) {
        if (by === target) continue;
        const result = requestDisable(by, target);
        expect(result.ok).toBe(false);
      }
    }
  });

  it('no worker file tries to switch a mind off', () => {
    for (const source of [analystSource, strategistSource, ceoSource, executionerSource, auditorSource]) {
      expect(source).not.toMatch(/requestDisable\(|enabled\s*[:=]\s*false|\.disable\(/);
    }
  });
});

describe('posts.content and the site are never written', () => {
  it('no mind file talks to the database, the site, email or spending', () => {
    const files = [analystSource, strategistSource, ceoSource, executionerSource, auditorSource, mindCoreSource, mindGuardsSource, mindTypesSource];
    for (const source of files) {
      expect(source).not.toMatch(/supabase/i);
      expect(source).not.toMatch(/\bfrom\(/);
      expect(source).not.toMatch(/['"`]posts['"`]|posts\.content/);
      expect(source).not.toMatch(/\bfetch\(/);
    }
  });

  it('the only doors a mind receives are think and log', async () => {
    const seen: string[][] = [];
    const ports: MindPorts = {
      think: vi.fn(async () => ({ ok: true, text: OK_REPLY })),
      log: vi.fn(async () => {}),
    };
    seen.push(Object.keys(ports));
    await runAllMinds(ports, context({ takeover: true }));
    expect(seen[0]).toEqual(['think', 'log']);
  });

  it('a refused write kind never reaches a log row as done', async () => {
    const { ports, logs } = fakePorts(async () => ({
      ok: true,
      text: JSON.stringify({ summary: 'Tried.', proposals: [{ kind: 'write_post_content', text: 'Write the article body.' }] }),
    }));
    await runAnalyst(ports, context());
    expect(logs[0].outcome).toBe('done');
    expect(logs[0].detail).toContain('Refused 1 step');
    expect(logs.map((entry) => entry.detail).join(' ')).not.toContain('Write the article body.');
  });

  it('no owner-visible copy in the minds has an em dash or a banned word', () => {
    for (const source of [mindGuardsSource, mindCoreSource, auditorSource, executionerSource]) {
      expect(source).not.toMatch(/—/);
    }
  });
});
