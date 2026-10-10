// @vitest-environment node
// Phase 7 slice 5: honest skips in the briefing, and Medium's "gone" answer. A fake network only. No real door is contacted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sendMedium, MEDIUM_CLOSED_REASON, type FetchLike } from '../../supabase/functions/_shared/doorAdapters';
import { HONEST_SKIP_LINE_LIMIT, HONEST_SKIP_PHRASES, isHonestSkip } from '../../supabase/functions/_shared/honestSkips';
import { buildBriefing, type BriefingFacts } from '../../supabase/functions/_shared/buddyBriefing';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const TEXT = 'New on the blog: Easy routine for dry skin\nhttps://lixxonstudio.example/post/dry-skin';
const NOW = new Date('2026-10-10T12:00:00Z');
const SINCE = '2026-10-09T12:00:00Z';

function network(answer: (url: string) => Response): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return answer(url);
  };
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Medium: a "gone" answer marks the door closed, in plain words', () => {
  it('the account read answers 410, so the door is closed and nothing is posted', async () => {
    const { fetchImpl, calls } = network(() => new Response('', { status: 410 }));
    const result = await sendMedium({ accessToken: 'MEDIUM-TOKEN-SECRET' }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: MEDIUM_CLOSED_REASON, closed: true });
    expect(MEDIUM_CLOSED_REASON).toBe('Medium: this door is closed.');
    expect(calls).toHaveLength(1);
  });

  it('the post answers 410, so the door is closed too', async () => {
    const { fetchImpl } = network((url) => (url.endsWith('/v1/me') ? json({ data: { id: 'ACCT1' } }) : new Response('', { status: 410 })));
    expect(await sendMedium({ accessToken: 'MEDIUM-TOKEN-SECRET' }, TEXT, fetchImpl)).toEqual({ ok: false, reason: MEDIUM_CLOSED_REASON, closed: true });
  });

  it('an ordinary failure is not called closed, so the owner is not told the door is gone when it may come back', async () => {
    const { fetchImpl } = network(() => new Response('', { status: 500 }));
    const result = await sendMedium({ accessToken: 'MEDIUM-TOKEN-SECRET' }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'Medium did not return the account.' });
    expect('closed' in result).toBe(false);
  });

  it('the token is never in the closed answer', async () => {
    const { fetchImpl } = network(() => new Response('', { status: 410 }));
    const result = await sendMedium({ accessToken: 'MEDIUM-TOKEN-SECRET' }, TEXT, fetchImpl);
    expect(JSON.stringify(result)).not.toContain('MEDIUM-TOKEN-SECRET');
  });
});

describe('honest skip words', () => {
  it('each honest skip phrase is recognised, and an ordinary "already posted" is not one', () => {
    for (const phrase of HONEST_SKIP_PHRASES) expect(isHonestSkip(`YouTube: ${phrase}. Nothing was posted.`)).toBe(true);
    expect(isHonestSkip('The article has no picture yet. Nothing was posted.')).toBe(true);
    expect(isHonestSkip('YouTube: already posted today.')).toBe(false);
    expect(isHonestSkip('Medium did not take it: Medium did not take the story.')).toBe(false);
  });

  it('the briefing shows at most the limit of honest lines, and the rest stay in the log', () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      happened_at: `2026-10-10T0${index}:00:00Z`,
      mind: 'executioner',
      action: 'Post to a door',
      outcome: 'skipped',
      detail: `Door ${index}: no video yet. Nothing was posted.`,
    }));
    const result = buildBriefing(facts({ minds: { ok: true, rows } }), NOW, SINCE, false);
    expect(sectionLines(result, 'problems')).toHaveLength(HONEST_SKIP_LINE_LIMIT);
  });
});

describe('Buddy Problems lists the honest skips and blocked packs', () => {
  it('a skipped door, a closed door, and a blocked pack all show under Problems, and the day is not quiet', () => {
    const result = buildBriefing(
      facts({
        minds: {
          ok: true,
          rows: [
            { happened_at: '2026-10-10T08:00:00Z', mind: 'executioner', action: 'Post to YouTube', outcome: 'skipped', detail: 'YouTube: no video yet. Nothing was posted.' },
            { happened_at: '2026-10-10T08:01:00Z', mind: 'executioner', action: 'Post to Medium', outcome: 'failed', detail: 'Medium: this door is closed. Nothing was posted.' },
          ],
        },
        packs: { ok: true, rows: [{ channel: 'instagram', status: 'blocked', articleTitle: 'Easy routine', blockedReason: 'video not made yet' }] },
      }),
      NOW,
      SINCE,
      false,
    );
    expect(result.quiet).toBe(false);
    const problems = sectionLines(result, 'problems');
    expect(problems).toContain('YouTube: no video yet. Nothing was posted.');
    expect(problems).toContain('Medium: this door is closed. Nothing was posted.');
    expect(problems).toContain('instagram for "Easy routine": video not made yet');
  });

  it('with no failures and no honest skips, Problems still says there were no errors', () => {
    // Something else happened, so the briefing is not quiet and every section is shown.
    const result = buildBriefing(facts({ articles: { ok: true, count: 1, titles: ['A new article'] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    expect(sectionLines(result, 'problems')).toEqual(['No errors since you left.']);
  });

  it('night reports are not recycled into the morning briefing', () => {
    const briefing = read('supabase/functions/_shared/buddyBriefing.ts');
    expect(briefing).not.toMatch(/night/i);
    expect(briefing).not.toMatch(/buddy_reports|NightReport|nightReportRun|mindsNightReport/);
  });
});

function facts(overrides: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    articles: { ok: true, count: 0, titles: [] },
    orders: { ok: true, paidCount: 0, usdTotal: 0 },
    views: { ok: true, count: 0 },
    failures: { ok: true, count: 0, codes: [] },
    ...overrides,
  };
}

function sectionLines(result: ReturnType<typeof buildBriefing>, id: string): string[] {
  return result.sections.find((section) => section.id === id)?.lines ?? [];
}
