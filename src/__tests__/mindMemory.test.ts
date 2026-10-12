import { describe, expect, it } from 'vitest';
import {
  CHAT_LINE_LIMIT,
  MEMORY_CHAT_TURNS,
  NO_CHAT_LINE,
  NO_FACTS_LINE,
  NO_TELLING_LINE,
  factsWithMemory,
  freshTellings,
  memoryBlock,
  memoryFromReads,
  quietWhenNothingNew,
  sameTelling,
  sayKey,
  wasTold,
  type MindMemory,
  type ToldTelling,
} from '../../supabase/functions/_shared/mindMemory';
import { runMindPipeline } from '../../supabase/functions/_shared/mindPipeline';
import { scanNotableSources, type NotablePlan, type NotablePorts } from '../../supabase/functions/_shared/notableSources';
import { buildBriefing, QUIET_LINE, type BriefingFacts } from '../../supabase/functions/_shared/buddyBriefing';
import type { LivingLogEntry } from '../../supabase/functions/_shared/buddyLivingMinds';
import { ownerDayOf as pushOwnerDayOf } from '../../supabase/functions/_shared/notablePushServer';
import { ownerDayOf as clockOwnerDayOf } from '../../supabase/functions/_shared/mindsNightReport';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Phase I slice 4: what a mind remembers (the facts, the last telling, the owner's own chat), and the one rule
// that comes with memory: the same telling is never made twice.

const MEMORY: MindMemory = {
  facts: 'Last 7 days: 40 article views and 2 paid orders.',
  lastTelling: { day: '2026-10-09', text: 'Article views are up this week. 240 in the last 7 days, 110 in the 7 days before.' },
  chat: [
    { speaker: 'owner', text: 'Write the captions for the pack.' },
    { speaker: 'buddy', text: 'Filed for the Executioner.' },
  ],
};

describe('sayKey and sameTelling: the same words, however they are written', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(sayKey('Article views are up this week.')).toBe('article views are up this week');
    expect(sameTelling('Article views are UP this week', 'Article views are up   this week!')).toBe(true);
    expect(sameTelling('Article views are up this week', 'Paid orders are up this week')).toBe(false);
  });

  it('an empty telling is never the same as another empty telling', () => {
    expect(sayKey('   ')).toBe('');
    expect(sameTelling('', '')).toBe(false);
  });
});

describe('wasTold and freshTellings: memory stops the repeat', () => {
  const told: ToldTelling[] = [{ day: '2026-10-09', text: 'Article views are up this week. 240 in the last 7 days, 110 in the 7 days before.' }];

  it('a title the owner has already heard is not fresh', () => {
    expect(wasTold('ARTICLE VIEWS ARE UP THIS WEEK. 240 in the last 7 days, 110 in the 7 days before.', told)).toBe(true);
    expect(wasTold('Paid orders are down this week.', told)).toBe(false);
  });

  it('keeps the new plan and counts the retold one', () => {
    const plans: NotablePlan[] = [
      { key: 'week:2026-W41:views:up', kind: 'week_up', mind: 'analyst', title: 'Article views are up this week.', detail: '240 in the last 7 days, 110 in the 7 days before.' },
      { key: 'week:2026-W41:paid:down', kind: 'week_down', mind: 'analyst', title: 'Paid orders are down this week.', detail: '0 in the last 7 days, 4 in the 7 days before.' },
    ];
    const result = freshTellings(plans, told);
    expect(result.retold).toBe(1);
    expect(result.fresh.map((plan) => plan.key)).toEqual(['week:2026-W41:paid:down']);
  });

  it('the same plan, word for word, is the same telling', () => {
    const result = freshTellings(
      [{ key: 'week:2026-W42:views:up', kind: 'week_up' as const, mind: 'analyst' as const, title: 'Article views are up this week.', detail: '240 in the last 7 days, 110 in the 7 days before.' }],
      told,
    );
    expect(result.retold).toBe(1);
    expect(result.fresh).toEqual([]);
  });

  it('a repeated sentence is never treated as the same telling on its own', () => {
    // Two different sales share one detail sentence. Only the first is memory; the second is real news.
    const sales: ToldTelling[] = [{ day: '2026-10-09', text: 'Paid order: USD 24.00. A paid order came in on the shop. Buddy changed nothing.' }];
    const result = freshTellings(
      [
        { title: 'Paid order: USD 24.00.', detail: 'A paid order came in on the shop. Buddy changed nothing.' },
        { title: 'Paid order: USD 31.50.', detail: 'A paid order came in on the shop. Buddy changed nothing.' },
      ],
      sales,
    );
    expect(result.retold).toBe(1);
    expect(result.fresh.map((plan) => plan.title)).toEqual(['Paid order: USD 31.50.']);
  });

  it('nothing fresh and something retold is the Quiet day', () => {
    expect(quietWhenNothingNew(0, 2)).toBe(QUIET_LINE);
    expect(quietWhenNothingNew(1, 0)).toBeNull();
    expect(quietWhenNothingNew(0, 0)).toBeNull();
  });
});

describe('memoryBlock: facts, the last telling, and this chat', () => {
  it('gives a mind all three, and says the rule out loud', () => {
    const block = memoryBlock(MEMORY);
    expect(block).toContain('Last 7 days: 40 article views and 2 paid orders.');
    expect(block).toContain('What the owner was last told, on 2026-10-09:');
    expect(block).toContain('Article views are up this week.');
    expect(block).toContain('Never tell the owner the same thing twice.');
    expect(block).toContain('Owner: Write the captions for the pack.');
    expect(block).toContain('Buddy: Filed for the Executioner.');
  });

  it('is honest when a part was never read or never said', () => {
    const block = memoryBlock({ facts: '', lastTelling: null, chat: [] });
    expect(block).toContain(NO_FACTS_LINE);
    expect(block).toContain(NO_TELLING_LINE);
    expect(block).toContain(NO_CHAT_LINE);
  });

  it('keeps the last few turns only, and clips a long one', () => {
    const chat = Array.from({ length: MEMORY_CHAT_TURNS + 4 }, (_, index) => ({ speaker: 'owner' as const, text: `turn ${index}` }));
    const block = memoryBlock({ facts: 'x', lastTelling: null, chat: [...chat, { speaker: 'owner', text: 'y'.repeat(CHAT_LINE_LIMIT * 2) }] });
    expect(block).not.toContain('turn 0');
    expect(block).toContain('turn 5');
    const longest = block.split('\n').filter((line) => line.startsWith('- Owner: ')).map((line) => line.length);
    expect(Math.max(...longest)).toBeLessThan(CHAT_LINE_LIMIT + 20);
  });
});

describe('memoryFromReads: rows in, memory out', () => {
  it('keeps the newest telling and drops a telling with no words', () => {
    const memory = memoryFromReads({ facts: 'facts', lastTelling: { day: '2026-10-09', text: 'A sale came in.' } });
    expect(memory.lastTelling).toEqual({ day: '2026-10-09', text: 'A sale came in.' });
    expect(memoryFromReads({ facts: 'facts', lastTelling: { day: '2026-10-09', text: '   ' } }).lastTelling).toBeNull();
  });

  it('maps the chat turns and drops empty ones', () => {
    const memory = memoryFromReads({
      facts: 'facts',
      chat: [{ speaker: 'owner', text: 'Do the packs' }, { speaker: 'buddy', text: '' }, { text: 'Filed.' }],
    });
    expect(memory.chat).toEqual([
      { speaker: 'owner', text: 'Do the packs' },
      { speaker: 'buddy', text: 'Filed.' },
    ]);
  });
});

describe('factsWithMemory: the one block a mind is given', () => {
  it('joins the facts and the memory, and works with either one alone', () => {
    expect(factsWithMemory('site facts', 'memory')).toBe('site facts\n\nmemory');
    expect(factsWithMemory('site facts', null)).toBe('site facts');
    expect(factsWithMemory('', 'memory')).toBe(`${NO_FACTS_LINE}\n\nmemory`);
  });
});

describe('the morning pipeline gives every mind the memory', () => {
  function pipeline(memory?: string) {
    const prompts: string[] = [];
    const logged: LivingLogEntry[] = [];
    let executionerCalls = 0;
    return {
      prompts,
      logged,
      executionerCalls: () => executionerCalls,
      run: () =>
        runMindPipeline(
          { day: '2026-10-10', takeover: true, killScope: 'none', facts: 'Last 7 days: 40 views.', orders: [], memory },
          {
            think: async (request) => {
              prompts.push(request.prompt);
              return { ok: true, text: '{"summary": "Read the numbers.", "proposals": []}' };
            },
            log: async (entry) => {
              logged.push(entry);
            },
            runExecutioner: async () => {
              executionerCalls += 1;
              return { status: 'applied', detail: 'One change.', changed: 1 };
            },
          },
        ),
    };
  }

  it('puts the facts and the memory in front of the Analyst, the Strategist and the CEO', async () => {
    const run = pipeline('What you remember:\nThe owner was last told: views are up.');
    await run.run();
    expect(run.prompts).toHaveLength(3);
    for (const prompt of run.prompts) {
      expect(prompt).toContain('Last 7 days: 40 views.');
      expect(prompt).toContain('What you remember:');
      expect(prompt).toContain('The owner was last told: views are up.');
    }
  });

  it('runs with the facts alone when there is no memory yet', async () => {
    const run = pipeline();
    await run.run();
    expect(run.prompts[0]).toBe('Site facts (read-only):\nLast 7 days: 40 views.\n\nWaiting orders from the owner:\n- none');
  });
});

describe('the shop scan does not retell what the owner already heard', () => {
  const window = { now: new Date('2026-10-10T12:00:00Z'), localDay: '2026-10-10', dayStartIso: '2026-10-10T00:00:00.000Z', dayEndIso: '2026-10-11T00:00:00.000Z' };

  function ports(told: ToldTelling[] | null, failTold = false): { ports: NotablePorts; recorded: NotablePlan[] } {
    const recorded: NotablePlan[] = [];
    return {
      recorded,
      ports: {
        readPaidOrders: async () => [{ id: 'order-1', amount: 24, currency: 'USD' }],
        readClicks: async () => [],
        readEarlierSources: async () => [],
        readTold: async () => {
          if (failTold) return null;
          return told;
        },
        record: async (plan) => {
          recorded.push(plan);
          return true;
        },
      },
    };
  }

  const alreadyTold: ToldTelling[] = [{ day: '2026-10-09', text: 'Paid order: USD 24.00. A paid order came in on the shop. Buddy changed nothing.' }];

  it('leaves out a sale the owner was already told about, and counts it', async () => {
    const fake = ports(alreadyTold);
    const result = await scanNotableSources(fake.ports, window);
    expect(result.retold).toBe(1);
    expect(result.written).toBe(0);
    expect(fake.recorded).toEqual([]);
  });

  it('writes a telling that is new, and reports nothing unreadable', async () => {
    const fake = ports([]);
    const result = await scanNotableSources(fake.ports, window);
    expect(result.written).toBe(1);
    expect(result.retold).toBe(0);
    expect(result.unreadable).toEqual([]);
  });

  it('a memory that cannot be read is reported by name and never silences a real telling', async () => {
    const fake = ports(null, true);
    const result = await scanNotableSources(fake.ports, window);
    expect(result.unreadable).toContain('told');
    expect(result.written).toBe(1);
  });
});

describe('the briefing never prints the same telling twice', () => {
  const base: BriefingFacts = {
    articles: { ok: true, count: 0, titles: [] },
    orders: { ok: true, paidCount: 0, usdTotal: 0 },
    views: { ok: true, count: 0 },
    failures: { ok: true, count: 0, codes: [] },
  };

  it('shows one line for two rows that say the same thing', () => {
    const same = 'The free doors: nothing went out today.';
    const facts: BriefingFacts = {
      ...base,
      notables: {
        ok: true,
        rows: [
          { kind: 'door_skipped', title: 'The free doors: nothing went out today', detail: same },
          { kind: 'door_skipped', title: 'The free doors: nothing went out today', detail: same },
        ],
      },
    };
    const result = buildBriefing(facts, new Date('2026-10-10T12:00:00Z'), '2026-10-09T12:00:00Z', false);
    expect(result.quiet).toBe(false);
    const problems = result.quiet ? [] : result.sections.find((section) => section.id === 'problems')!.lines;
    expect(problems.filter((line) => line === same)).toHaveLength(1);
  });
});

describe('the memory is wired into the 08:00 clock and the pipeline, and reads only', () => {
  const CLOCK = readFileSync(path.join(process.cwd(), 'supabase/functions/minds-morning-clock/index.ts'), 'utf8');
  const PIPELINE = readFileSync(path.join(process.cwd(), 'supabase/functions/_shared/mindPipeline.ts'), 'utf8');
  const RUN = readFileSync(path.join(process.cwd(), 'supabase/functions/minds-run-placement/index.ts'), 'utf8');
  const SERVER = readFileSync(path.join(process.cwd(), 'supabase/functions/_shared/mindMemoryServer.ts'), 'utf8');

  it('the clock reads the last telling and the owner s chat, and hands the block to the pipeline', () => {
    expect(SERVER).toContain('memoryBlock(memoryFromReads({ facts, lastTelling, chat }))');
    expect(SERVER).toContain('from("minds_notable_events")');
    expect(SERVER).toContain('from("buddy_messages")');
    expect(CLOCK).toContain('memory = await readMemoryBlock(sb, ownerId, facts)');
    expect(CLOCK).toContain('memory,');
  });

  it('the owner s own day run gives the minds the same memory, through the same read', () => {
    expect(RUN).toContain('memory = await readMemoryBlock(sb, owner, facts)');
    expect(RUN).toContain('facts: factsWithMemory(facts, memory)');
  });

  it('the pipeline gives the memory to every thinking mind, in one block with the facts', () => {
    expect(PIPELINE).toContain('facts: factsWithMemory(input.facts, input.memory)');
  });

  it('the run reads what the owner has already been told, and reports a dead product through the act list', () => {
    expect(RUN).toContain('const told = await readToldTellings(sb, owner);');
    expect(RUN).toContain('await scanShopNotables(sb, owner, localDay, told);');
    expect(RUN).toContain('for (const act of await scanDeadProducts(sb, localDay, told)) {');
    expect(RUN).toContain('await reportAct(act, acts);');
  });

  it('the run reads today s caption draft and gives it to the pack step only', () => {
    expect(RUN).toContain('await readCaptionDraft(sb, owner, localDay)');
    expect(RUN).toContain('draftedCopy: drafted');
    expect(RUN).toContain('.eq("payload->>kind", "caption_draft")');
  });

  it('the owner-day rule has one meaning, whether it is read from the clock module or the push module', () => {
    const stamps = ['2026-10-10T23:30:00Z', '2026-10-10T10:00:00Z', '2026-01-01T00:10:00Z', 'not a date'];
    for (const stamp of stamps) {
      expect(pushOwnerDayOf(stamp)).toBe(clockOwnerDayOf(stamp));
    }
  });
});
