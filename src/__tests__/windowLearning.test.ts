import { describe, expect, it } from 'vitest';
import {
  CHANNEL_WINDOWS,
  LEARN_MIN_POSTS,
  TIME_WINDOWS,
  learnWindows,
  suggestedTimeFor,
  timeOptionsFor,
  timeProblem,
  windowForTime,
} from '../../supabase/functions/_shared/packCopy';
import { PACK_CHANNELS } from '../../supabase/functions/_shared/packRules';
import { runDayPacks, type DayPacksInput, type DayPacksPorts, type PackRow, type PackSource } from '../../supabase/functions/_shared/dayPacks';
import type { ArticleImageCheck } from '../../supabase/functions/_shared/articleImage';

const DAY = '2026-10-10';
const PICTURE = 'https://images.example.com/cover.jpg';

/** A time on DAY at the given UTC hour and minute. */
function at(hour: number, minute = 0): string {
  return new Date(Date.UTC(2026, 9, 10, hour, minute)).toISOString();
}

/** `count` measured posts all at the given UTC hour. */
function postsAt(hour: number, count: number): string[] {
  return Array.from({ length: count }, () => at(hour));
}

describe('a posting time belongs to the window it is near', () => {
  it('maps the window hours, and a half hour rounds up to the next window', () => {
    expect(windowForTime(at(13))?.id).toBe('us-east-morning');
    expect(windowForTime(at(12, 40))?.id).toBe('us-east-morning');
    expect(windowForTime(at(12, 20))?.id).toBe('uk-lunchtime');
    expect(windowForTime(at(3))).toBeNull();
    expect(windowForTime('not a time')).toBeNull();
  });

  it('every window reaches one of the top countries', () => {
    for (const window of TIME_WINDOWS) {
      expect(window.countries.length).toBeGreaterThan(0);
    }
    const countries = TIME_WINDOWS.flatMap((window) => [...window.countries]);
    for (const top of ['US', 'UK', 'Canada', 'Australia', 'Ireland', 'New Zealand', 'Singapore']) {
      expect(countries).toContain(top);
    }
  });
});

describe('thin or failed data keeps the current windows, and says so', () => {
  it('fewer measured posts than the minimum: no ranking, an honest note', () => {
    const result = learnWindows(postsAt(22, LEARN_MIN_POSTS - 1), true);
    expect(result.learned).toBe(false);
    expect(result.ranked).toEqual([]);
    expect(result.measured).toBe(LEARN_MIN_POSTS - 1);
    expect(result.note).toContain(`Only ${LEARN_MIN_POSTS - 1} measured posts so far`);
    expect(result.note).toContain('Keeping the current posting windows.');
  });

  it('no measured posts at all: still honest, still the current windows', () => {
    const result = learnWindows([], true);
    expect(result.learned).toBe(false);
    expect(result.measured).toBe(0);
    expect(result.note).toContain('Only 0 measured posts so far');
  });

  it('a failed read: nothing is learned, and the note says the read failed', () => {
    const result = learnWindows(postsAt(22, 50), false);
    expect(result.learned).toBe(false);
    expect(result.ranked).toEqual([]);
    expect(result.note).toBe('The measured posts could not be read. Keeping the current posting windows.');
  });

  it('times that fit no window are not counted as measured', () => {
    const result = learnWindows([...postsAt(3, 30), ...postsAt(22, 4)], true);
    expect(result.measured).toBe(4);
    expect(result.learned).toBe(false);
  });
});

describe('enough measured data reorders the windows, and nothing else', () => {
  it('ranks the window with the most measured posts first', () => {
    const result = learnWindows([...postsAt(22, 3), ...postsAt(12, 9), ...postsAt(1, 2)], true);
    expect(result.learned).toBe(true);
    expect(result.measured).toBe(14);
    expect(result.ranked[0]).toBe('uk-lunchtime');
    expect(result.ranked[1]).toBe('au-morning');
    expect(result.ranked).toHaveLength(TIME_WINDOWS.length);
    expect(result.note).toContain('Ranked 14 measured posts');
    expect(result.note).toContain('Best window so far: Lunchtime, UK and Ireland');
  });

  it('the offered windows for a channel are the same set, however they are ranked', () => {
    const reversed = [...TIME_WINDOWS].reverse().map((window) => window.id);
    for (const channel of PACK_CHANNELS) {
      const plain = timeOptionsFor(channel).map((option) => option.id).sort();
      const ranked = timeOptionsFor(channel, reversed).map((option) => option.id).sort();
      expect(ranked).toEqual(plain);
      expect(plain).toEqual([...CHANNEL_WINDOWS[channel]].sort());
    }
  });

  it('the suggestion takes the best offered window, and the Auditor accepts it', () => {
    for (const channel of PACK_CHANNELS) {
      const offered = CHANNEL_WINDOWS[channel];
      const ranked = [...offered].reverse();
      const suggestion = suggestedTimeFor(channel, DAY, undefined, ranked);
      expect(suggestion?.windowId).toBe(ranked[0]);
      expect(timeProblem(channel, suggestion!.atUtc, suggestion!.windowId)).toBeNull();
    }
  });

  it('a ranking with no offered window does not change the suggestion', () => {
    expect(suggestedTimeFor('facebook', DAY, undefined, ['sg-evening'])?.windowId).toBe('us-east-morning');
    expect(suggestedTimeFor('facebook', DAY)?.windowId).toBe('us-east-morning');
  });

  it('the Auditor still refuses a window that is not offered for the channel', () => {
    const wrong = suggestedTimeFor('facebook', DAY, 'sg-evening');
    expect(wrong).toBeNull();
    expect(timeProblem('facebook', at(11), 'sg-evening')).toBe('time_not_offered');
  });
});

describe('the day run uses the learned order and logs the note', () => {
  const SHOP = [
    { id: 'p1', name: 'Calm Skin Routine Guide', isDigital: true, priceUsd: 12 },
    { id: 'p2', name: 'Dry Skin Checklist', isDigital: true, priceUsd: 5 },
  ];
  const ARTICLE: PackSource = {
    id: 'post-1',
    title: 'Easy Skincare Routine for Dry Skin',
    slug: 'easy-skincare-routine-dry-skin',
    coverImage: PICTURE,
    liveProductIds: ['p1', 'p2'],
  };
  const GOOD = {
    instagram: 'A calm routine for dry skin, with the Calm Skin Routine Guide that keeps the steps in order.',
    tiktok: 'Dry skin feels tight by midday. The Calm Skin Routine Guide puts the steps in one easy order.',
    facebook: 'If your skin feels dry after washing, start with one calm order of steps. The Dry Skin Checklist shows it.',
    pinterest: { title: 'Calm routine for dry skin', description: 'A simple order of steps for dry skin, with the Calm Skin Routine Guide.' },
  };
  const IMAGE: ArticleImageCheck = { ok: true, url: PICTURE, contentType: 'image/jpeg', bytes: 2048 };

  function harness() {
    const rows: PackRow[] = [];
    const logs: string[] = [];
    const ports: DayPacksPorts = {
      think: async () => ({ ok: true, text: JSON.stringify(GOOD) }) as never,
      checkImage: async () => IMAGE,
      savePack: async (row) => {
        rows.push(row);
        return { ok: true };
      },
      log: async (entry) => {
        logs.push(entry.detail);
      },
    };
    return { ports, rows, logs };
  }

  function input(overrides: Partial<DayPacksInput> = {}): DayPacksInput {
    return {
      localDay: DAY,
      takeover: true,
      killScope: 'none',
      articles: [ARTICLE],
      shop: SHOP,
      siteOrigin: 'https://lixxonstudio.example',
      alreadyMade: false,
      ...overrides,
    };
  }

  it('a learned order moves the Facebook suggestion to the top-ranked window', async () => {
    const { ports, rows } = harness();
    const learning = learnWindows([...postsAt(12, 12)], true);
    await runDayPacks(input({ learning }), ports);
    const facebook = rows.find((row) => row.channel === 'facebook');
    expect(facebook?.suggestedAtUtc).toBe(`${DAY}T12:00:00.000Z`);
  });

  it('thin data keeps the current Facebook suggestion, and the log says why', async () => {
    const { ports, rows, logs } = harness();
    const learning = learnWindows(postsAt(12, 3), true);
    await runDayPacks(input({ learning }), ports);
    const facebook = rows.find((row) => row.channel === 'facebook');
    expect(facebook?.suggestedAtUtc).toBe(`${DAY}T13:00:00.000Z`);
    expect(logs.join(' ')).toContain('Only 3 measured posts so far');
  });

  it('no learning input at all still works as it did before', async () => {
    const { ports, rows, logs } = harness();
    await runDayPacks(input(), ports);
    const facebook = rows.find((row) => row.channel === 'facebook');
    expect(facebook?.suggestedAtUtc).toBe(`${DAY}T13:00:00.000Z`);
    expect(logs.join(' ')).not.toContain('measured posts');
  });
});
