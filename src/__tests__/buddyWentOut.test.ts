import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOOR_LINE_LIMIT,
  NOTHING_SENT_LINE,
  briefingDoors,
  buildBriefing,
  doorSentLines,
  type BriefingFacts,
} from '../../supabase/functions/_shared/buddyBriefing';

const NOW = new Date('2026-10-09T12:00:00Z');
const SINCE = '2026-10-08T12:00:00Z';

function facts(overrides: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    articles: { ok: true, count: 0, titles: [] },
    orders: { ok: true, paidCount: 0, usdTotal: 0 },
    views: { ok: true, count: 0 },
    failures: { ok: true, count: 0, codes: [] },
    ...overrides,
  };
}

const POSTED = (door: string, postTitle = 'Calm Routine') => ({ door, status: 'posted' as const, postTitle, errorNote: null });

describe('"What went out" reads the real door send log', () => {
  it('with no read asked for, it keeps the plain nothing-sent line', () => {
    expect(doorSentLines(undefined)).toEqual([NOTHING_SENT_LINE]);
  });

  it('a readable log with no posts says nothing went out', () => {
    expect(doorSentLines({ ok: true, rows: [] })).toEqual([NOTHING_SENT_LINE]);
  });

  it('a posted row is named by its door label and article title, and the nothing-sent line is not shown', () => {
    expect(doorSentLines({ ok: true, rows: [POSTED('pixelfed')] })).toEqual(['Posted to Pixelfed: "Calm Routine".']);
    expect(doorSentLines({ ok: true, rows: [POSTED('wordpress_com', 'Dry Skin')] })).toEqual(['Posted to WordPress.com: "Dry Skin".']);
  });

  it('each of the twelve doors has its own label, so no post is labelled with another door', () => {
    const doors = ['telegram', 'discord', 'bluesky', 'mastodon', 'tumblr', 'blogger', 'medium', 'pixelfed', 'wordpress_com', 'youtube', 'vimeo', 'podcast'];
    const lines = doors.map((door) => doorSentLines({ ok: true, rows: [POSTED(door)] })[0]);
    expect(new Set(lines).size).toBe(12);
    expect(lines).toContain('Posted to YouTube: "Calm Routine".');
    expect(lines).toContain('Posted to Vimeo: "Calm Routine".');
    expect(lines).toContain('Posted to Podcast: "Calm Routine".');
    expect(lines).toContain('Posted to WordPress.com: "Calm Routine".');
  });

  it('a day with only a failed door post is not "quiet", so the failure is shown', () => {
    const result = buildBriefing(facts({ doors: { ok: true, rows: [{ door: 'vimeo', status: 'failed', postTitle: 'A', errorNote: null }] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
  });

  it('a door log that could not be read is not "quiet" either', () => {
    const result = buildBriefing(facts({ doors: { ok: false, rows: [] } }), NOW, SINCE, false);
    expect(result.quiet).toBe(false);
    expect(result.sections.find((item) => item.id === 'went_out')?.lines).toEqual(['I cannot read the send log just now.']);
  });

  it('a failed row says the door did not post, with the send log note, and a failed-only log still says nothing was sent', () => {
    const lines = doorSentLines({ ok: true, rows: [{ door: 'youtube', status: 'failed', postTitle: 'Dry Skin', errorNote: 'YouTube did not take the video.' }] });
    expect(lines).toEqual([NOTHING_SENT_LINE, 'YouTube did not post "Dry Skin". YouTube did not take the video.']);
  });

  it('a failed row with no note says nothing was posted', () => {
    expect(doorSentLines({ ok: true, rows: [{ door: 'vimeo', status: 'failed', postTitle: 'A', errorNote: null }] })[1])
      .toBe('Vimeo did not post "A". Nothing was posted.');
  });

  it('a queued row is shown as still saving, never as posted', () => {
    const lines = doorSentLines({ ok: true, rows: [{ door: 'podcast', status: 'queued', postTitle: 'Dry Skin', errorNote: null }] });
    expect(lines).toEqual([NOTHING_SENT_LINE, 'Podcast is still saving a post for "Dry Skin".']);
  });

  it('a failed read is said plainly, not shown as nothing sent', () => {
    expect(doorSentLines({ ok: false, rows: [] })).toEqual(['I cannot read the send log just now.']);
  });

  it('the list is capped, so a busy day cannot bury the briefing', () => {
    const rows = Array.from({ length: 20 }, () => POSTED('telegram'));
    expect(doorSentLines({ ok: true, rows })).toHaveLength(DOOR_LINE_LIMIT);
  });

  it('a missing title is a plain fallback, never a guessed one', () => {
    const posted = briefingDoors([{ door: 'discord', status: 'posted', post_id: 'x', error_note: null }], {});
    expect(posted).toEqual([{ door: 'discord', status: 'posted', postTitle: 'an article', errorNote: null }]);
  });

  it('rows with an unknown door or status are dropped, never shown', () => {
    const rows = briefingDoors(
      [
        { door: 'instagram', status: 'posted', post_id: 'a', error_note: null },
        { door: 'telegram', status: 'published', post_id: 'a', error_note: null },
        { door: 'telegram', status: 'posted', post_id: 'a', error_note: null },
      ],
      { a: 'Title' },
    );
    expect(rows.map((row) => `${row.door}:${row.status}`)).toEqual(['telegram:posted']);
  });

  it('the briefing puts the door lines first in "What went out"', () => {
    const result = buildBriefing(facts({ doors: { ok: true, rows: [POSTED('discord', 'Calm')] } }), NOW, SINCE, false);
    const section = result.sections.find((item) => item.id === 'went_out');
    expect(section?.lines[0]).toBe('Posted to Discord: "Calm".');
    expect(section?.lines).not.toContain(NOTHING_SENT_LINE);
  });

  it('no line in the section has an em dash', () => {
    const rows = [POSTED('telegram'), { door: 'vimeo', status: 'failed' as const, postTitle: 'A', errorNote: 'Vimeo refused the upload. Check the upload limit on your Vimeo plan.' }];
    const result = buildBriefing(facts({ doors: { ok: true, rows } }), NOW, SINCE, false);
    for (const line of result.sections.find((item) => item.id === 'went_out')?.lines ?? []) expect(line).not.toMatch(/—|–/);
  });

  it('the day run has no hard-coded sentence left for the door section: the briefing reads doors through the owner session', () => {
    const index = readFileSync(join(process.cwd(), 'supabase/functions/buddy-think/index.ts'), 'utf8');
    expect(index).toContain('.from("minds_door_posts")');
    expect(index).toMatch(/doors: \{ ok: !doorRead\.error, rows: briefingDoors\(doorRows, postTitles\) \}/);
  });
});
