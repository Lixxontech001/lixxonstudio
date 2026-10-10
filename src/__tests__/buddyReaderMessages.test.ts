// Phase 9 slice 3: the reader message tap. Buddy says a reader's form message is waiting, and never replies.
// The briefing rules are checked with facts. The read is checked from source: a count only, and no write.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBriefing, messageLines, type BriefingFacts } from '../../supabase/functions/_shared/buddyBriefing';

const NOW = new Date('2026-10-09T12:00:00Z');
const SINCE = '2026-10-08T12:00:00Z';
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

function facts(overrides: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    articles: { ok: true, count: 0, titles: [] },
    orders: { ok: true, paidCount: 0, usdTotal: 0 },
    views: { ok: true, count: 0 },
    failures: { ok: true, count: 0, codes: [] },
    ...overrides,
  };
}

function money(result: ReturnType<typeof buildBriefing>): string[] {
  return result.sections.find((section) => section.id === 'money')?.lines ?? [];
}

describe('the reader message tap in the briefing', () => {
  it('one message says "There is a message for you."', () => {
    const result = buildBriefing(facts({ messages: { ok: true, count: 1 } }), NOW, SINCE, false);
    expect(money(result)).toContain('There is a message for you.');
    expect(result.quiet).toBe(false);
  });

  it('more than one says how many', () => {
    const result = buildBriefing(facts({ messages: { ok: true, count: 3 } }), NOW, SINCE, false);
    expect(money(result)).toContain('There are 3 messages for you.');
  });

  it('no message adds no line, and a quiet day stays quiet', () => {
    expect(messageLines({ ok: true, count: 0 })).toEqual([]);
    expect(buildBriefing(facts({ messages: { ok: true, count: 0 } }), NOW, SINCE, false).quiet).toBe(true);
  });

  it('a failed read says so, and the day is not quiet', () => {
    const result = buildBriefing(facts({ messages: { ok: false, count: 0 } }), NOW, SINCE, false);
    expect(money(result)).toContain('I cannot read your messages yet.');
    expect(result.quiet).toBe(false);
  });

  it('the next move points to Admin when a message is waiting', () => {
    const result = buildBriefing(facts({ messages: { ok: true, count: 1 } }), NOW, SINCE, false);
    const next = result.sections.find((section) => section.id === 'next')?.lines ?? [];
    expect(next).toEqual(['Read the new reader message in Admin.']);
  });

  it('the briefing line never carries a name, an address or the text of a message', () => {
    const result = buildBriefing(facts({ messages: { ok: true, count: 2 } }), NOW, SINCE, false);
    expect(result.text).not.toMatch(/@|mailto|name|message text/i);
  });
});

describe('the tap is read-only and never replies', () => {
  const think = read('supabase/functions/buddy-think/index.ts');

  it('reads reader messages with a count only (head), never their columns', () => {
    const block = think.match(/\.from\("contact_messages"\)[\s\S]*?\.gt\("created_at", sinceIso\)/)?.[0] ?? '';
    expect(block).toContain('.select("id", { count: "exact", head: true })');
    expect(block).not.toMatch(/name|email|message\b|topic/);
  });

  it('nothing in buddy-think writes to the reader form table, the email queue, or sends mail', () => {
    expect(think).not.toMatch(/contact_messages[\s\S]{0,200}\.(insert|update|upsert|delete)\(/);
    expect(think).not.toMatch(/from\("email_queue"\)/);
    expect(think).not.toMatch(/send-emails|sendEmail|resend/i);
  });

  it('the briefing rules never reply to a reader', () => {
    const rules = read('supabase/functions/_shared/buddyBriefing.ts');
    expect(rules).not.toMatch(/reply to (a )?reader|sendReply|mailto/i);
  });

  it('the reader form read is wired into the briefing facts and the quiet check', () => {
    expect(think).toContain('messages: { ok: !messageRead.error, count: messageRead.count ?? 0 }');
    const rules = read('supabase/functions/_shared/buddyBriefing.ts');
    expect(rules).toContain('const messagesRead = facts.messages ? facts.messages.ok : true;');
    expect(rules).toContain('!messagesReal');
  });
});
