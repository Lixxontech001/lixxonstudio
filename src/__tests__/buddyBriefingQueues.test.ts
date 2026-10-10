import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CARTS_WORDING,
  COMMENTS_WORDING,
  REFUNDS_WORDING,
  buildBriefing,
  queueLines,
  type BriefingFacts,
} from '../../supabase/functions/_shared/buddyBriefing';

// Phase D slice 5: the briefing counts comments waiting, refunds and abandoned carts. Counts only: never a name,
// an email, or a message body. Quiet when every count is zero. "Cannot be read" when a read fails.

const NOW = new Date('2026-10-10T08:00:00Z');
const SINCE = '2026-10-09T08:00:00Z';

function quietFacts(extra: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    articles: { ok: true, count: 0, titles: [] },
    orders: { ok: true, paidCount: 0, usdTotal: 0 },
    views: { ok: true, count: 0 },
    failures: { ok: true, count: 0, codes: [] },
    ...extra,
  };
}

function moneyLines(result: ReturnType<typeof buildBriefing>): string[] {
  if (result.quiet) return [];
  return result.sections.find((section) => section.id === 'money')?.lines ?? [];
}

describe('the briefing queues: quiet when zero, count only', () => {
  it('when every queue is zero and everything else is read and empty, the day is quiet', () => {
    const result = buildBriefing(
      quietFacts({ commentsWaiting: { ok: true, count: 0 }, refundsOpen: { ok: true, count: 0 }, cartsAbandoned: { ok: true, count: 0 } }),
      NOW,
      SINCE,
      false,
    );
    expect(result.quiet).toBe(true);
  });

  it('a refund waiting is news, so the day is not quiet, and the owner reads a count', () => {
    const result = buildBriefing(quietFacts({ refundsOpen: { ok: true, count: 2 } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    expect(moneyLines(result)).toContain('2 refund requests are waiting for you in Admin.');
  });

  it('one comment and one abandoned cart read as one, singular', () => {
    expect(queueLines({ ok: true, count: 1 }, COMMENTS_WORDING)).toEqual(['One comment is waiting for your approval.']);
    expect(queueLines({ ok: true, count: 1 }, CARTS_WORDING)).toEqual(['One abandoned cart has not been recovered yet.']);
  });

  it('a queue with a zero count adds no line at all', () => {
    expect(queueLines({ ok: true, count: 0 }, REFUNDS_WORDING)).toEqual([]);
    expect(queueLines(undefined, REFUNDS_WORDING)).toEqual([]);
  });

  it('a failed read says it cannot be read, and the day is not called quiet', () => {
    const result = buildBriefing(quietFacts({ cartsAbandoned: { ok: false, count: 0 } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    expect(moneyLines(result)).toContain('I cannot read the abandoned carts yet.');
  });

  it('a failed comments read is named as such, not counted as zero', () => {
    const result = buildBriefing(quietFacts({ commentsWaiting: { ok: false, count: 0 } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    expect(moneyLines(result)).toContain('I cannot read the comments waiting for approval yet.');
  });

  it('the queue lines hold no name, no address and no text: they are only numbers and fixed words', () => {
    const all = [
      ...queueLines({ ok: true, count: 7 }, COMMENTS_WORDING),
      ...queueLines({ ok: true, count: 7 }, REFUNDS_WORDING),
      ...queueLines({ ok: true, count: 7 }, CARTS_WORDING),
    ].join(' ');
    expect(all).not.toMatch(/@|\bemail\b|customer|jane|reason/i);
    expect(all).toMatch(/7 comments|7 refund requests|7 abandoned carts/);
  });

  it('the reads select only a count (head) from the three tables, never a name, an address or a body', () => {
    const source = readFileSync(resolve(__dirname, '../../supabase/functions/buddy-think/index.ts'), 'utf8');
    const block = source.slice(source.indexOf('const [commentsQueue, refundsQueue, cartsQueue]'), source.indexOf('const [commentsQueue, refundsQueue, cartsQueue]') + 700);
    expect(block).toMatch(/from\("comments"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("is_approved", false\)/);
    expect(block).toMatch(/from\("refund_requests"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("status", "pending"\)/);
    expect(block).toMatch(/from\("abandoned_carts"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("recovered", false\)/);
    expect(block).not.toMatch(/customer_email|author_email|cart_data|content/);
  });
});
