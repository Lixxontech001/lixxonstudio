// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { usePaginatedPosts } from '../hooks/useSupabase';
import MagazineFeed from '../components/MagazineFeed';
import QueryStatusNotice from '../components/QueryStatusNotice';
import { NavigationProvider } from '../context/NavigationContext';
import type { PostWithRelations } from '../lib/types';

const supabaseMock = vi.hoisted(() => {
  type Response = { delay: number; result?: unknown; reject?: Error };
  const state: {
    responses: Response[];
    calls: number;
    createQuery: () => unknown;
  } = { responses: [], calls: 0, createQuery: () => undefined };

  state.createQuery = () => {
    const chain: Record<string, unknown> = {};
    const chainMethod = () => chain;
    chain.select = chainMethod;
    chain.eq = chainMethod;
    chain.order = chainMethod;
    chain.range = chainMethod;
    chain.then = (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (error: unknown) => unknown,
    ) => {
      const response = state.responses[state.calls++];
      return new Promise((resolve, reject) => {
        window.setTimeout(() => {
          if (response?.reject) {
            if (onRejected) resolve(onRejected(response.reject));
            else reject(response.reject);
            return;
          }
          resolve(onFulfilled(response?.result || { data: [], count: 0, error: null }));
        }, response?.delay || 0);
      });
    };
    return chain;
  };

  return state;
});

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: () => supabaseMock.createQuery() },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const post = {
  id: 'p-slow',
  title: 'A Story That Arrives Slowly',
  slug: 'a-story-that-arrives-slowly',
  excerpt: 'Readable even after a long wait.',
  content: null,
  cover_image: null,
  cover_image_alt: null,
  category_id: null,
  author_id: null,
  published_at: '2026-10-01T00:00:00Z',
  scheduled_at: null,
  reading_time_minutes: 4,
  featured: false,
  editors_pick: false,
  tags: [],
  status: 'published',
  seo_title: null,
  seo_description: null,
  canonical_url: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  category: null,
  author: null,
} as PostWithRelations;

let root: Root | null = null;
let host: HTMLDivElement;

function FeedHarness() {
  const result = usePaginatedPosts(null, 1);
  return (
    <>
      <QueryStatusNotice
        loading={result.loading}
        hasData={result.posts.length > 0}
        error={result.error}
        onRetry={result.retry}
      />
      {!result.loading && !result.error && (
        <NavigationProvider>
          <MagazineFeed
            posts={result.posts}
            categories={[]}
            activeCategory="all"
            onCategoryChange={() => undefined}
          />
        </NavigationProvider>
      )}
    </>
  );
}

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(<FeedHarness />); });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  supabaseMock.calls = 0;
  supabaseMock.responses = [];
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('homepage query status', () => {
  it('renders readable card text after a nine-second response', async () => {
    supabaseMock.responses = [{
      delay: 9000,
      result: { data: [post], count: 1, error: null },
    }];
    mount();
    await flush();

    act(() => { vi.advanceTimersByTime(6000); });
    await flush();
    expect(host.textContent).toContain('Still loading — this is taking longer than usual');

    act(() => { vi.advanceTimersByTime(3000); });
    await flush();
    expect(host.textContent).toContain('A Story That Arrives Slowly');
  });

  it('shows a friendly error and Retry when the query rejects', async () => {
    supabaseMock.responses = [{ delay: 0, reject: new Error('network unavailable') }];
    mount();
    await flush();
    act(() => { vi.advanceTimersByTime(0); });
    await flush();

    expect(host.textContent).toContain('We couldn’t load the latest stories right now.');
    expect(host.textContent).toContain('Retry');
  });

  it('refetches and renders content after Retry is clicked', async () => {
    supabaseMock.responses = [
      { delay: 0, reject: new Error('temporary failure') },
      { delay: 0, result: { data: [post], count: 1, error: null } },
    ];
    mount();
    await flush();
    act(() => { vi.advanceTimersByTime(0); });
    await flush();

    const retry = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Retry');
    expect(retry).toBeTruthy();
    act(() => { retry!.click(); });
    await flush();
    act(() => { vi.advanceTimersByTime(0); });
    await flush();
    await flush();

    expect(supabaseMock.calls).toBe(2);
    expect(host.textContent).toContain('A Story That Arrives Slowly');
  });
});
