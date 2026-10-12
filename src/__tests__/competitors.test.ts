import { describe, expect, it, vi } from 'vitest';
import {
  COMPETITOR_READ_LIMIT,
  WATCH_NONE_LINE,
  WATCH_NOTHING_TODAY,
  changeLine,
  competitorChange,
  competitorLabel,
  fingerprintOf,
  pageText,
  pageTitle,
  planCompetitorReads,
  publicPageProblem,
  readPageParts,
  runCompetitorReads,
  urlsInMessage,
  watchAsk,
  watchRefusedLine,
  watchSavedLine,
  type CompetitorFetch,
  type CompetitorRunPorts,
  type SavedCompetitor,
} from '../../supabase/functions/_shared/competitors';
import { KILL_BLOCK_DETAIL, TAKEOVER_OFF_DETAIL } from '../../supabase/functions/_shared/runDay';

const DAY_INPUT = { localDay: '2026-10-10', takeover: true, killScope: 'none' as const };

function saved(overrides: Partial<SavedCompetitor> = {}): SavedCompetitor {
  return {
    id: 'c1',
    url: 'https://rival.example/guide',
    label: 'rival.example',
    lastReadAt: null,
    lastTitle: null,
    lastFingerprint: null,
    ...overrides,
  };
}

function page(html: string): string {
  return html;
}

function ports(overrides: Partial<CompetitorRunPorts> = {}): CompetitorRunPorts {
  return {
    readSaved: async () => [saved()],
    readReadToday: async () => new Set<string>(),
    readPage: async () => ({ ok: true, html: page('<html><title>Rival home</title><body>Hello readers.</body></html>') }),
    recordRead: async () => true,
    log: async () => {},
    ...overrides,
  };
}

describe('a watched page is a public page', () => {
  it('takes an https address on a public host', () => {
    expect(publicPageProblem('https://rival.example/guide')).toBeNull();
    expect(publicPageProblem('https://www.rival.example/a/b?x=1')).toBeNull();
    expect(publicPageProblem('https://rival.example:443/guide')).toBeNull();
  });

  it('refuses anything that is not a public https page, with its own plain reason', () => {
    expect(publicPageProblem('http://rival.example/guide')).toBe('not_secure');
    expect(publicPageProblem('https://me:secret@rival.example/guide')).toBe('has_sign_in');
    expect(publicPageProblem('https://localhost:3000/x')).toBe('not_public');
    expect(publicPageProblem('https://192.168.0.4/x')).toBe('not_public');
    expect(publicPageProblem('https://10.0.0.5/x')).toBe('not_public');
    expect(publicPageProblem('https://rival.local/x')).toBe('not_public');
    expect(publicPageProblem('https://shop.internal/x')).toBe('not_public');
    expect(publicPageProblem('https://[::1]/x')).toBe('not_public');
    expect(publicPageProblem('https://rival/x')).toBe('not_public');
    expect(publicPageProblem(`https://rival.example/${'a'.repeat(300)}`)).toBe('too_long');
  });

  it('labels a page by its host, without the www, and never by a made-up name', () => {
    expect(competitorLabel('https://www.rival.example/guide')).toBe('rival.example');
    expect(competitorLabel('https://RIVAL.example/a')).toBe('rival.example');
    expect(competitorLabel('https://rival.example:8443/a')).toBe('rival.example');
    expect(competitorLabel('not an address')).toBe('a page');
  });
});

describe('the owner saves the links in the chat', () => {
  it('reads every address written, in order, without repeats and without trailing punctuation', () => {
    expect(urlsInMessage('watch https://a.example, https://b.example. and https://a.example')).toEqual(['https://a.example', 'https://b.example']);
    expect(urlsInMessage('no links here')).toEqual([]);
  });

  it('saves only a watch ask: a question, a plain link or a link with no watch words is not one', () => {
    expect(watchAsk('Why do you watch rivals?')).toBeNull();
    expect(watchAsk('https://rival.example/guide')).toBeNull();
    expect(watchAsk('Look at https://rival.example/guide and tell me what is wrong')).toBeNull();
    expect(watchAsk('watch these links')).toBeNull();
    expect(watchAsk('Keep an eye on https://rival.example/guide and https://other.example/news')).toEqual({
      wanted: ['https://rival.example/guide', 'https://other.example/news'],
      refused: [],
    });
  });

  it('names every link that is not a public page, with its plain reason, and saves the rest', () => {
    const ask = watchAsk('watch https://rival.example/guide and http://old.example/news and https://localhost/x');
    expect(ask?.wanted).toEqual(['https://rival.example/guide']);
    expect(ask?.refused).toEqual([
      { url: 'http://old.example/news', problem: 'not_secure' },
      { url: 'https://localhost/x', problem: 'not_public' },
    ]);
  });

  it('the saved line names the pages and the ten-a-day rule, and the refused line names each one', () => {
    expect(watchSavedLine(['rival.example', 'other.example'])).toBe(
      'Watching 2 pages: rival.example, other.example. I read up to ten public pages a day, oldest first, and tell you only what changed.',
    );
    expect(watchSavedLine([])).toBe(WATCH_NONE_LINE);
    expect(watchRefusedLine([{ url: 'http://old.example/news', problem: 'not_secure' }])).toBe('Not watched: http://old.example/news (it does not start with https).');
    expect(watchRefusedLine([])).toBeNull();
  });
});

describe('ten pages a day, oldest first', () => {
  it('skips the pages read today, takes the ones never read first, and never more than ten', () => {
    const many = Array.from({ length: 12 }, (_, index) => saved({ id: `c${index}`, url: `https://rival.example/${index}`, lastReadAt: `2026-10-0${(index % 8) + 1}T00:00:00Z` }));
    const planned = planCompetitorReads([saved({ id: 'never' }), ...many], new Set(['c0', 'c1']));
    expect(planned.length).toBe(COMPETITOR_READ_LIMIT);
    expect(planned[0]?.id).toBe('never');
    expect(planned.map((item) => item.id)).not.toContain('c0');
    expect(planned.map((item) => item.id)).not.toContain('c1');
  });

  it('every page read today is left for tomorrow', () => {
    expect(planCompetitorReads([saved()], new Set(['c1']))).toEqual([]);
  });
});

describe('an honest change line or nothing', () => {
  it('reads the headline and the text of a page, without its scripts and styles', () => {
    const html = '<html><head><title>The Rival Guide</title><style>p{color:red}</style></head><body><script>alert(1)</script><h1>Big</h1><p>Hello&nbsp;there</p></body></html>';
    expect(pageTitle(html)).toBe('The Rival Guide');
    expect(pageText(html)).toBe('Big Hello there');
    expect(pageTitle('<html><body><h1>Only a heading</h1></body></html>')).toBe('Only a heading');
    expect(pageTitle('<html><body>no heading</body></html>')).toBeNull();
  });

  it('the same text gives the same mark, and a changed text does not', () => {
    expect(fingerprintOf('hello')).toBe(fingerprintOf('hello'));
    expect(fingerprintOf('hello')).not.toBe(fingerprintOf('hello!'));
  });

  it('a first read claims nothing, and a read with no change claims nothing', () => {
    const parts = readPageParts('<title>A</title><body>Same</body>');
    expect(changeLine(null, parts)).toBeNull();
    expect(changeLine({ title: parts.title, fingerprint: parts.fingerprint }, parts)).toBeNull();
    expect(changeLine({ title: 'A', fingerprint: null }, parts)).toBeNull();
  });

  it('a new headline is named, and any other change is the plain sentence that the text changed', () => {
    const next = readPageParts('<title>New headline</title><body>Same</body>');
    expect(changeLine({ title: 'Old headline', fingerprint: 'abc:4' }, next)).toBe('The headline is now "New headline".');
    expect(changeLine({ title: null, fingerprint: 'abc:4' }, next)).toBe('The page now has a headline: "New headline".');
    const noTitle = { title: null, fingerprint: 'zzz:9' };
    expect(changeLine({ title: null, fingerprint: 'abc:4' }, noTitle)).toBe('The page text changed.');
  });

  it('the notable names the page, carries the honest line, and is written once per page per day', () => {
    const read = { id: 'c1', url: 'https://rival.example/guide', label: 'rival.example' };
    const change = competitorChange(read, 'The page text changed.', '2026-10-10');
    expect(change.title).toBe('Rival page changed: "rival.example"');
    expect(change.detail).toBe('The page text changed. https://rival.example/guide');
    expect(change.key).toBe('competitor_changed:c1:2026-10-10');
  });
});

describe('the day reads the saved pages', () => {
  it('Takeover off: nothing is read, nothing is fetched, nothing is written', async () => {
    const readSaved = vi.fn(async () => [saved()]);
    const readPage = vi.fn(async (): Promise<CompetitorFetch> => ({ ok: true, html: '<title>A</title>' }));
    const result = await runCompetitorReads({ ...DAY_INPUT, takeover: false }, ports({ readSaved, readPage }));
    expect(result).toEqual({ status: 'held', detail: TAKEOVER_OFF_DETAIL, read: 0, changes: [] });
    expect(readSaved).not.toHaveBeenCalled();
    expect(readPage).not.toHaveBeenCalled();
  });

  it('a Kill switch holds the step, and nothing is read', async () => {
    const readSaved = vi.fn(async () => [saved()]);
    const result = await runCompetitorReads({ ...DAY_INPUT, killScope: 'strategist' }, ports({ readSaved }));
    expect(result).toEqual({ status: 'held', detail: KILL_BLOCK_DETAIL, read: 0, changes: [] });
    expect(readSaved).not.toHaveBeenCalled();
  });

  it('no saved page, or every page already read today: nothing to do, and nothing is fetched', async () => {
    const readPage = vi.fn(async (): Promise<CompetitorFetch> => ({ ok: true, html: '' }));
    expect(await runCompetitorReads(DAY_INPUT, ports({ readSaved: async () => [], readPage }))).toMatchObject({ status: 'nothing_to_do', read: 0 });
    const already = await runCompetitorReads(DAY_INPUT, ports({ readReadToday: async () => new Set(['c1']), readPage }));
    expect(already).toEqual({ status: 'nothing_to_do', detail: WATCH_NOTHING_TODAY, read: 0, changes: [] });
    expect(readPage).not.toHaveBeenCalled();
  });

  it('a read with no change is recorded, logged, and claims nothing', async () => {
    const recordRead = vi.fn(async () => true);
    const log = vi.fn(async () => {});
    const result = await runCompetitorReads(DAY_INPUT, ports({ recordRead, log }));
    expect(recordRead).toHaveBeenCalledTimes(1);
    const [read, parts, note, day] = recordRead.mock.calls[0]! as unknown as [unknown, { fingerprint: string }, string | null, string];
    expect(read).toMatchObject({ id: 'c1', label: 'rival.example' });
    expect(note).toBeNull();
    expect(day).toBe('2026-10-10');
    expect(parts.fingerprint.length).toBeGreaterThan(0);
    expect(result).toMatchObject({ status: 'done', read: 1, changes: [] });
    expect(log).toHaveBeenCalledWith('rival.example was read. Nothing changed.');
  });

  it('a changed page is told once, with the honest line and the page address', async () => {
    const html = '<title>Brand new headline</title><body>Different words entirely</body>';
    const result = await runCompetitorReads(
      DAY_INPUT,
      ports({
        readSaved: async () => [saved({ lastReadAt: '2026-10-09T06:00:00Z', lastTitle: 'Old headline', lastFingerprint: 'abc:3' })],
        readPage: async () => ({ ok: true, html }),
      }),
    );
    expect(result.changes.length).toBe(1);
    expect(result.changes[0]?.line).toBe('The headline is now "Brand new headline".');
    expect(result.changes[0]?.key).toBe('competitor_changed:c1:2026-10-10');
    expect(result.detail).toBe('Read 1 page today. 1 changed.');
  });

  it('a page that cannot be read is not recorded, is never claimed, and the other pages still run', async () => {
    const recordRead = vi.fn(async () => true);
    const log = vi.fn(async () => {});
    const twoSaved = [saved({ id: 'c1', url: 'https://rival.example/guide' }), saved({ id: 'c2', url: 'https://other.example/news', label: 'other.example' })];
    const result = await runCompetitorReads(
      DAY_INPUT,
      ports({
        readSaved: async () => twoSaved,
        readPage: async (url) => (url.includes('rival') ? { ok: false, reason: 'the page could not be reached in time.' } : { ok: true, html: '<title>Other</title>' }),
        recordRead,
        log,
      }),
    );
    expect(result.read).toBe(1);
    expect(recordRead).toHaveBeenCalledTimes(1);
    const recorded = recordRead.mock.calls[0]![0] as { id: string };
    expect(recorded.id).toBe('c2');
    expect(log.mock.calls.map((call) => String(call[0])).join(' ')).toContain('could not be read today');
  });

  it("the day's ten used up stops the reads, and the step says so", async () => {
    const log = vi.fn(async () => {});
    const result = await runCompetitorReads(DAY_INPUT, ports({ recordRead: async () => false, log }));
    expect(result.read).toBe(0);
    expect(log.mock.calls.map((call) => String(call[0])).join(' ')).toContain('ten pages for today are used up');
    expect(result.detail).toContain('No rival page could be read today');
  });

  it('at most ten pages are fetched in one run, however many are saved', async () => {
    const many = Array.from({ length: 14 }, (_, index) => saved({ id: `c${index}`, url: `https://rival.example/${index}` }));
    const readPage = vi.fn(async (): Promise<CompetitorFetch> => ({ ok: true, html: '<title>Rival</title>' }));
    const result = await runCompetitorReads(DAY_INPUT, ports({ readSaved: async () => many, readPage }));
    expect(readPage).toHaveBeenCalledTimes(COMPETITOR_READ_LIMIT);
    expect(result.read).toBe(COMPETITOR_READ_LIMIT);
  });
});
