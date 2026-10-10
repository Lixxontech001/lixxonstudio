// @vitest-environment node
// Phase B freeze. The checks call the real pure functions with small local fixtures, and read source only for wiring.
// Nothing here reaches a live door, a live database, a live brain, or a phone. Nothing here merges, deploys, or applies a migration.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORDERS, REFUSAL_LINE, refusedRequest } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { feedbackLine } from '../../supabase/functions/_shared/buddyFeedback';
import { CANNOT_SEE_LAST_WEEK, planWeekNotables, weekSentence } from '../../supabase/functions/_shared/buddyWeek';
import { BRAIN_IDS, BRAIN_SLOTS, tryableBrains } from '../../supabase/functions/_shared/brains';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';
import { OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';
import { BRIEFING_NOTABLE_KINDS } from '../../supabase/functions/_shared/buddyBriefing';
import { digitalFirst, type ShopProduct } from '../../supabase/functions/_shared/productPlacement';
import { MIND_KEYS } from '../../src/buddy/minds/mindRoster';
import { VIBES } from '../../src/buddy/buddyVibes';
import { displayCurrencyCodes } from '../../src/lib/money';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

function walk(rel: string, out: string[] = []): string[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return out;
  if (statSync(abs).isFile()) return [...out, rel];
  for (const name of readdirSync(abs)) {
    const child = relative(ROOT, join(abs, name));
    if (statSync(join(ROOT, child)).isDirectory()) walk(child, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\./.test(name)) out.push(child);
  }
  return out;
}

describe('Phase B freeze: Takeover is off by default', () => {
  it('the minds controls table defaults takeover to false', () => {
    expect(read('supabase/migrations/20261009140000_minds_controls.sql')).toMatch(/takeover boolean NOT NULL DEFAULT false/);
  });

  it('no migration turns Takeover on by default', () => {
    const migrations = walk('supabase/migrations');
    const offenders = migrations.filter((file) => /takeover\s+boolean\s+NOT NULL\s+DEFAULT\s+true/i.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('an order saved while Takeover is off says so, and nothing has changed', () => {
    expect(feedbackLine({ state: 'waiting', takeover: false, mind: 'Strategist' })).toBe(
      'Saved for the Strategist. It is waiting. Takeover is off, so nothing has changed.',
    );
  });
});

describe('Phase B freeze: the closed order list and the refusal line', () => {
  it('Buddy may run or file exactly five kinds', () => {
    expect(ALLOWED_ORDERS).toEqual([
      'run_today',
      'pause_resume_free_door',
      'kill_or_start_mind',
      'product_line_apply',
      'mind_work',
    ]);
  });

  it('refuses refunds, deletes and email to the list, with one line', () => {
    expect(refusedRequest('refund order 1042')).toBe(true);
    expect(refusedRequest('please refund the last buyer')).toBe(true);
    expect(refusedRequest('delete the old article about tea')).toBe(true);
    expect(refusedRequest('email the list about the sale')).toBe(true);
    expect(REFUSAL_LINE).toMatch(/Refunds, deletes, emails to your list/);
    expect(REFUSAL_LINE).toMatch(/Nothing was filed or changed/);
  });

  it('never refuses a question or today\'s run', () => {
    expect(refusedRequest('how many refunds did we get this month?')).toBe(false);
    expect(refusedRequest('what did the email list do last week?')).toBe(false);
    expect(refusedRequest('run today')).toBe(false);
    expect(refusedRequest('make the packs')).toBe(false);
  });

  it('every order line says waiting, done or blocked, and names Takeover', () => {
    const waiting = feedbackLine({ state: 'waiting', takeover: true });
    const done = feedbackLine({ state: 'done', what: 'Paused the bluesky door' });
    const blocked = feedbackLine({ state: 'blocked', reason: 'The Auditor held the change' });
    expect(waiting).toMatch(/It is waiting\./);
    expect(waiting).toMatch(/Takeover is on/);
    expect(done).toMatch(/^Done\./);
    expect(blocked).toMatch(/^Blocked\./);
    expect(blocked).toMatch(/Nothing on the site changed\./);
  });
});

describe('Phase B freeze: week against last week', () => {
  it('reads one plain sentence from a fixture', () => {
    const sentence = weekSentence({ ok: true, thisWeek: { views: 40, paid: 2 }, lastWeek: { views: 20, paid: 2 } });
    expect(sentence).toMatch(/article views up \(40 against 20\)/);
    expect(sentence).toMatch(/paid orders about the same \(2 against 2\)/);
  });

  it('says it cannot see last week when a count is missing, and writes no week notable', () => {
    const facts = { ok: false, thisWeek: { views: 0, paid: 0 }, lastWeek: { views: 0, paid: 0 } };
    expect(weekSentence(facts)).toBe(CANNOT_SEE_LAST_WEEK);
    expect(planWeekNotables(facts, '2026-10-10')).toEqual([]);
  });

  it('is a spike only at twice last week and above the floor, so 0 to 1 is not a spike', () => {
    const spike = planWeekNotables({ ok: true, thisWeek: { views: 40, paid: 0 }, lastWeek: { views: 20, paid: 0 } }, '2026-10-10');
    expect(spike.map((plan) => plan.kind)).toEqual(['week_up']);
    expect(planWeekNotables({ ok: true, thisWeek: { views: 1, paid: 0 }, lastWeek: { views: 0, paid: 0 } }, '2026-10-10')).toEqual([]);
    expect(planWeekNotables({ ok: true, thisWeek: { views: 9, paid: 0 }, lastWeek: { views: 20, paid: 0 } }, '2026-10-10').map((p) => p.kind)).toEqual(['week_down']);
  });

  it('a heartbeat with the same numbers keeps the same key, so nothing new is written', () => {
    const facts = { ok: true, thisWeek: { views: 40, paid: 0 }, lastWeek: { views: 20, paid: 0 } };
    const first = planWeekNotables(facts, '2026-10-10').map((plan) => plan.key);
    const again = planWeekNotables(facts, '2026-10-11').map((plan) => plan.key);
    expect(first).toEqual(again);
  });

  it('the briefing reads the week kinds and the door fail kind', () => {
    expect(BRIEFING_NOTABLE_KINDS).toEqual(expect.arrayContaining(['week_up', 'week_down', 'door_failed']));
  });
});

describe('Phase B freeze: digital products win the placement', () => {
  const shop: ShopProduct[] = [
    { id: 'phys', name: 'Teapot', isDigital: false, priceUsd: 40 },
    { id: 'dig', name: 'Tea guide PDF', isDigital: true, priceUsd: 9 },
    { id: 'aff', name: 'Kettle link', isDigital: false, priceUsd: null },
  ];

  it('a digital product that fits is chosen before a physical one', () => {
    expect(digitalFirst(['phys', 'dig'], shop)).toEqual(['dig', 'phys']);
    expect(digitalFirst(['aff', 'phys', 'dig'], shop)).toEqual(['dig', 'aff', 'phys']);
  });

  it('a physical-only fit is still planned', () => {
    expect(digitalFirst(['phys'], shop)).toEqual(['phys']);
  });
});

describe('Phase B freeze: brains, doors, minds, looks and briefing', () => {
  it('eight brain slots, Gemini first, in fixed order', () => {
    expect(BRAIN_IDS).toHaveLength(8);
    expect(BRAIN_SLOTS.map((slot) => slot.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(BRAIN_SLOTS[0].id).toBe('gemini');
    expect(tryableBrains()[0].id).toBe('gemini');
  });

  it('no GitHub Models, Bytez or Mistral brain', () => {
    const names = BRAIN_IDS.join(' ').toLowerCase();
    expect(names).not.toMatch(/github|bytez|mistral/);
  });

  it('sixteen auto doors are open to the day run, and the four gated channels are not doors', () => {
    expect(DOOR_IDS).toHaveLength(16);
    expect(OPEN_DOORS).toHaveLength(16);
    for (const channel of ['instagram', 'tiktok', 'facebook', 'pinterest']) {
      expect(DOOR_IDS as readonly string[]).not.toContain(channel);
    }
  });

  it('five background minds, with Buddy as the voice the owner hears, and four looks', () => {
    expect(MIND_KEYS).toEqual(['analyst', 'strategist', 'ceo', 'executioner', 'auditor']);
    expect(VIBES).toHaveLength(4);
  });

  it('the footer currency list hides Naira', () => {
    expect(displayCurrencyCodes({ NGN: 1, USD: 1, GBP: 1 })).not.toContain('NGN');
  });
});

describe('Phase B freeze: no owner Distribution send route', () => {
  it('no admin file calls the automation-distribution function (the legacy page is gone)', () => {
    const adminFiles = walk('src/admin');
    // A send is a call to the function. A route name or a permission key is not a send.
    const callers = adminFiles.filter((file) => /invoke\(\s*['"`]automation-distribution|functions\/v1\/automation-distribution/.test(read(file)));
    expect(callers).toEqual([]);
    const app = read('src/admin/AdminApp.tsx');
    expect(app).not.toMatch(/AutomationDistribution/);
  });

  it('the distribution handler sends only through Telegram', () => {
    const handler = read('supabase/functions/automation-distribution/handler.ts');
    expect(handler).toMatch(/manual-kit only/);
    expect(handler).toMatch(/"telegram"/);
  });
});
