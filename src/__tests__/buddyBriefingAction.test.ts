import { describe, expect, it, vi } from 'vitest';
import {
  handleBuddyThink,
  type BuddyThinkDeps,
} from '../../supabase/functions/_shared/buddyThink';
import type { BriefingFacts } from '../../supabase/functions/_shared/buddyBriefing';

const NOW = new Date('2026-10-09T12:00:00Z');
const SEEN = '2026-10-08T20:00:00Z';
const TODAY = '2026-10-09';

const CALM: BriefingFacts = {
  articles: { ok: true, count: 0, titles: [] },
  orders: { ok: true, paidCount: 0, usdTotal: 0 },
  views: { ok: true, count: 0 },
  failures: { ok: true, count: 0, codes: [] },
};

/** A small in-memory stand-in for the owner's chat tables, enforcing one briefing per day. */
function fakeStore(options: { seenAt?: string | null; facts?: BriefingFacts; saveOk?: boolean; stateOk?: boolean } = {}) {
  const threads = new Map<string, string>();
  const saved: Array<{ chatId: string; kind: string; content: string; payload: unknown }> = [];
  const markSeen = vi.fn(async () => true);
  const readBriefingFacts = vi.fn<(sinceIso: string) => Promise<BriefingFacts>>(async () => options.facts ?? CALM);
  let nextId = 1;
  const deps: BuddyThinkDeps = {
    keyConfigured: async () => true,
    readKey: async () => null,
    allowCall: async () => true,
    askGemini: vi.fn(),
    recordProbe: async () => {},
    loadChat: async () => null,
    loadHistory: async () => [],
    saveMessage: async (chatId, _role, kind, content, payload) => {
      if (options.saveOk === false) return false;
      saved.push({ chatId, kind, content, payload: payload ?? null });
      return true;
    },
    touchChat: async () => {},
    now: () => NOW,
    getSeenAt: async () =>
      options.stateOk === false ? { ok: false } : { ok: true, seenAt: options.seenAt === undefined ? SEEN : options.seenAt },
    markSeen,
    readBriefingFacts,
    readSiteFacts: async () => ({
      articles: { ok: true, total: 0, items: [] },
      products: { ok: true, total: 0, items: [] },
    }),
    findOrCreateBriefing: async (localDate) => {
      const existing = threads.get(localDate);
      if (existing) return { id: existing, created: false };
      const id = `thread-${nextId++}`;
      threads.set(localDate, id);
      return { id, created: true };
    },
    loadPendingOrder: async () => ({ ok: true as const, instruction: null }),
    saveOrder: async () => true,
    readMindLog: async () => [],
  };
  return { deps, threads, saved, markSeen, readBriefingFacts };
}

describe('Buddy briefing action: input', () => {
  it('rejects a missing or malformed local date without reading anything', async () => {
    const store = fakeStore();
    for (const bad of [undefined, '', '2026-13-01', '09-10-2026', '2026-02-30', 'today']) {
      const result = await handleBuddyThink({ action: 'briefing', local_date: bad }, store.deps);
      expect(result.status).toBe(400);
    }
    expect(store.readBriefingFacts).not.toHaveBeenCalled();
    expect(store.saved).toEqual([]);
  });

  it('refuses to run when the last-seen time cannot be read', async () => {
    const store = fakeStore({ stateOk: false });
    const result = await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    expect(result.status).toBe(503);
    expect(store.saved).toEqual([]);
    expect(store.markSeen).not.toHaveBeenCalled();
  });
});

describe('Buddy briefing action: one thread per day', () => {
  it('uses the same thread for a second open the same day and never makes a duplicate', async () => {
    const store = fakeStore();
    const first = await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    const second = await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    expect(first.body).toMatchObject({ created: true });
    expect(second.body).toMatchObject({ created: false });
    expect(store.threads.size).toBe(1);
    expect(new Set(store.saved.map((row) => row.chatId)).size).toBe(1);
  });

  it('opens a new thread for a different local day', async () => {
    const store = fakeStore();
    await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    await handleBuddyThink({ action: 'briefing', local_date: '2026-10-10' }, store.deps);
    expect(store.threads.size).toBe(2);
  });
});

describe('Buddy briefing action: quiet and unreadable', () => {
  it('saves the quiet line with no sections when nothing real happened', async () => {
    const store = fakeStore();
    const result = await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    expect(result.body).toMatchObject({ ok: true, quiet: true, text: 'Quiet since you left.' });
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]).toMatchObject({ kind: 'briefing', content: 'Quiet since you left.', payload: null });
  });

  it('is not quiet when a source is unreadable, and shows that as a line', async () => {
    const store = fakeStore({ facts: { ...CALM, failures: { ok: false, count: 0, codes: [] } } });
    const result = await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    expect(result.body).toMatchObject({ quiet: false });
    expect(store.saved[0].content).not.toBe('Quiet since you left.');
    expect(store.saved[0].content).toContain('I cannot read the error log yet.');
    expect(store.saved[0].payload).toMatchObject({ sections: expect.any(Array) });
  });

  it('reads from the last Continue time on a later visit', async () => {
    const store = fakeStore({ seenAt: SEEN });
    await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    expect(store.readBriefingFacts).toHaveBeenCalledWith(SEEN);
  });

  it('looks back 24 hours on a first visit', async () => {
    const store = fakeStore({ seenAt: null });
    const result = await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    expect(store.readBriefingFacts).toHaveBeenCalledWith('2026-10-08T12:00:00.000Z');
    expect(result.body).toMatchObject({ first_visit: true });
  });
});

describe('Buddy briefing action: when to count it as seen', () => {
  it('marks seen only after the briefing is saved', async () => {
    const order: string[] = [];
    const store = fakeStore();
    const save = store.deps.saveMessage;
    store.deps.saveMessage = async (...args) => {
      order.push('save');
      return save(...args);
    };
    store.deps.markSeen = vi.fn(async () => {
      order.push('seen');
      return true;
    });
    await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    expect(order).toEqual(['save', 'seen']);
  });

  it('does not mark seen when the save fails, so nothing is lost', async () => {
    const store = fakeStore({ saveOk: false });
    const result = await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    expect(result.status).toBe(503);
    expect(store.markSeen).not.toHaveBeenCalled();
  });

  it('marks seen with the server time on success', async () => {
    const store = fakeStore();
    await handleBuddyThink({ action: 'briefing', local_date: TODAY }, store.deps);
    expect(store.markSeen).toHaveBeenCalledWith(NOW.toISOString());
  });
});
