// @vitest-environment node
// The Phase I freeze: autonomy, checked the way the spec asks for it — Verify, fix, verify again.
// Pass A proves the ten things the Phase I spec names, one describe each, through the real functions wherever a real
// function exists (fake ports only: no network, no live brain, no live door, no live push, no database, no migration
// applied). Source checks are used only for file-level rules and for the order of two calls on one page.
// Pass C re-reads the spec against the source: no silent act, no "which mind", no product created by a mind, no spend.
// Nothing here merges, deploys, or applies a migration. If a rule breaks, this file fails.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runDoors, type DoorRunPorts } from '../../supabase/functions/_shared/runDoors';
import { OPEN_DOORS, isOpenDoor } from '../../supabase/functions/_shared/doorPosts';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';
import { runDayPacks, type DayPacksPorts } from '../../supabase/functions/_shared/dayPacks';
import { runPriceChange, type PriceRunPorts } from '../../supabase/functions/_shared/priceRun';
import { auditPriceChange, type PriceProduct } from '../../supabase/functions/_shared/priceChanges';
import { changeLine, planCompetitorReads, runCompetitorReads, COMPETITOR_READ_LIMIT, type CompetitorRunPorts, type SavedCompetitor } from '../../supabase/functions/_shared/competitors';
import { runMorningClock, morningRunDayDue, type MorningClockPorts } from '../../supabase/functions/_shared/morningClock';
import { KILL_BLOCK_DETAIL, TAKEOVER_OFF_DETAIL, runDay } from '../../supabase/functions/_shared/runDay';
import { ACT_KINDS, auditorBlockedAct, doorPostedAct, doorSkippedAct, priceChangedAct, reportAct, type ActPorts } from '../../supabase/functions/_shared/mindActs';
import { BUZZ_KINDS } from '../../supabase/functions/_shared/notablePush';
import { NEVER_LIST_LINES, mindFit, routeMessage } from '../../supabase/functions/_shared/buddyRouter';
import { HELD_CREATE, HELD_MONEY, laneFor } from '../../supabase/functions/_shared/buddyOrders';
import type { MindThinkResult } from '../../supabase/functions/_shared/mindThink';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const exists = (rel: string) => existsSync(join(ROOT, rel));

/** Every .ts file under a folder, as repo-relative paths. */
function filesUnder(rel: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...filesUnder(join(rel, entry.name)));
    else if (entry.name.endsWith('.ts')) out.push(join(rel, entry.name));
  }
  return out;
}

const DAY = '2026-10-12';
const NOW = Date.parse('2026-10-12T09:00:00Z');

// -------------------------------------------------------------------- fake doors

function doorPorts() {
  const calls: string[] = [];
  const doors: string[] = [];
  const ports: DoorRunPorts = {
    readArticles: async () => {
      calls.push('readArticles');
      return [{ id: 'post-1', title: 'Easy routine for dry skin', slug: 'easy-routine-dry-skin', publishedAt: new Date(NOW - 86_400_000).toISOString() }];
    },
    readPostedIds: async (door) => {
      calls.push('readPostedIds');
      doors.push(door);
      return new Set<string>();
    },
    countToday: async (door) => {
      calls.push('countToday');
      doors.push(door);
      return 0;
    },
    readSecret: async () => {
      calls.push('readSecret');
      return null;
    },
    reserve: async (door) => {
      calls.push('reserve');
      doors.push(door);
      return { ok: true as const, id: `row-${door}` };
    },
    send: async (door) => {
      calls.push('send');
      doors.push(door);
      return { ok: true as const, externalRef: 'ref-1' };
    },
    finish: async () => {
      calls.push('finish');
    },
    readPendingPosts: async () => {
      calls.push('readPendingPosts');
      return [];
    },
    markPending: async () => {
      calls.push('markPending');
    },
    log: async () => {
      calls.push('log');
    },
    countDripsToday: async () => {
      calls.push('countDripsToday');
      return 0;
    },
    recordDrip: async () => {
      calls.push('recordDrip');
      return true;
    },
  };
  return { ports, calls, doors };
}

const DOOR_INPUT = { localDay: DAY, takeover: true, killScope: 'none' as const, nowMs: NOW, siteOrigin: null };

// -------------------------------------------------------------------- fake packs

function packPorts() {
  const calls: string[] = [];
  const ports: DayPacksPorts = {
    think: async (): Promise<MindThinkResult> => {
      calls.push('think');
      return { ok: false, reason: 'no_key' };
    },
    checkImage: async () => {
      calls.push('checkImage');
      return { ok: true, url: 'https://lixxonstudio.example/cover.jpg', contentType: 'image/jpeg', bytes: 4 };
    },
    savePack: async () => {
      calls.push('savePack');
      return { ok: true as const };
    },
    log: async () => {
      calls.push('log');
    },
  };
  return { ports, calls };
}

const PACK_INPUT = {
  localDay: DAY,
  takeover: true,
  killScope: 'none' as const,
  articles: [{ id: 'post-1', title: 'Easy routine for dry skin', slug: 'easy-routine-dry-skin', coverImage: null, liveProductIds: ['p1'] }],
  shop: [{ id: 'p1', name: 'Linen Bath Sheet', isDigital: false, priceUsd: 34 }],
  siteOrigin: null,
  alreadyMade: false,
};

// -------------------------------------------------------------------- fake price

const SHEET: PriceProduct = { id: 'p1', name: 'Linen Bath Sheet', priceUsd: 34, currency: 'USD' };

function pricePorts(answer = '{"product_id":"p1","price":29.5,"why":"It sells well and the price is high."}') {
  const calls: string[] = [];
  const ports: PriceRunPorts = {
    readShop: async () => {
      calls.push('readShop');
      return [SHEET];
    },
    readFacts: async () => {
      calls.push('readFacts');
      return 'This week: 2 paid orders.';
    },
    think: async (): Promise<MindThinkResult> => {
      calls.push('think');
      return { ok: true, text: answer };
    },
    apply: async (candidate) => {
      calls.push('apply');
      return { ok: true as const, fromUsd: 34, newUsd: candidate.priceUsd };
    },
    log: async () => {
      calls.push('log');
    },
  };
  return { ports, calls };
}

// -------------------------------------------------------------------- fake rivals

function competitorPorts() {
  const calls: string[] = [];
  const saved: SavedCompetitor[] = Array.from({ length: 12 }, (_, index) => ({
    id: `c${index}`,
    url: `https://rival.example/${index}`,
    label: `rival.example`,
    lastReadAt: null,
    lastTitle: null,
    lastFingerprint: null,
  }));
  const ports: CompetitorRunPorts = {
    readSaved: async () => {
      calls.push('readSaved');
      return saved;
    },
    readReadToday: async () => {
      calls.push('readReadToday');
      return new Set<string>();
    },
    readPage: async (url) => {
      calls.push(`readPage:${url}`);
      return { ok: true, html: '<title>Rival</title><p>Same words as before.</p>' };
    },
    recordRead: async () => {
      calls.push('recordRead');
      return true;
    },
    log: async () => {
      calls.push('log');
    },
  };
  return { ports, calls };
}

// ==================================================================== PASS A

describe('Pass A1: Takeover off means the run changes nothing at all', () => {
  const OFF = { takeover: false, killScope: 'none' as const };

  it('no door is read, reserved or sent', async () => {
    const { ports, calls } = doorPorts();
    const result = await runDoors({ ...DOOR_INPUT, ...OFF }, ports);
    expect(result).toEqual({ status: 'held', detail: TAKEOVER_OFF_DETAIL, posted: 0, outcomes: [] });
    expect(calls).toEqual([]);
  });

  it('no price is planned, audited or written', async () => {
    const { ports, calls } = pricePorts();
    const result = await runPriceChange({ localDay: DAY, ...OFF }, ports);
    expect(result).toEqual({ status: 'held', detail: TAKEOVER_OFF_DETAIL, act: null });
    expect(calls).toEqual([]);
  });

  it('no pack is drafted or saved', async () => {
    const { ports, calls } = packPorts();
    const result = await runDayPacks({ ...PACK_INPUT, ...OFF }, ports);
    expect(result).toEqual({ status: 'held', detail: TAKEOVER_OFF_DETAIL, saved: 0, postId: null });
    expect(calls).toEqual([]);
  });

  it('a Kill switch stops the same three steps', async () => {
    for (const killScope of ['strategist', 'executioner', 'auditor', 'all'] as const) {
      const doors = doorPorts();
      const price = pricePorts();
      const packs = packPorts();
      expect((await runDoors({ ...DOOR_INPUT, takeover: true, killScope }, doors.ports)).detail).toBe(KILL_BLOCK_DETAIL);
      expect((await runPriceChange({ localDay: DAY, takeover: true, killScope }, price.ports)).detail).toBe(KILL_BLOCK_DETAIL);
      expect((await runDayPacks({ ...PACK_INPUT, takeover: true, killScope }, packs.ports)).detail).toBe(KILL_BLOCK_DETAIL);
      expect(doors.calls).toEqual([]);
      expect(price.calls).toEqual([]);
      expect(packs.calls).toEqual([]);
    }
  });

  it('the day run itself calls nothing when the gate is closed', async () => {
    const createDailyOrder = vi.fn(async () => 'order-1');
    const runOrder = vi.fn(async () => ({ status: 'done', detail: 'ran' }));
    const result = await runDay({ localDay: DAY, trigger: 'daily', takeover: false, killScope: 'none', waiting: [] }, { createDailyOrder, runOrder });
    expect(result).toEqual({ status: 'nothing_to_do', detail: TAKEOVER_OFF_DETAIL, orderId: null });
    expect(createDailyOrder).not.toHaveBeenCalled();
    expect(runOrder).not.toHaveBeenCalled();
  });

  it('the owner-run entry point reads the gate again, before the door step and before the price step', () => {
    const RUN = read('supabase/functions/minds-run-placement/index.ts');
    const gate = RUN.indexOf('blockedDetail(takeover, killScope)');
    expect(gate).toBeGreaterThan(0);
    for (const step of ['await runDoorsSafely(', 'await runCompetitorsForDay(', 'await runPriceChange(', 'await runPacksForDay(sb, owner, localDay, takeover, killScope, think,']) {
      expect(RUN.indexOf(step), step).toBeGreaterThan(gate);
    }
    // And the gate is a real early return, not a flag left behind: the run stops with the gate's own line.
    expect(RUN).toMatch(/if \(blocked\) return out\(/);
  });
});

describe('Pass A2: with Takeover on, the scheduler would run — in a unit test, with a fake clock', () => {
  const owners = { ok: true as const, owners: ['owner-1'] };
  const controlsOn = { ok: true as const, takeover: true, killScope: 'none' as const };
  const controlsOff = { ok: true as const, takeover: false, killScope: 'none' as const };

  it('08:00 is the window, and every tick inside it is due', () => {
    // Owner days run on UTC+1, so 08:00 is 07:00 UTC.
    expect(morningRunDayDue(new Date('2026-10-12T06:59:00Z'))).toBeNull();
    expect(morningRunDayDue(new Date('2026-10-12T07:00:00Z'))).toBe('2026-10-12');
    expect(morningRunDayDue(new Date('2026-10-12T08:30:00Z'))).toBe('2026-10-12');
    expect(morningRunDayDue(new Date('2026-10-12T10:59:00Z'))).toBe('2026-10-12');
    expect(morningRunDayDue(new Date('2026-10-12T11:00:00Z'))).toBeNull();
  });

  it('a due tick with Takeover on queues the day and starts the pipeline', async () => {
    const queueDailyRun = vi.fn(async () => 'order-1');
    const runPipeline = vi.fn(async () => ({ status: 'done', detail: 'ran', minds: 4, plans: 1, changed: 0 }));
    const ports: MorningClockPorts = { readOwners: async () => owners, readControls: async () => controlsOn, queueDailyRun, runPipeline };
    const result = await runMorningClock(new Date('2026-10-12T07:05:00Z'), ports);
    expect(result.status).toBe('done');
    expect(result.day).toBe('2026-10-12');
    expect(result.queued).toBe(1);
    expect(queueDailyRun).toHaveBeenCalledWith('owner-1', '2026-10-12');
    expect(runPipeline).toHaveBeenCalledWith('owner-1', '2026-10-12');
  });

  it('the same tick with Takeover off queues nothing and starts nothing', async () => {
    const queueDailyRun = vi.fn(async () => 'order-1');
    const runPipeline = vi.fn(async () => ({ status: 'done', detail: 'ran', minds: 0, plans: 0, changed: 0 }));
    const result = await runMorningClock(new Date('2026-10-12T07:05:00Z'), {
      readOwners: async () => owners,
      readControls: async () => controlsOff,
      queueDailyRun,
      runPipeline,
    });
    expect(result.status).toBe('takeover_off');
    expect(result.queued).toBe(0);
    expect(queueDailyRun).not.toHaveBeenCalled();
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it('a tick outside the window reads nothing at all', async () => {
    const readOwners = vi.fn(async () => owners);
    const queueDailyRun = vi.fn(async () => 'order-1');
    const result = await runMorningClock(new Date('2026-10-12T05:00:00Z'), {
      readOwners,
      readControls: async () => controlsOn,
      queueDailyRun,
    });
    expect(result.status).toBe('not_due');
    expect(readOwners).not.toHaveBeenCalled();
    expect(queueDailyRun).not.toHaveBeenCalled();
  });
});

describe('Pass A3: an order that names no mind is still never asked about', () => {
  it('every unnamed order is placed by the rules, with its mind and no question', () => {
    for (const message of ['Do the new article', 'Swap the kit onto the article', 'Plan the next week', 'Sort the queue', 'Check the guide']) {
      const route = routeMessage(message, null);
      expect(route.kind, message).toBe('order');
      if (route.kind === 'order') {
        expect(route.mind, message).toBeTruthy();
        expect(route.resolvesPending, message).toBe(false);
      }
    }
    expect(mindFit('Do the new article').mind).toBe('executioner');
  });

  it('no owner-facing line anywhere in the chat path asks which mind', () => {
    const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    const files = ['buddyRouter.ts', 'buddyThink.ts', 'buddyFeedback.ts', 'buddyOrders.ts', 'buddyControls.ts', 'competitors.ts', 'priceChanges.ts', '../buddy-think/index.ts'];
    for (const file of files) {
      const source = strip(read(`supabase/functions/_shared/${file}`));
      // The words may appear only inside an instruction that forbids them: "Never ask in \"reply\" which mind ...".
      for (const hit of source.matchAll(/which mind/gi)) {
        const around = source.slice(Math.max(0, hit.index! - 90), hit.index! + 10).toLowerCase();
        expect(around, `${file}: ${around}`).toContain('never ask');
      }
      expect(source.toLowerCase(), file).not.toMatch(/\?[\s\S]{0,40}which mind/);
    }
  });
});

describe('Pass A4: the Auditor is asked before any live change', () => {
  it('a blocked price is never applied, and the block is told as an Auditor block', async () => {
    const { ports, calls } = pricePorts('{"product_id":"p1","price":0,"why":"Make it free."}');
    const result = await runPriceChange({ localDay: DAY, takeover: true, killScope: 'none' }, ports);
    expect(result.status).toBe('blocked');
    expect(calls).not.toContain('apply');
    if (result.status === 'blocked') {
      expect(result.act.kind).toBe('auditor_blocked');
      expect(result.act.detail).toContain('The Auditor blocked the price twice, so the change was stopped.');
    }
  });

  it('the check runs on the page before the apply call', () => {
    const priceRun = read('supabase/functions/_shared/priceRun.ts');
    expect(priceRun.indexOf('auditPriceChange(')).toBeGreaterThan(0);
    expect(priceRun.indexOf('auditPriceChange(')).toBeLessThan(priceRun.indexOf('ports.apply('));
    // The database door re-checks the same rule itself, so a call that skipped the Auditor still cannot write.
    const migration = read('supabase/migrations/20261025000000_minds_price_changes.sql');
    const fn = migration.slice(migration.indexOf('FUNCTION public.minds_apply_price_change'));
    expect(fn.indexOf('PERFORM public.minds_assert_can_act();')).toBeGreaterThan(0);
    expect(fn.indexOf('PERFORM public.minds_assert_can_act();')).toBeLessThan(fn.indexOf('UPDATE public.products'));
    expect(fn).toContain("RAISE EXCEPTION 'price_free'");
    // The archive drip is the same shape: the gate first, then the row.
    const drip = read('supabase/migrations/20261023000000_minds_door_drip.sql');
    expect(drip.indexOf('PERFORM public.minds_assert_can_act();')).toBeLessThan(drip.indexOf('INSERT INTO public.post_drip_days'));
  });

  it('the Auditor passes a plain change and blocks every rule it names', () => {
    const base = { productId: 'p1', priceUsd: 29.5, why: 'It sells well at this price.' };
    expect(auditPriceChange(base, SHEET).verdict).toBe('allow');
    for (const [candidate, product] of [
      [{ ...base, priceUsd: 0 }, SHEET],
      [{ ...base, priceUsd: 34 }, SHEET],
      [{ ...base, priceUsd: 5 }, SHEET],
      [{ ...base, priceUsd: 30.1, why: 'Set it against the Naira rate.' }, SHEET],
      [base, { ...SHEET, currency: 'NGN' }],
      [base, null],
    ] as const) {
      const verdict = auditPriceChange(candidate, product);
      expect(verdict.verdict).toBe('block');
      expect(verdict.fix.length).toBeGreaterThan(0);
    }
  });
});

describe('Pass A5: every act is told through the one helper', () => {
  function actPorts() {
    const logs: Array<{ mind: string; action: string; outcome: string; detail: string }> = [];
    const notables: Array<{ kind: string; title: string; detail: string; key: string | null }> = [];
    const order: string[] = [];
    const ports: ActPorts = {
      log: async (entry) => {
        logs.push(entry);
        order.push('log');
      },
      notable: async (kind, title, detail, key) => {
        notables.push({ kind, title, detail, key });
        order.push('notable');
      },
    };
    return { ports, logs, notables, order };
  }

  it('a price change and a door post both write the log row and the notable, in that order', async () => {
    const price = actPorts();
    await reportAct(priceChangedAct('Linen Bath Sheet', 34, 29.5, DAY), price.ports);
    expect(price.logs[0]).toMatchObject({ mind: 'executioner', outcome: 'done' });
    expect(price.notables[0]).toMatchObject({ kind: 'price_changed', key: `price_changed:Linen Bath Sheet:${DAY}` });
    // The phone shows the same words as the log row, so the two never disagree.
    expect(price.notables[0]!.detail).toBe(price.logs[0]!.detail);
    expect(price.notables[0]!.title).toContain('$29.50');
    // The old price is named too, so the owner sees both dollars in the same telling.
    expect(price.notables[0]!.detail).toContain('$34.00');
    expect(price.notables[0]!.detail).toContain('$29.50');

    const door = actPorts();
    await reportAct(doorPostedAct('Telegram', 'Easy routine for dry skin', DAY), door.ports);
    expect(door.notables[0]!.kind).toBe('door_posted');
    expect(door.notables[0]!.detail).toBe(door.logs[0]!.detail);

    const skip = actPorts();
    await reportAct(doorSkippedAct('Telegram', 'The door had no key saved.', DAY), skip.ports);
    expect(skip.notables[0]!.kind).toBe('door_skipped');
    expect(skip.notables[0]!.title).toContain('Telegram');
  });

  it('the archive drip says so in the same telling', async () => {
    const { ports, notables } = actPorts();
    await reportAct(doorPostedAct('Telegram', 'An older piece', DAY, true), ports);
    expect(notables[0]!.title).toContain('from the archive');
    expect(notables[0]!.detail).toContain('older than a week');
  });

  it('a phone that cannot be reached never loses the act', async () => {
    const log = vi.fn(async () => {});
    const notable = vi.fn(async () => {
      throw new Error('no device');
    });
    const telling = await reportAct(auditorBlockedAct('Linen Bath Sheet', 'A price of nothing is not a price.'), { log, notable });
    expect(log).toHaveBeenCalledTimes(1);
    expect(telling).toEqual({ logged: true, noticed: false });
  });

  it('every act kind buzzes, and every kind is on the table list', () => {
    for (const kind of ACT_KINDS) expect(BUZZ_KINDS, kind).toContain(kind);
    expect([...ACT_KINDS].sort()).toEqual(['auditor_blocked', 'door_posted', 'door_skipped', 'pack_saved', 'price_changed', 'product_looks_dead']);
  });

  it('the run reports each act through the helper, never by hand', () => {
    const RUN = read('supabase/functions/minds-run-placement/index.ts');
    for (const call of ['reportAct(doorPostedAct(', 'reportAct(doorSkippedAct(', 'reportAct(packSavedAct(', 'reportAct(priced.act, acts)', 'reportAct(act, acts)']) {
      expect(RUN, call).toContain(call);
    }
    expect(RUN).toContain('recordNotable(sb, owner, localDay, "strategist", COMPETITOR_CHANGE_KIND');
  });
});

describe('Pass A6: at most ten rival pages a day', () => {
  it('the plan takes ten, oldest read first, and never a page read today', () => {
    expect(COMPETITOR_READ_LIMIT).toBe(10);
    const saved: SavedCompetitor[] = Array.from({ length: 14 }, (_, index) => ({
      id: `c${index}`,
      url: `https://rival.example/${index}`,
      label: 'rival.example',
      lastReadAt: index === 13 ? null : `2026-10-0${(index % 5) + 1}T06:00:00Z`,
      lastTitle: null,
      lastFingerprint: null,
    }));
    const planned = planCompetitorReads(saved, new Set(['c0', 'c1']));
    expect(planned).toHaveLength(10);
    expect(planned[0]?.id).toBe('c13');
    expect(planned.map((page) => page.id)).not.toContain('c0');
  });

  it('the day reads ten pages however many are saved', async () => {
    const { ports, calls } = competitorPorts();
    const result = await runCompetitorReads({ localDay: DAY, takeover: true, killScope: 'none' }, ports);
    expect(result.read).toBe(10);
    expect(calls.filter((call) => call.startsWith('readPage:'))).toHaveLength(10);
    expect(calls.filter((call) => call === 'recordRead')).toHaveLength(10);
  });

  it('Takeover off or a Kill stops the reads before a single page is fetched', async () => {
    const off = competitorPorts();
    expect((await runCompetitorReads({ localDay: DAY, takeover: false, killScope: 'none' }, off.ports)).detail).toBe(TAKEOVER_OFF_DETAIL);
    const killed = competitorPorts();
    expect((await runCompetitorReads({ localDay: DAY, takeover: true, killScope: 'strategist' }, killed.ports)).detail).toBe(KILL_BLOCK_DETAIL);
    expect(off.calls).toEqual([]);
    expect(killed.calls).toEqual([]);
  });

  it('an unreadable "read today" is never treated as "nothing read today" (Pass B)', async () => {
    const off = competitorPorts();
    const ports: CompetitorRunPorts = {
      ...off.ports,
      readReadToday: async () => {
        throw new Error('reads');
      },
    };
    const result = await runCompetitorReads({ localDay: DAY, takeover: true, killScope: 'none' }, ports);
    expect(result.status).toBe('failed');
    expect(result.read).toBe(0);
    expect(result.detail).toContain('could not be read');
  });

  it("a rival day where no page could be read is told as a skip, with the step's own reasons (Pass B)", () => {
    const RUN = read('supabase/functions/minds-run-placement/index.ts');
    expect(RUN).toContain('outcome: result.read > 0 ? "done" : "skipped"');
    expect(RUN).toContain('lines.join(" ") || result.detail');
    // Takeover off is still nothing at all: the rival row is written only for a day the step really ran.
    expect(RUN).toContain('if (result.status !== "done") return;');
  });

  it('the cap is a database rule too', () => {
    const migration = read('supabase/migrations/20261024000000_minds_competitors.sql');
    expect(migration).toContain('IF read_today >= 10 THEN');
    expect(migration).toContain('PERFORM public.minds_assert_can_act();');
    expect(migration).toContain('CREATE TRIGGER minds_competitor_reads_cap');
  });

  it('a change line is honest or it is nothing', () => {
    expect(changeLine(null, { title: 'A', fingerprint: 'f1' })).toBeNull();
    expect(changeLine({ title: 'A', fingerprint: 'f1' }, { title: 'A', fingerprint: 'f1' })).toBeNull();
    expect(changeLine({ title: 'A', fingerprint: 'f1' }, { title: 'B', fingerprint: 'f2' })).toContain('B');
    expect(changeLine({ title: 'A', fingerprint: 'f1' }, { title: 'A', fingerprint: 'f2' })).toBe('The page text changed.');
  });
});

describe('Pass A7: a mind never creates a product', () => {
  const MIND_FREE_FILES = [
    'supabase/functions/_shared/runDoors.ts',
    'supabase/functions/_shared/doorPosts.ts',
    'supabase/functions/_shared/dayPacks.ts',
    'supabase/functions/_shared/priceChanges.ts',
    'supabase/functions/_shared/priceRun.ts',
    'supabase/functions/_shared/competitors.ts',
    'supabase/functions/_shared/mindActs.ts',
    'supabase/functions/_shared/productPlacement.ts',
  ];

  it('no mind-side file writes the shop at all', () => {
    for (const file of MIND_FREE_FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(/from\("products"\)\s*\.\s*(insert|upsert|update|delete)/);
      expect(source, file).not.toMatch(/INSERT INTO public\.products/i);
    }
  });

  it('the run reads and prices the shop, and never adds to it', () => {
    const RUN = read('supabase/functions/minds-run-placement/index.ts');
    expect(RUN).not.toMatch(/from\("products"\)\s*\.\s*(insert|upsert|update|delete)/);
    expect(RUN).toContain('sb.rpc("minds_apply_price_change"');
    const migration = read('supabase/migrations/20261025000000_minds_price_changes.sql');
    expect(migration).toContain('UPDATE public.products');
    expect(migration.toLowerCase()).not.toContain('insert into public.products');
  });

  it('an order to create a product waits, and Buddy says whose job it is', () => {
    expect(laneFor('Create a product for the kit')).toEqual({ lane: 'held', reason: HELD_CREATE });
    expect(HELD_CREATE).toContain('your job');
    expect(NEVER_LIST_LINES.product).toContain('does not create shop products');
  });
});

describe('Pass A8: the four gated channels are never sent by a mind', () => {
  it('they are not doors at all, and the sixteen auto doors are the only ones the step knows', () => {
    expect(DOOR_IDS).toHaveLength(16);
    expect(OPEN_DOORS).toHaveLength(16);
    for (const gated of ['instagram', 'tiktok', 'facebook', 'pinterest']) {
      expect(DOOR_IDS as readonly string[], gated).not.toContain(gated);
      expect(isOpenDoor(gated)).toBe(false);
    }
    for (const door of OPEN_DOORS) expect(DOOR_IDS as readonly string[]).toContain(door);
  });

  it('the door step only ever touches an open door, and it never posts for the owner anywhere else', async () => {
    const { ports, doors } = doorPorts();
    await runDoors(DOOR_INPUT, ports);
    expect(doors.length).toBeGreaterThan(0);
    for (const door of doors) expect(isOpenDoor(door), door).toBe(true);
    // No gated channel is called anywhere in the run: those four are posted by hand.
    const RUN = read('supabase/functions/minds-run-placement/index.ts');
    for (const host of ['graph.facebook.com', 'api.instagram.com', 'open.tiktokapis.com', 'api.pinterest.com']) {
      expect(RUN, host).not.toContain(host);
    }
    expect(RUN).not.toMatch(/from\("social_posts"\)|platform_connections/);
  });
});

describe('Pass A9: no mind ever spends', () => {
  it('a spend order waits, and the chat says so in plain words', () => {
    expect(laneFor('Run ads for the guide')).toEqual({ lane: 'held', reason: HELD_MONEY });
    expect(laneFor('Buy ads on Instagram')).toEqual({ lane: 'held', reason: HELD_MONEY });
    expect(HELD_MONEY).toContain('do not spend money');
    expect(NEVER_LIST_LINES.spend).toContain('does not spend money');
  });

  it('no mind-side file can reach a payment or ads provider', () => {
    const mindSide = filesUnder('supabase/functions/_shared').filter((file) =>
      /(^|\/)(mind|minds|buddyLivingMinds|door|runDoors|dayPacks|pack|price|competitor|placement|productPlacement)/.test(file),
    );
    expect(mindSide.length).toBeGreaterThan(10);
    for (const file of [...mindSide, 'supabase/functions/minds-run-placement/index.ts', 'supabase/functions/minds-morning-clock/index.ts']) {
      const source = read(file);
      for (const forbidden of ['stripe', 'flutterwave', 'paystack', 'api.ads', 'adsmanager', 'createPayment', 'transferFunds']) {
        expect(source.toLowerCase(), `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('Pass A10: the cron migration exists as a file and was not applied', () => {
  const CRON = 'supabase/migrations/20261021000000_minds_morning_clock.sql';

  it('the 08:00 clock is a file, with the fifteen-minute schedule and the function it calls', () => {
    expect(exists(CRON)).toBe(true);
    const cron = read(CRON);
    expect(cron).toContain('lixxon_minds_morning_clock');
    expect(cron).toContain("'*/15 * * * *'");
    expect(cron).toContain('/minds-morning-clock');
    expect(cron).toContain('NOT APPLIED to production');
  });

  it('the three slice-5 migrations exist as files too, and all four say they are not applied', () => {
    for (const file of ['20261023000000_minds_door_drip.sql', '20261024000000_minds_competitors.sql', '20261025000000_minds_price_changes.sql']) {
      const path = `supabase/migrations/${file}`;
      expect(exists(path), file).toBe(true);
      const sql = read(path);
      expect(sql.toLowerCase(), file).toMatch(/not (applied|deployed)|not applied to production/);
      expect(sql).toContain('service_role');
      expect(sql).not.toMatch(/GRANT EXECUTE[\s\S]{0,80}TO (anon|authenticated)/);
    }
  });

  it('nothing in this repo applies them: CI checks, and the deploy workflow only runs from main', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toContain('db push');
    expect(ci).not.toContain('migration up');
    const deploy = read('.github/workflows/deploy-supabase.yml');
    expect(deploy).toContain('supabase db push --include-all');
    expect(deploy).toContain('branches: [main]');
    expect(deploy).not.toContain('arena/**');
    // The database harness applies migrations to a throwaway local Postgres only; it is not production and it is not
    // run by anything the owner's live project listens to.
    expect(read('scripts/db-test.py')).toContain('~/.cache/lixxon-pgtest');
  });
});

// ==================================================================== PASS C

describe('Pass C: the spec read against the source, line by line', () => {
  it('no silent act: every kind the run writes goes through reportAct or recordNotable', () => {
    const RUN = read('supabase/functions/minds-run-placement/index.ts');
    // Every daily-log write in the run is either the act list's own row or a plain thinking step.
    const logWrites = RUN.match(/\.from\("minds_daily_log"\)[\s\S]{0,80}?\.(insert|upsert)\(/g) ?? [];
    expect(logWrites.length).toBeGreaterThan(0);
    expect(RUN).not.toMatch(/\.from\("minds_daily_log"\)[\s\S]{0,80}?\.insert\(\{[\s\S]{0,200}?kind/);
    // The competitor change is a telling of its own, and the price change is an act.
    expect(RUN).toContain('COMPETITOR_CHANGE_KIND');
    expect(RUN).toContain('reportAct(priced.act, acts)');
  });

  it('no which-mind, no product create, no spend: the four Phase I locks hold in the words the owner reads', () => {
    const locks = read('src/buddy/README.md');
    expect(locks).toContain('Phase I slice 5');
    const policy = read('supabase/functions/_shared/buddyOrderPolicy.ts');
    expect(policy).toContain('REFUSAL_LINE');
    expect(policy).not.toMatch(/REFUSED_REQUESTS[\s\S]{0,600}?price/);
    const orders = read('supabase/functions/_shared/buddyOrders.ts');
    expect(orders).toContain('HELD_PRICE');
    expect(orders).toContain('HELD_CREATE');
    expect(orders).toContain('HELD_MONEY');
  });

  it('the minds still never publish, write articles or take the owner’s four gated channels', () => {
    for (const file of ['supabase/functions/_shared/dayPacks.ts', 'supabase/functions/_shared/runDoors.ts', 'supabase/functions/_shared/priceRun.ts', 'supabase/functions/_shared/competitors.ts']) {
      const source = read(file);
      expect(source, file).not.toMatch(/from\("posts"\)\s*\.\s*(insert|upsert|update|delete)/);
    }
    const RUN = read('supabase/functions/minds-run-placement/index.ts');
    expect(RUN).not.toMatch(/from\("posts"\)\s*\.\s*(insert|upsert|update|delete)/);
  });

  it('price changes are US dollars only, once a day, and told every time', () => {
    const migration = read('supabase/migrations/20261025000000_minds_price_changes.sql');
    expect(migration).toContain('UNIQUE (owner_id, product_id, local_day)');
    expect(migration).toContain("RAISE EXCEPTION 'price_not_usd'");
    expect(migration).toContain("RAISE EXCEPTION 'price_already_changed_today'");
    const run = read('supabase/functions/_shared/priceRun.ts');
    expect(run).toContain('priceChangedAct(');
    expect(read('supabase/functions/_shared/buddyLivingMinds.ts')).toContain('A US dollar price may change only on a day');
    expect(read('src/buddy/minds/mindCore.ts')).toContain('A US dollar price may change only on a day');
  });

  it('there is no WhatsApp door, and the connection tests only read', () => {
    for (const file of ['supabase/functions/_shared/doorRegistry.ts', 'supabase/functions/_shared/doorAdapters.ts', 'supabase/functions/_shared/doorConnectionTests.ts']) {
      expect(read(file).toLowerCase(), file).not.toContain('whatsapp');
    }
    const checks = read('supabase/functions/_shared/doorConnectionTests.ts');
    expect(checks).toContain('Nothing was posted.');
    expect(checks).not.toMatch(/ports\.(reserve|send|finish)|minds_reserve_door_post|minds_finish_door_post/);
    // A test that flips Takeover would be a live switch behind a "test" button. The only writer is the owner's own
    // controls store, through its owner-only policy.
    expect(read('src/buddy/minds/mindsControlsStore.ts')).toContain('minds_controls');
    const controls = read('supabase/migrations/20261009140000_minds_controls.sql');
    expect(controls).toContain('minds_controls_owner_update');
    expect(controls).toContain('updated_by = auth.uid()');
    for (const file of ['supabase/functions/_shared/doorConnectionTests.ts', 'supabase/functions/_shared/automationKeyChecks.ts']) {
      expect(read(file), file).not.toContain('minds_controls');
    }
  });

  it('the owner still writes the articles and makes the products', () => {
    // The minds never write an article and never create a product: the copy that says so is pinned here.
    expect(read('supabase/functions/_shared/buddyOrders.ts')).toContain('Creating a product is your job');
    expect(read('supabase/functions/_shared/buddyRouter.ts')).toContain('Buddy does not create shop products');
    expect(read('supabase/functions/_shared/deadProducts.ts')).toContain('DEAD_TELL_LIMIT');
    // A product that looks dead is only ever told: the file that finds them has no delete and no write at all.
    const dead = read('supabase/functions/_shared/deadProducts.ts');
    expect(dead).not.toMatch(/from\("products"\)\s*\.\s*(insert|upsert|update|delete)/);
    expect(dead).not.toContain('DELETE FROM');
  });
});
