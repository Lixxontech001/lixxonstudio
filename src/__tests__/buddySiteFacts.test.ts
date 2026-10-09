import { describe, expect, it, vi } from 'vitest';
import edgeSource from '../../supabase/functions/buddy-think/index.ts?raw';
import {
  centsToUsd,
  cleanLine,
  formatUsd,
  siteFactsBlock,
  siteFactsFromReads,
  type SiteFacts,
} from '../../supabase/functions/_shared/buddySiteFacts';
import { handleBuddyThink, type BuddyThinkDeps } from '../../supabase/functions/_shared/buddyThink';

const NOW = new Date('2026-10-09T12:00:00Z');
const CHAT_ID = '6f1c2b7e-3d4a-4b8c-9e1f-0a2b3c4d5e6f';

function readsFor(overrides: Partial<SiteFacts> = {}): SiteFacts {
  return {
    articles: { ok: true, total: 1, items: [{ title: 'Why linen wins in August', slug: 'linen', publishedAt: '2026-10-01T00:00:00Z' }] },
    products: { ok: true, total: 1, items: [{ name: 'Linen throw', priceUsd: 58.5 }] },
    ...overrides,
  };
}

describe('Buddy site list: money and text', () => {
  it('turns cents into USD with two decimals, and leaves a missing price as missing', () => {
    expect(centsToUsd(5850)).toBe(58.5);
    expect(centsToUsd(0)).toBe(0);
    expect(centsToUsd(null)).toBeNull();
    expect(centsToUsd(-1)).toBeNull();
    expect(formatUsd(58.5)).toBe('USD 58.50');
    expect(formatUsd(null)).toBe('price not set');
  });

  it('keeps titles to one clean line', () => {
    expect(cleanLine('  Two\nlines\tand  spaces ', 100)).toBe('Two lines and spaces');
    expect(cleanLine('   ', 100)).toBeNull();
    expect(cleanLine(42, 100)).toBeNull();
    expect(cleanLine('x'.repeat(300), 10)).toHaveLength(10);
  });
});

describe('Buddy site list: from the database rows', () => {
  it('keeps only titles, slugs, dates and product names and prices', () => {
    const facts = siteFactsFromReads(
      {
        data: [{ title: 'Hello', slug: 'hello', published_at: '2026-10-01T00:00:00Z', content: 'SECRET BODY TEXT' }],
        error: null,
        count: 1,
      },
      { data: [{ name: 'Lamp', price_cents: 1250 }], error: null, count: 1 },
    );
    expect(facts.articles.items).toEqual([{ title: 'Hello', slug: 'hello', publishedAt: '2026-10-01T00:00:00Z' }]);
    expect(facts.products.items).toEqual([{ name: 'Lamp', priceUsd: 12.5 }]);
    expect(JSON.stringify(facts)).not.toContain('SECRET BODY TEXT');
  });

  it('marks a list as not readable when the read fails, and never shows partial guesses', () => {
    const facts = siteFactsFromReads({ data: null, error: new Error('denied') }, { data: [{ name: 'Lamp', price_cents: 1 }], error: null });
    expect(facts.articles).toEqual({ ok: false, total: 0, items: [] });
    expect(facts.products.ok).toBe(true);
  });
});

describe('Buddy site list: what Buddy is shown for a question', () => {
  it('lists real titles and USD prices, and says when there are none', () => {
    const block = siteFactsBlock(readsFor());
    expect(block).toContain('- "Why linen wins in August"');
    expect(block).toContain('- Linen throw: USD 58.50');
    expect(siteFactsBlock({ articles: { ok: true, total: 0, items: [] }, products: { ok: true, total: 0, items: [] } })).toMatch(
      /Published articles: none yet\.[\s\S]*Shop products: none active yet\./,
    );
  });

  it('says plainly when a list could not be read, so Buddy does not name anything from it', () => {
    const block = siteFactsBlock(readsFor({ articles: { ok: false, total: 0, items: [] } }));
    expect(block).toContain('could not be read just now. Do not name any article.');
    expect(block).toContain('- Linen throw: USD 58.50');
  });

  it('says how many more exist than are listed', () => {
    const items = Array.from({ length: 3 }, (_, i) => ({ title: `Article ${i}`, slug: null, publishedAt: null }));
    const block = siteFactsBlock(readsFor({ articles: { ok: true, total: 45, items } }));
    expect(block).toContain('(and 42 more not listed here)');
  });
});

describe('Buddy question flow with the site list', () => {
  function askDeps(facts: SiteFacts) {
    const askGemini = vi.fn(async () => ({ ok: true as const, text: 'Here is what is live.' }));
    const readSiteFacts = vi.fn(async () => facts);
    const saved: Array<{ kind: string; content: string }> = [];
    const deps: BuddyThinkDeps = {
      keyConfigured: async () => true,
      readKey: async () => 'FAKE-GEMINI-KEY-NOT-REAL-0002',
      allowCall: async () => true,
      askGemini,
      recordProbe: async () => {},
      loadChat: async (id) => ({ id, title: 'Chat' }),
      loadHistory: async () => [],
      saveMessage: async (_chat, _role, kind, content) => {
        saved.push({ kind, content });
        return true;
      },
      touchChat: async () => {},
      now: () => NOW,
      getSeenAt: async () => ({ ok: true, seenAt: null }),
      markSeen: async () => true,
      readBriefingFacts: async () => ({
        articles: { ok: true, count: 0, titles: [] },
        orders: { ok: true, paidCount: 0, usdTotal: 0 },
        views: { ok: true, count: 0 },
        failures: { ok: true, count: 0, codes: [] },
      }),
      readSiteFacts,
      findOrCreateBriefing: async () => null,
    loadPendingOrder: async () => ({ ok: true as const, instruction: null }),
    saveOrder: async () => true,
    readMindLog: async () => [],
    };
    return { deps, askGemini, readSiteFacts, saved };
  }

  it('reads the site list for the question and gives it to Buddy as context', async () => {
    const { deps, askGemini, readSiteFacts } = askDeps(readsFor());
    await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'What is on the shop?' }, deps);
    expect(readSiteFacts).toHaveBeenCalledWith(NOW.toISOString());
    const sent = askGemini.mock.calls[0][1] as { system: string };
    expect(sent.system).toContain('THE SITE RIGHT NOW');
    expect(sent.system).toContain('- Linen throw: USD 58.50');
    expect(sent.system).toContain('You cannot publish, edit articles, change products or prices, or spend money.');
  });

  it('still answers when the list cannot be read, and tells Buddy it cannot be read', async () => {
    const { deps, askGemini } = askDeps(readsFor({ products: { ok: false, total: 0, items: [] } }));
    const result = await handleBuddyThink({ action: 'ask', chat_id: CHAT_ID, message: 'Which products?' }, deps);
    expect(result.body).toMatchObject({ ok: true });
    const sent = askGemini.mock.calls[0][1] as { system: string };
    expect(sent.system).toContain('Shop products: could not be read just now.');
  });
});

describe('Buddy site list: the read never touches article bodies or writes', () => {
  // The function body that does the site read, from its start to the next step.
  const start = edgeSource.indexOf('readSiteFacts: async');
  const end = edgeSource.indexOf('findOrCreateBriefing:', start);
  const body = edgeSource.slice(start, end);

  it('is found in the edge function', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it('selects only the safe columns from articles and products', () => {
    expect(body).toContain('.select("title,slug,published_at"');
    expect(body).toContain('.select("name,price_cents"');
  });

  it('never selects or writes the article body, and never writes any table', () => {
    expect(body).not.toMatch(/\bcontent\b/);
    expect(body).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });

  it('keeps the site list out of the chat row shape: a body in the input is never in the output', () => {
    const facts = siteFactsFromReads(
      { data: [{ title: 'T', slug: 's', published_at: null, content: 'BODY' }], error: null },
      { data: [], error: null },
    );
    expect(siteFactsBlock(facts)).not.toContain('BODY');
  });
});
