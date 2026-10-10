import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));

import {
  describePackJob,
  listPackJobs,
  markPackPosted,
  parsePackRow,
  utcClock,
  type PackJob,
} from '../buddy/buddyJobs';

const POST_ID = 'post-1';
const TITLES = { [POST_ID]: 'Easy Skincare Routine for Dry Skin' };
const NAMES = { 'prod-1': 'Calm Skin Routine Guide' };

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pack-1',
    channel: 'instagram',
    local_day: '2026-10-10',
    post_id: POST_ID,
    article_url: '/magazine/easy-skincare-routine-dry-skin',
    suggested_at_utc: '2026-10-10T13:00:00+00:00',
    suggested_label: 'Morning, US Eastern',
    caption: 'A calm routine for dry skin, with the guide that keeps the steps in order.',
    pin_title: null,
    pin_description: null,
    video_path: '/tmp/pack-1.mp4',
    product_ids: ['prod-1'],
    status: 'ready',
    blocked_reason: null,
    posted_at: null,
    created_at: '2026-10-10T08:00:00Z',
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}): PackJob {
  const parsed = parsePackRow(row(overrides), TITLES, NAMES);
  if (!parsed) throw new Error('fixture did not parse');
  return parsed;
}

describe('pack rows: only real rows are kept', () => {
  it('a ready Instagram row is read with its title, time, copy and product name', () => {
    const parsed = job();
    expect(parsed.channelLabel).toBe('Instagram');
    expect(parsed.articleTitle).toBe('Easy Skincare Routine for Dry Skin');
    expect(parsed.productNames).toEqual(['Calm Skin Routine Guide']);
    expect(parsed.videoReady).toBe(true);
    expect(parsed.suggestedUtc).toBe('2026-10-10T13:00:00+00:00');
  });

  it('a row with a channel outside the four gated channels is dropped', () => {
    expect(parsePackRow(row({ channel: 'youtube' }), TITLES, NAMES)).toBeNull();
    expect(parsePackRow(row({ channel: 'toString' }), TITLES, NAMES)).toBeNull();
  });

  it('a row with an unknown status, or no id, is dropped', () => {
    expect(parsePackRow(row({ status: 'sent' }), TITLES, NAMES)).toBeNull();
    expect(parsePackRow(row({ id: undefined }), TITLES, NAMES)).toBeNull();
    expect(parsePackRow('not a row', TITLES, NAMES)).toBeNull();
  });

  it('a missing title or product name gets a plain fallback, never a guess', () => {
    const parsed = parsePackRow(row({ post_id: 'unknown', product_ids: ['prod-x'] }), TITLES, NAMES);
    expect(parsed?.articleTitle).toBe('an article');
    expect(parsed?.productNames).toEqual([]);
  });

  it('a pack with no video path says so', () => {
    expect(job({ video_path: null }).videoReady).toBe(false);
  });
});

describe('pack rows: what the owner reads', () => {
  it('a ready pack says it is ready to post by hand, with the UTC time and the label', () => {
    const view = describePackJob(job());
    expect(view.headline).toBe('Instagram for "Easy Skincare Routine for Dry Skin"');
    expect(view.lines).toContain('Ready to post by hand.');
    expect(view.lines).toContain('Suggested time: Morning, US Eastern (13:00 UTC).');
    expect(view.lines).toContain('Video: ready.');
    expect(view.lines).toContain('Products: Calm Skin Routine Guide.');
    expect(view.canMarkPosted).toBe(true);
    expect(view.copy).toEqual([job().caption]);
  });

  it('a ready pack with no video says "video not made yet" and still offers the mark', () => {
    const view = describePackJob(job({ video_path: null }));
    expect(view.lines).toContain('Video: video not made yet.');
    expect(view.canMarkPosted).toBe(true);
  });

  it('a blocked pack shows its plain reason and offers no mark', () => {
    const view = describePackJob(job({ status: 'blocked', blocked_reason: 'video not made yet', suggested_at_utc: null, caption: null }));
    expect(view.lines[0]).toBe('Blocked: video not made yet.');
    expect(view.lines).not.toContain('Ready to post by hand.');
    expect(view.canMarkPosted).toBe(false);
    expect(view.copy).toEqual([]);
  });

  it('a Pinterest pack shows its pin title and description, not a caption', () => {
    const view = describePackJob(
      job({
        channel: 'pinterest',
        caption: null,
        pin_title: 'Easy routine for dry skin',
        pin_description: 'A calm order of steps for dry skin.',
      }),
    );
    expect(view.headline.startsWith('Pinterest for')).toBe(true);
    expect(view.copy).toEqual(['Pin title: Easy routine for dry skin', 'Pin description: A calm order of steps for dry skin.']);
  });

  it('a posted pack says so and offers no mark again', () => {
    const view = describePackJob(job({ status: 'posted_by_owner', posted_at: '2026-10-10T15:00:00Z' }));
    expect(view.lines).toContain('Posted by you on 2026-10-10.');
    expect(view.canMarkPosted).toBe(false);
  });

  it('the words on screen never carry a dash, a country name, or non-US money', () => {
    const views = [
      describePackJob(job()),
      describePackJob(job({ status: 'blocked', blocked_reason: 'copy_not_clean', caption: null })),
      describePackJob(job({ status: 'posted_by_owner', posted_at: '2026-10-10T15:00:00Z' })),
    ];
    const text = views.flatMap((view) => [view.headline, ...view.lines, ...view.copy]).join(' ');
    expect(text).not.toMatch(/[\u2014\u2013]/);
    expect(text).not.toMatch(/nigeria|lagos|naira|\bWAT\b|\u00a3|\u20ac/i);
  });

  it('UTC clock labels are plain and never a country', () => {
    expect(utcClock('2026-10-10T13:00:00+00:00')).toBe('13:00 UTC');
    expect(utcClock(null)).toBeNull();
    expect(utcClock('not a time')).toBeNull();
  });
});

describe('listPackJobs and markPackPosted: the owner session, through the database', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.rpc.mockReset();
  });

  function table(rows: unknown[] | null, error: unknown = null) {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'gt', 'order', 'limit', 'in']) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve({ data: rows, error }).then(resolve, reject);
    return chain;
  }

  it('reads the owner\'s packs from minds_packs, with titles and product names looked up', async () => {
    mocks.from.mockImplementation((name: string) => {
      if (name === 'minds_packs') return table([row()]);
      if (name === 'posts') return table([{ id: POST_ID, title: TITLES[POST_ID] }]);
      if (name === 'products') return table([{ id: 'prod-1', name: NAMES['prod-1'] }]);
      return table([]);
    });
    const jobs = await listPackJobs();
    expect(mocks.from).toHaveBeenCalledWith('minds_packs');
    expect(jobs?.map((item) => item.channelLabel)).toEqual(['Instagram']);
    expect(jobs?.[0].productNames).toEqual(['Calm Skin Routine Guide']);
  });

  it('a failed read is null, so the screen can say so', async () => {
    mocks.from.mockImplementation(() => table(null, new Error('denied')));
    expect(await listPackJobs()).toBeNull();
  });

  it('markPackPosted calls the one database function with the pack id, and is true only on a real mark', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await markPackPosted('pack-1')).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('minds_mark_pack_posted', { p_pack_id: 'pack-1' });

    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await markPackPosted('pack-1')).toBe(false);

    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('not_owner') });
    expect(await markPackPosted('pack-1')).toBe(false);
  });
});
