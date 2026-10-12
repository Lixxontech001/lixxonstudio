// Phase I slice 3: every act is told four ways. The words for each act, the log row and the buzz that always happen
// together, and the two readers (the morning briefing and the night report) that show them. Also the honest line for
// a buzz that could not go out. Pure functions and fakes only: no model, no database, no phone, no push service.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BRIEFING_NOTABLE_KINDS,
  PUSH_SKIP_ACTION,
  buildBriefing,
  pushSkipLine,
  type BriefingFacts,
} from '../../supabase/functions/_shared/buddyBriefing';
import { BUZZ_KINDS, shouldBuzz } from '../../supabase/functions/_shared/notablePush';
import { NOTHING_RAN_LINE, buildNightReport } from '../../supabase/functions/_shared/mindsNightReport';
import {
  ACT_KINDS,
  auditorBlockedAct,
  doorPostedAct,
  doorSkippedAct,
  packSavedAct,
  priceChangedAct,
  productLooksDeadAct,
  reportAct,
  type ActPorts,
  type ActWords,
} from '../../supabase/functions/_shared/mindActs';

const DAY = '2026-10-14';
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const RUN = read('supabase/functions/minds-run-placement/index.ts');

/** The six acts the owner must hear about, one of each. */
const ACTS: Array<{ act: ActWords; plain: string }> = [
  { act: doorPostedAct('Telegram', 'The Calm Skin Routine Guide', DAY), plain: 'Telegram' },
  { act: doorSkippedAct('Tumblr', 'Tumblr: no video yet.', DAY), plain: 'Tumblr' },
  { act: priceChangedAct('Calm Cleanser', 12, 14, DAY), plain: '$14.00' },
  { act: packSavedAct(2, 1, DAY), plain: '2 packs saved' },
  { act: productLooksDeadAct('Winter Balm', 0, 0, DAY), plain: 'Winter Balm' },
  { act: auditorBlockedAct('The Calm Skin Routine Guide', 'Remove the dash.'), plain: 'Auditor' },
];

const NOW = new Date('2026-10-14T08:00:00Z');
const SINCE = '2026-10-13T08:00:00Z';

/** The smallest set of facts the briefing insists on, so one notable can be read on its own. */
function facts(overrides: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    articles: { ok: true, count: 0, titles: [] },
    orders: { ok: true, paidCount: 0, usdTotal: 0 },
    views: { ok: true, count: 0 },
    failures: { ok: true, count: 0, codes: [] },
    ...overrides,
  };
}

function fakePorts(failNotable = false, failLog = false) {
  const logs: Array<{ mind: string; action: string; outcome: string; detail: string }> = [];
  const notables: Array<{ kind: string; title: string; detail: string; key: string | null }> = [];
  const ports: ActPorts = {
    log: vi.fn(async (entry) => {
      if (failLog) throw new Error('the log is down');
      logs.push(entry);
    }),
    notable: vi.fn(async (kind, title, detail, key) => {
      if (failNotable) throw new Error('the phone is unreachable');
      notables.push({ kind, title, detail, key });
    }),
  };
  return { ports, logs, notables };
}

describe('Phase I slice 3: the six acts, in plain words', () => {
  it('every act has a kind, a mind, an action, a title and a detail', () => {
    for (const { act } of ACTS) {
      expect(ACT_KINDS, act.kind).toContain(act.kind);
      expect(act.mind.length, act.kind).toBeGreaterThan(3);
      expect(act.action.length, act.kind).toBeGreaterThan(3);
      expect(act.title.length, act.kind).toBeGreaterThan(3);
      expect(act.detail.length, act.kind).toBeGreaterThan(10);
      expect(['done', 'skipped', 'blocked', 'failed'], act.kind).toContain(act.outcome);
    }
  });

  it('the words are plain: no engine word, no country or city, and money only in US dollars', () => {
    const banned = /vault|\brpc\b|postgres|\brls\b|\bjwt\b|oauth|supabase|vercel|nigeria|lagos|naira|\bNGN\b|₦|WAT\b/i;
    for (const { act } of ACTS) {
      const text = `${act.action} ${act.title} ${act.detail}`;
      expect(text, act.kind).not.toMatch(banned);
      const money = text.match(/\$?\d+(\.\d{2})?\s?(usd|ngn|eur|gbp)?/gi) ?? [];
      for (const amount of money) expect(amount, act.kind).not.toMatch(/ngn|naira|₦/i);
    }
  });

  it('the price act names the old price and the new one, both in dollars', () => {
    const act = priceChangedAct('Calm Cleanser', 12, 14, DAY);
    expect(act.title).toContain('$14.00');
    expect(act.detail).toContain('$12.00');
    expect(act.detail).toContain('$14.00');
  });

  it("a skipped door carries the reason the door step gave, and a dead product carries both weeks", () => {
    expect(doorSkippedAct('Tumblr', 'Tumblr: no video yet.', DAY).detail).toBe('Tumblr: no video yet.');
    const dead = productLooksDeadAct('Winter Balm', 0, 1, DAY);
    expect(dead.detail).toContain('0 this week and 1 last week');
    expect(dead.detail).toMatch(/Nothing was deleted/);
  });

  it('the once-a-day acts carry a key, and the Auditor block does not need one', () => {
    for (const { act } of ACTS) {
      if (act.kind === 'auditor_blocked') expect(act.key).toBeNull();
      else expect(act.key, act.kind).toContain(DAY);
    }
    // Two acts about different doors on the same day are two rows, never one.
    expect(doorSkippedAct('Tumblr', 'x', DAY).key).not.toBe(doorSkippedAct('Medium', 'x', DAY).key);
  });
});

describe('Phase I slice 3: the log row and the buzz always happen together', () => {
  it('reportAct writes the log row and the notable for every act', async () => {
    for (const { act } of ACTS) {
      const { ports, logs, notables } = fakePorts();
      const telling = await reportAct(act, ports);
      expect(telling, act.kind).toEqual({ logged: true, noticed: true });
      expect(logs, act.kind).toHaveLength(1);
      expect(notables, act.kind).toHaveLength(1);
      // The same words in both places, so the log, the phone, the briefing and the night report agree.
      expect(logs[0].detail, act.kind).toBe(notables[0].detail);
      expect(logs[0].action, act.kind).toBe(act.action);
      expect(notables[0].kind, act.kind).toBe(act.kind);
      expect(notables[0].title, act.kind).toBe(act.title);
      expect(notables[0].key, act.kind).toBe(act.key);
    }
  });

  it('a phone that cannot be reached does not lose the log row, and is reported honestly', async () => {
    const { ports, logs, notables } = fakePorts(true);
    const telling = await reportAct(ACTS[0].act, ports);
    expect(telling).toEqual({ logged: true, noticed: false });
    expect(logs).toHaveLength(1);
    expect(notables).toHaveLength(0);
  });

  it('a log that cannot be written does not stop the buzz, and is reported honestly', async () => {
    const { ports, logs, notables } = fakePorts(false, true);
    const telling = await reportAct(ACTS[0].act, ports);
    expect(telling).toEqual({ logged: false, noticed: true });
    expect(logs).toHaveLength(0);
    expect(notables).toHaveLength(1);
  });

  it('reportAct never throws, whatever the ports do', async () => {
    const ports = {
      log: vi.fn(async () => {
        throw new Error('down');
      }),
      notable: vi.fn(async () => {
        throw new Error('down');
      }),
    } as unknown as ActPorts;
    await expect(reportAct(ACTS[2].act, ports)).resolves.toEqual({ logged: false, noticed: false });
  });
});

describe('Phase I slice 3: every act is a briefing kind and a buzz kind', () => {
  it('all six are read by the briefing and buzz the phone', () => {
    for (const kind of ACT_KINDS) {
      expect(BRIEFING_NOTABLE_KINDS, kind).toContain(kind);
      expect(BUZZ_KINDS, kind).toContain(kind);
      expect(shouldBuzz(kind), kind).toBe(true);
    }
  });

  it('the briefing shows each act: its own sentence for a door, a price, a pack and a dead product', () => {
    const rows = ACTS.map(({ act }) => ({ kind: act.kind, title: act.title, detail: act.detail }));
    const briefing = buildBriefing(facts({ notables: { ok: true, rows } }), NOW, SINCE, false);
    const text = briefing.text;
    // A door that posted, a door that did not, a price, a saved pack, a dead product and the Auditor's block:
    // every one of them is a line an owner can read in the morning briefing.
    expect(text).toContain('Telegram: posted "The Calm Skin Routine Guide".');
    expect(text).toContain('Tumblr: no video yet.');
    expect(text).toContain('It was $12.00 and it is now $14.00.');
    expect(text).toContain('2 are ready for you to post by hand');
    expect(text).toContain('Paid orders: 0 this week and 0 last week');
    expect(text).toContain('Auditor blocked a change to "The Calm Skin Routine Guide".');
  });

  it('the night report shows the acts too: a notable is a night line', () => {
    const night = buildNightReport({
      day: DAY,
      log: [
        { happened_at: `${DAY}T07:00:00Z`, mind: 'executioner', action: 'Changed the price of "Calm Cleanser"', outcome: 'done', detail: 'It was $12.00 and it is now $14.00.' },
      ],
      events: ACTS.map(({ act }) => ({ happened_at: `${DAY}T07:00:00Z`, mind: act.mind, kind: act.kind, title: act.title, detail: act.detail })),
      orders: [],
    });
    expect(night.body).toContain('Notable');
    for (const { act } of ACTS) expect(night.body, act.kind).toContain(act.title);
    expect(night.body).not.toBe(NOTHING_RAN_LINE);
  });

  it('a day with acts is never a quiet night, and a skipped act alone does not make it busy', () => {
    const skippedOnly = buildNightReport({
      day: DAY,
      log: [{ happened_at: `${DAY}T07:00:00Z`, mind: 'executioner', action: 'Nothing went out to Tumblr', outcome: 'skipped', detail: 'Tumblr: no video yet.' }],
      events: [],
      orders: [],
    });
    expect(skippedOnly.ran).toBe(false);
    expect(skippedOnly.body).toContain('skipped');
  });
});

describe('Phase I slice 3: a missing key or device is never a fake sent alert', () => {
  it('the briefing tells the owner the phone alerts did not go out, and how to turn them on', () => {
    const line = pushSkipLine('no device');
    expect(line).toContain('did not go out');
    expect(line).toContain('/admin/settings');
    expect(line).toContain('Register this device');
    expect(line).not.toMatch(/\bsent\b/i);
  });

  it('the keys line the push helper writes is shown as it is, never retyped', () => {
    const help = 'Phone alerts: make the keys on the Keys page, then open /admin/settings on your phone and tap Register this device.';
    expect(pushSkipLine(help)).toBe(`Phone alerts did not go out. ${help}`);
  });

  it('the briefing Problems section carries the skip line, from the log row the push helper writes', () => {
    const rows = [{ happened_at: `${DAY}T07:00:00Z`, mind: 'executioner', action: PUSH_SKIP_ACTION, outcome: 'skipped', detail: 'no device' }];
    const text = buildBriefing(facts({ minds: { ok: true, rows } }), NOW, SINCE, false).text;
    expect(text).toContain('Phone alerts did not go out');
    expect(text).toContain('Register this device');
  });

  it('the action the briefing reads is the action the push helper writes', () => {
    expect(read('supabase/functions/_shared/notablePushServer.ts')).toContain('action: "Owner phone push"');
    expect(PUSH_SKIP_ACTION).toBe('Owner phone push');
  });

  it('the push helper writes the skip once, with the plain words, and never marks the row sent', () => {
    const server = read('supabase/functions/_shared/notablePushServer.ts');
    expect(server).toContain('outcome.status === "no_device" ? NO_DEVICE_COPY : PUSH_HELP_COPY');
    expect(server).toContain('await ports.setPushNote(row, outcome.status);');
  });
});

describe('Phase I slice 3: the day run tells every act through those words', () => {
  it('the doors speak through the act list: a post, a quiet door, and a step that never reached one', () => {
    expect(RUN).toContain('reportAct(doorPostedAct(');
    expect(RUN).toContain('reportAct(doorSkippedAct(DOORS[item.door].label, item.detail, localDay), acts)');
    expect(RUN).toContain('doorSkippedAct("The free doors", doors.detail, localDay)');
  });

  it('a saved pack is told, ready or blocked', () => {
    expect(RUN).toContain('reportAct(packSavedAct(readyPacks, blockedPacks, localDay)');
    expect(RUN).toContain('if (!error && row.status === "blocked") blockedPacks += 1;');
    expect(RUN).not.toContain('"pack_ready"');
  });

  it("the act ports write the log row and the buzz through the run own notable helper", () => {
    expect(RUN).toContain('function actPortsFor(sb: SupabaseClient, owner: string, localDay: string): ActPorts {');
    expect(RUN).toContain('notable: (kind, title, detail, key) => recordNotable(sb, owner, localDay, "executioner", kind, title, detail, key)');
    // The Auditor block and a failed door step still go through the same helper.
    expect(RUN).toContain('recordNotable(sb, owner, localDay, notice.mind, notice.kind, notice.title, notice.detail, notice.key)');
    expect(RUN).toContain('recordNotable(sb, owner, localDay, "auditor", kind, title, detail)');
  });

  it('every kind the day run writes is allowed by the table and buzzes', () => {
    const migration = read('supabase/migrations/20261022000000_minds_act_kinds.sql');
    for (const kind of ACT_KINDS) expect(migration, kind).toContain(`'${kind}'`);
    for (const old of ['door_posted', 'pack_ready', 'auditor_blocked', 'door_failed', 'mind_failed', 'week_up', 'week_down']) {
      expect(migration, old).toContain(`'${old}'`);
    }
    expect(migration).toContain('NOT applied to production');
  });
});
