// @vitest-environment jsdom
//
// Batch 1 guarantees, kept after Batch 2 replaced the search engine:
// skeletons while a query is in flight, a visible retryable error when it fails,
// a way forward when nothing matches — and never a blank screen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import SearchPage from '../components/SearchPage';
import { NavigationProvider } from '../context/NavigationContext';
import { ToastProvider } from '../context/ToastContext';

type RpcResponse = { data: unknown[] | null; error: Error | null };
type Plan = { result?: RpcResponse; pending?: boolean };

const searchMock = vi.hoisted(() => {
  const state: {
    plans: Plan[];
    calls: number;
    resolvePending: ((value: RpcResponse) => void) | null;
    table: () => unknown;
  } = { plans: [], calls: 0, resolvePending: null, table: () => undefined };

  state.table = () => {
    const chain: Record<string, unknown> = {};
    const method = () => chain;
    chain.select = method;
    chain.eq = method;
    chain.or = method;
    chain.order = method;
    chain.limit = method;
    chain.range = method;
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (onFulfilled: (value: { data: unknown[]; error: null }) => unknown, onRejected: unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected as never);
    return chain;
  };

  return state;
});

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    // Only search_everything is scripted; the rails resolve empty.
    rpc: (name: string) => {
      if (name !== 'search_everything') return Promise.resolve({ data: [], error: null });
      const plan = searchMock.plans[searchMock.calls++];
      const result = plan?.result ?? { data: [], error: null };
      return plan?.pending
        ? new Promise<RpcResponse>((resolve) => {
            searchMock.resolvePending = resolve;
          })
        : Promise.resolve(result);
    },
    from: () => searchMock.table(),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
    },
  },
}));

vi.mock('../hooks/usePlatform', () => ({
  useSearchHistory: () => ({ history: [], logSearch: vi.fn(), clearHistory: vi.fn() }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;

function mount(query: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <HelmetProvider>
        <ToastProvider>
          <NavigationProvider>
            <SearchPage query={query} page={1} />
          </NavigationProvider>
        </ToastProvider>
      </HelmetProvider>,
    );
  });
}

async function flush(times = 3) {
  await act(async () => {
    for (let i = 0; i < times; i++) await Promise.resolve();
  });
}

/** The search hook debounces before hitting the RPC. */
async function settle(ms = 400) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/search');
  searchMock.plans = [];
  searchMock.calls = 0;
  searchMock.resolvePending = null;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
});

describe('search loading and recovery', () => {
  it('shows the empty-search guidance without making a query', async () => {
    mount('');
    await settle();

    expect(host.textContent).toContain('Search the magazine');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(searchMock.calls).toBe(0);
  });

  it('renders the search skeleton while results are pending', async () => {
    searchMock.plans = [{ pending: true }];
    mount('quiet gardens');
    await settle();

    expect(searchMock.calls).toBe(1);
    expect(host.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders results when the RPC resolves', async () => {
    searchMock.plans = [
      {
        result: {
          data: [
            {
              result_kind: 'article',
              id: 'post-1',
              slug: 'quiet-gardens',
              title: 'Quiet gardens for busy minds',
              excerpt: 'Slow down.',
              image_url: null,
              category_name: 'Wellness',
              category_slug: 'wellness',
              author_name: 'Elena',
              author_slug: 'elena',
              published_at: '2026-09-01T00:00:00Z',
              reading_time_minutes: 5,
              price_label: null,
              currency: null,
              tags: ['wellness'],
              score: 9.1,
              total_count: 1,
            },
          ],
          error: null,
        },
      },
    ];
    mount('quiet gardens');
    await settle();

    expect(host.textContent).toContain('Quiet gardens for busy minds');
    expect(host.textContent).toContain('1 result');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows query errors and retries into the empty-results state', async () => {
    searchMock.plans = [
      { result: { data: null, error: new Error('temporary search failure') } },
      { result: { data: [], error: null } },
    ];
    mount('quiet gardens');
    await settle();

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('We could not run that search right now.');

    const retry = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Retry');
    expect(retry).toBeTruthy();
    act(() => {
      retry!.click();
    });
    await settle();

    expect(searchMock.calls).toBeGreaterThanOrEqual(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('Nothing matched');
  });
});
