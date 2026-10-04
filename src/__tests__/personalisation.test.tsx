// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import {
  feedHeading,
  insightsSummary,
  progressLabel,
  streakNudge,
  topCategoryName,
} from '../lib/personalisation';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { rpc },
}));
vi.mock('../hooks/useFeatures', () => ({
  getFingerprint: () => 'personalisation_test_fingerprint',
}));
vi.mock('../context/NavigationContext', async () => {
  const React = await import('react');
  return {
    Link: ({ to, children }: { to: { name: string; slug?: string }; children: ReactNode }) =>
      React.createElement('a', { href: `/${to.name}/${to.slug || ''}` }, children),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(node: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root?.render(node); });
  return host;
}
async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
function unmount() {
  if (root) act(() => root?.unmount());
  root = null;
  host = null;
}

beforeEach(() => {
  document.body.innerHTML = '';
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
});
afterEach(() => {
  unmount();
  vi.useRealTimers();
});

describe('personalisation helpers', () => {
  it('labels progress and recently opened stories', () => {
    expect(progressLabel(0)).toBe('Just started');
    expect(progressLabel(42)).toBe('42% through');
    expect(progressLabel(0, 'recent')).toBe('Just opened');
    expect(progressLabel(100)).toBe('Finished');
  });

  it('summarises reading, streak nudges, headings and favourite topics', () => {
    expect(insightsSummary({ articles_read: 2, minutes_read: 12, days_active: 3 })).toBe('2 articles · 12 minutes · 3 active days');
    expect(insightsSummary({ articles_read: 0, minutes_read: 0, days_active: 0 })).toContain('starts with one good story');
    expect(streakNudge(1, 1)).toContain('Come back tomorrow');
    expect(streakNudge(8, 8)).toContain('8 days');
    expect(feedHeading(true)).toBe('For You');
    expect(feedHeading(false)).toBe('Readers Are Loving');
    expect(topCategoryName([{ name: 'Skincare', slug: 'skincare', count: 3 }])).toBe('Skincare');
    expect(topCategoryName([])).toBeNull();
  });
});

describe('ContinueReadingRail', () => {
  it('renders populated progress, category, reading time and accessible progress values', async () => {
    rpc.mockResolvedValueOnce({ data: [{
      post_id: 'post-1', slug: 'slow-mornings', title: 'Slow Mornings', cover_image: '/cover.jpg',
      category_name: 'Wellness', reading_time_minutes: 5, progress_percent: 42,
      updated_at: '2026-10-04T10:00:00Z', source: 'progress',
    }], error: null });
    const Component = (await import('../components/personal/ContinueReadingRail')).default;
    const el = mount(<Component inline />);
    await settle();
    expect(el.textContent).toContain('Pick Up Where You Left Off');
    expect(el.textContent).toContain('42% through');
    expect(el.textContent).toContain('5 min read');
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/cover.jpg');
  });

  it('renders no section when empty unless inline, where it explains the feature', async () => {
    const Component = (await import('../components/personal/ContinueReadingRail')).default;
    const empty = mount(<Component />);
    await settle();
    expect(empty.querySelector('section')).toBeNull();
    unmount();
    const inline = mount(<Component inline />);
    await settle();
    expect(inline.textContent).toContain('Your next article will appear here');
  });

  it('shows and retries an error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    const Component = (await import('../components/personal/ContinueReadingRail')).default;
    const el = mount(<Component />);
    await settle();
    expect(el.textContent).toContain('unavailable');
    rpc.mockResolvedValueOnce({ data: [], error: null });
    act(() => { el.querySelector('button')?.click(); });
    await settle();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('ForYouRail', () => {
  it('renders recommendations with personal reason, excerpt, category and minutes', async () => {
    rpc.mockResolvedValueOnce({ data: [{
      post_id: 'post-2', slug: 'skin-barrier', title: 'A Kinder Skin Routine', excerpt: 'A thoughtful guide.',
      cover_image: '/skin.jpg', category_name: 'Skincare', category_slug: 'skincare', author_name: 'Amara',
      published_at: '2026-10-04T00:00:00Z', reading_time_minutes: 6, reason: 'More on skincare', score: 4.5,
    }], error: null });
    const Component = (await import('../components/personal/ForYouRail')).default;
    const el = mount(<Component />);
    await settle();
    expect(el.textContent).toContain('For You');
    expect(el.textContent).toContain('More on skincare');
    expect(el.textContent).toContain('A thoughtful guide.');
    expect(el.textContent).toContain('6 min read');
  });

  it('renders nothing for an empty successful feed', async () => {
    const Component = (await import('../components/personal/ForYouRail')).default;
    const el = mount(<Component />);
    await settle();
    expect(el.querySelector('section')).toBeNull();
  });

  it('renders a retry action for errors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    const Component = (await import('../components/personal/ForYouRail')).default;
    const el = mount(<Component />);
    await settle();
    expect(el.textContent).toContain('couldn’t load');
    rpc.mockResolvedValueOnce({ data: [], error: null });
    act(() => { el.querySelector('button')?.click(); });
    await settle();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('ReaderInsightsCard', () => {
  it('shows the streak, metrics, favourite topics and best run', async () => {
    rpc.mockResolvedValueOnce({ data: [{
      articles_read: 7, days_active: 5, current_streak: 3, longest_streak: 9, minutes_read: 42,
      top_categories: [{ name: 'Wellness', slug: 'wellness', count: 4 }],
      first_read_day: '2026-10-01', last_read_day: '2026-10-04',
    }], error: null });
    const Component = (await import('../components/personal/ReaderInsightsCard')).default;
    const el = mount(<Component />);
    await settle();
    expect(el.textContent).toContain('Your reading rhythm');
    expect(el.textContent).toContain('7 articles');
    expect(el.textContent).toContain('42 minutes');
    expect(el.textContent).toContain('Wellness');
    expect(el.textContent).toContain('Best run: 9 days');
  });

  it('invites new readers and offers retry when insights fail', async () => {
    rpc.mockResolvedValueOnce({ data: [{
      articles_read: 0, days_active: 0, current_streak: 0, longest_streak: 0, minutes_read: 0,
      top_categories: [], first_read_day: '2026-10-04', last_read_day: '2026-10-04',
    }], error: null });
    const Component = (await import('../components/personal/ReaderInsightsCard')).default;
    const el = mount(<Component />);
    await settle();
    expect(el.textContent).toContain('start your private reading journal');
    unmount();

    rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    const failed = mount(<Component />);
    await settle();
    expect(failed.textContent).toContain('unavailable');
    rpc.mockResolvedValueOnce({ data: [], error: null });
    act(() => { failed.querySelector('button')?.click(); });
    await settle();
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe('additional personalisation behaviour', () => {
  it('normalises non-finite progress and ignores malformed topic payloads', () => {
    expect(progressLabel(Number.NaN)).toBe('Just started');
    expect(progressLabel(900)).toBe('Finished');
    expect(topCategoryName({ name: 'not an array' })).toBeNull();
  });

  it('labels recent views as just opened', async () => {
    rpc.mockResolvedValueOnce({ data: [{
      post_id: 'post-recent', slug: 'recent', title: 'A recent read', cover_image: null,
      category_name: null, reading_time_minutes: 4, progress_percent: 0,
      updated_at: '2026-10-04T10:00:00Z', source: 'recent',
    }], error: null });
    const Component = (await import('../components/personal/ContinueReadingRail')).default;
    const el = mount(<Component inline />);
    await settle();
    expect(el.textContent).toContain('Just opened');
  });

  it('uses the trending heading and reason when recommendations are cold-started', async () => {
    rpc.mockResolvedValueOnce({ data: [{
      post_id: 'post-trending', slug: 'popular', title: 'Readers loved this', excerpt: 'A popular story.',
      cover_image: null, category_name: 'Style', category_slug: 'style', author_name: null,
      published_at: '2026-10-04T00:00:00Z', reading_time_minutes: 4,
      reason: 'Popular with readers this week', score: 3,
    }], error: null });
    const Component = (await import('../components/personal/ForYouRail')).default;
    const el = mount(<Component />);
    await settle();
    expect(el.textContent).toContain('Readers Are Loving');
    expect(el.textContent).toContain('Popular with readers this week');
  });

  it('passes a clamped limit to the continue-reading RPC', async () => {
    const { useContinueReading } = await import('../hooks/usePersonalisation');
    function Probe() {
      useContinueReading(7);
      return null;
    }
    mount(<Probe />);
    await settle();
    expect(rpc).toHaveBeenCalledWith('continue_reading', expect.objectContaining({ p_limit: 7, p_fingerprint: 'personalisation_test_fingerprint' }));
  });

  it('saves progress best-effort without emitting the route error event', async () => {
    const { saveReadingProgress } = await import('../hooks/usePersonalisation');
    const { REQUEST_ERROR_EVENT } = await import('../lib/requestStatus');
    const requestError = vi.fn();
    window.addEventListener(REQUEST_ERROR_EVENT, requestError);
    rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    await expect(saveReadingProgress('post-1', 140)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('record_reading_progress', expect.objectContaining({ p_post_id: 'post-1', p_progress: 100 }));
    expect(requestError).not.toHaveBeenCalled();
    window.removeEventListener(REQUEST_ERROR_EVENT, requestError);
  });

  it('records a 100 percent finish immediately after an intermediate milestone', async () => {
    vi.useFakeTimers();
    const { useReadingProgressTracker } = await import('../hooks/usePersonalisation');
    function Tracker({ percent }: { percent: number }) {
      useReadingProgressTracker('article-jump', percent);
      return null;
    }
    mount(<Tracker percent={25} />);
    expect(rpc).toHaveBeenCalledTimes(1);
    act(() => { root?.render(<Tracker percent={100} />); });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_progress: 100 });
  });
});

describe('reading progress tracker', () => {
  it('ignores early progress, records milestones, throttles, and always records finish', async () => {
    vi.useFakeTimers();
    const { useReadingProgressTracker } = await import('../hooks/usePersonalisation');
    function Tracker({ postId, percent }: { postId: string; percent: number }) {
      useReadingProgressTracker(postId, percent);
      return null;
    }
    mount(<Tracker postId="article-a" percent={9} />);
    expect(rpc).not.toHaveBeenCalled();
    act(() => { root?.render(<Tracker postId="article-a" percent={25} />); });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_post_id: 'article-a', p_progress: 25 });

    act(() => { root?.render(<Tracker postId="article-a" percent={50} />); });
    expect(rpc).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_progress: 50 });

    act(() => { root?.render(<Tracker postId="article-a" percent={100} />); });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_progress: 100 });
    await settle();
  });

  it('tracks milestones independently for each article', async () => {
    const { useReadingProgressTracker } = await import('../hooks/usePersonalisation');
    function Tracker({ postId, percent }: { postId: string; percent: number }) {
      useReadingProgressTracker(postId, percent);
      return null;
    }
    const el = mount(<Tracker postId="article-a" percent={25} />);
    act(() => { root?.render(<Tracker postId="article-b" percent={25} />); });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map((call) => call[1]?.p_post_id)).toEqual(['article-a', 'article-b']);
    await settle();
    void el;
  });
});
