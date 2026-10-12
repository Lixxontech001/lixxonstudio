/**
 * Phase H slice 5: Buddy never asks which mind.
 *
 * Every order the owner types without naming a helper is routed internally by plain rules. The owner gets a thought
 * about the task, never the assignment or a helper table. No message ever asks the owner to choose.
 *
 * Fake deps only. No model, no database, no push.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MIND,
  NEVER_LIST_LINES,
  mindFit,
  neverListLine,
  routeMessage,
  type MindLogLine,
} from '../../supabase/functions/_shared/buddyRouter';
import { handleBuddyThink, NO_KEY_MESSAGE, type BuddyThinkDeps, type GeminiResult } from '../../supabase/functions/_shared/buddyThink';

const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

const ask = (message: string) => ({ action: 'ask' as const, chat_id: CHAT_ID, message });

/** Fake dependencies for the chat path, so an order can be followed all the way to a saved message. */
function chatDeps() {
  const saved: { role: string; kind: string; content: string; payload: Record<string, unknown> | null }[] = [];
  const saveOrder = vi.fn(async () => '66666666-6666-4666-8666-666666666666');
  const askGemini = vi.fn(async (): Promise<GeminiResult> => ({ ok: true, text: 'Buddy reply.' }));
  const deps = {
    keyConfigured: async () => false,
    readKey: async () => null,
    readSecret: async () => null,
    allowCall: async () => true,
    askGemini,
    recordProbe: async () => {},
    loadChat: async (id: string) => (id === CHAT_ID ? { id, title: null } : null),
    loadHistory: async () => [],
    saveMessage: async (_chatId: string, role: string, kind: string, content: string, payload?: Record<string, unknown> | null) => {
      saved.push({ role, kind, content, payload: payload ?? null });
      return true;
    },
    touchChat: async () => {},
    now: () => new Date('2026-10-09T12:00:00Z'),
    getSeenAt: async () => ({ ok: true as const, seenAt: null }),
    markSeen: async () => true,
    readBriefingFacts: async () => ({
      articles: { ok: true, count: 0, titles: [] },
      orders: { ok: true, paidCount: 0, usdTotal: 0 },
      views: { ok: true, count: 0 },
      failures: { ok: true, count: 0, codes: [] },
    }),
    findOrCreateBriefing: async () => ({ id: CHAT_ID, created: true }),
    loadPendingOrder: async () => ({ ok: true as const, instruction: null }),
    saveOrder,
    readMindLog: async (): Promise<MindLogLine[]> => [],
    readTakeover: async () => false,
    readStateFacts: async () => ({
      takeover: false,
      killScope: 'none',
      orders: { ok: true, total: 0, items: [] },
      log: { ok: true, rows: [] },
      notable: { ok: true, rows: [] },
      doors: { ok: true, rows: [] },
    }),
    readSiteFacts: async () => ({
      articles: { ok: true, total: 0, items: [] },
      products: { ok: true, total: 0, items: [] },
    }),
  } as unknown as BuddyThinkDeps;
  return { deps, saved, saveOrder, askGemini };
}

describe('Phase H slice 5: unnamed work is routed by the rules', () => {
  it.each([
    ['Read the numbers for last week', 'analyst'],
    ['Get the weekly figures ready', 'analyst'],
    ['Plan the strategy for the kit', 'strategist'],
    ['Compare us with the two rivals', 'strategist'],
    ['Find the dead products in the shop', 'strategist'],
    ['Sort the waiting orders', 'ceo'],
    ['Rank the drafts by hand', 'ceo'],
    ['Write the captions for the pack', 'executioner'],
    ['Open the doors on the new templates', 'executioner'],
    ['Check the spring guide', 'auditor'],
    ['Audit the Calm Skin article', 'auditor'],
  ])('"%s" goes to the %s, with no question', (message, mind) => {
    const route = routeMessage(message, null);
    expect(route).toMatchObject({ kind: 'order', mind, routed: true });
    expect(route).not.toHaveProperty('others');
    expect(JSON.stringify(route)).not.toMatch(/ask_which_mind|which mind/i);
  });

  it('today\'s run is still the day-run route, not a mind', () => {
    expect(routeMessage('Run today', null)).toMatchObject({ kind: 'run_day' });
    expect(routeMessage('Make the packs', null)).toMatchObject({ kind: 'run_day' });
  });

  it('a swap of a product onto an article goes to the Executioner, as it always has', () => {
    expect(routeMessage('Swap the Calm Skin Routine Guide onto the skin guide', null)).toMatchObject({
      kind: 'order',
      mind: 'executioner',
    });
  });

  it('work that fits no rule goes to the doer, so no order is left without a mind', () => {
    expect(DEFAULT_MIND).toBe('executioner');
    expect(mindFit('Do the new article')).toEqual({ mind: 'executioner', others: [] });
    expect(routeMessage('Do the new article', null)).toMatchObject({ kind: 'order', mind: 'executioner', routed: true });
  });
});

describe("Phase J slice 1: internal routing never becomes the owner's reply", () => {
  it('two fits are recorded internally, with the first match taking the order', () => {
    expect(mindFit('Check the numbers for the week')).toEqual({ mind: 'analyst', others: ['auditor'] });
    expect(routeMessage('Check the numbers for the week', null)).toMatchObject({
      kind: 'order',
      mind: 'analyst',
      routed: true,
      others: ['auditor'],
    });
  });
});

describe('Phase J slice 1: the owner never sees internal routing', () => {
  it('an unnamed order is internally routed while the missing-brain notice contains no routing detail', async () => {
    const { deps, saved, saveOrder, askGemini } = chatDeps();
    const result = await handleBuddyThink(ask('Check the new article'), deps);
    expect(result.body).toMatchObject({ ok: true, route: 'order' });
    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Check the new article', 'auditor');
    const reply = saved.at(-1);
    expect(reply?.content).toBe(NO_KEY_MESSAGE);
    expect(reply?.content).not.toMatch(/No mind was named|Saved for|Executioner|Auditor|waiting|next run/i);
    expect(reply?.payload).toBeNull();
    expect(saved.every((row) => !/which mind/i.test(row.content))).toBe(true);
    expect(askGemini).not.toHaveBeenCalled();
  });

  it('a two-fit order stays routed in code and its reply shows no helper table', async () => {
    const { deps, saved, saveOrder } = chatDeps();
    await handleBuddyThink(ask('Check the numbers for the week'), deps);
    expect(saveOrder).toHaveBeenCalledWith(CHAT_ID, 'Check the numbers for the week', 'analyst');
    const reply = saved.at(-1)?.content ?? '';
    expect(reply).not.toMatch(/Two minds fit this|\| What it would do|Analyst|Auditor|No mind was named|Saved for|next run/i);
  });
});

describe('Phase H slice 5: questions stay questions, and the never-list stays refused', () => {
  it('a question is answered as chat or from the log, never filed', () => {
    expect(routeMessage('How are sales?', null)).toEqual({ kind: 'chat' });
    expect(routeMessage('Can you check the article for me?', null)).toEqual({ kind: 'chat' });
    expect(routeMessage('What did the Analyst do?', null)).toMatchObject({ kind: 'mind_log', mind: 'analyst' });
  });

  it('spending and reader replies get their plain refusal, with nothing filed', async () => {
    expect(neverListLine('Spend 50 dollars on ads for the summer post')).toBe(NEVER_LIST_LINES.spend);
    const { deps, saved, saveOrder } = chatDeps();
    const result = await handleBuddyThink(ask('Spend 50 dollars on ads for the summer post'), deps);
    expect(result.body).toMatchObject({ route: 'never_list', reply: NEVER_LIST_LINES.spend });
    expect(saveOrder).not.toHaveBeenCalled();
    expect(saved.at(-1)?.content).toBe(NEVER_LIST_LINES.spend);
  });
});

describe('Phase H slice 5: the question is gone from the code, not just from the copy', () => {
  it('the router no longer exports an ask-which-mind line or route', () => {
    const router = read('supabase/functions/_shared/buddyRouter.ts');
    expect(router).not.toMatch(/ASK_WHICH_MIND_LINE/);
    expect(router).not.toMatch(/ask_which_mind/);
    expect(router).not.toMatch(/Which mind should take this/);
  });

  it('the chat handler no longer asks, and no reply carries a pending order', () => {
    const think = read('supabase/functions/_shared/buddyThink.ts');
    expect(think).not.toMatch(/ASK_WHICH_MIND_LINE|ask_which_mind/);
    expect(think).not.toMatch(/Which mind should take this/);
    // The rules for the model say what to do instead of asking.
    expect(think).toContain('Never ask in "reply" which helper should take it, and never describe internal routing.');
    expect(think).toContain("Do not tell the owner which helper the app chose");
    // The only pending_order left is the read of an order an older message left waiting.
    const writes = think.match(/pending_order:/g) ?? [];
    expect(writes).toEqual([]);
  });

  it('nothing useful was dropped: the minds, the log answer and the refusal lines are all still here', () => {
    const router = read('supabase/functions/_shared/buddyRouter.ts');
    expect(router).toContain('export const MIND_KEYS');
    expect(router).toContain('export function answerFromLog');
    expect(router).toContain('export const NEVER_LIST_LINES');
    expect(DEFAULT_MIND).toBe('executioner');
  });
});
