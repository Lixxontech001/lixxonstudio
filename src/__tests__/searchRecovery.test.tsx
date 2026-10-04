// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import SearchPage from '../components/SearchPage';
import { NavigationProvider } from '../context/NavigationContext';

const searchMock = vi.hoisted(() => {
  type QueryResponse = { data: unknown[] | null; count: number | null; error: Error | null };
  type ResponsePlan = { result?: QueryResponse; pending?: boolean };
  const state: {
    responses: ResponsePlan[];
    calls: number;
    resolvePending: ((value: QueryResponse) => void) | null;
    createQuery: () => unknown;
  } = { responses: [], calls: 0, resolvePending: null, createQuery: () => undefined };

  state.createQuery = () => {
    const chain: Record<string, unknown> = {};
    const chainMethod = () => chain;
    chain.select = chainMethod;
    chain.eq = chainMethod;
    chain.or = chainMethod;
    chain.order = chainMethod;
    chain.range = chainMethod;
    chain.then = (
      onFulfilled: (value: QueryResponse) => unknown,
      onRejected: (error: unknown) => unknown,
    ) => {
      const plan = state.responses[state.calls++];
      const result = plan?.result || { data: [], count: 0, error: null };
      const response = plan?.pending
        ? new Promise<QueryResponse>((resolve) => { state.resolvePending = resolve; })
        : Promise.resolve(result);
      return response.then(onFulfilled, onRejected);
    };
    return chain;
  };

  return state;
});

vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: () => searchMock.createQuery() },
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
        <NavigationProvider>
          <SearchPage query={query} page={1} />
        </NavigationProvider>
      </HelmetProvider>,
    );
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
  searchMock.responses = [];
  searchMock.calls = 0;
  searchMock.resolvePending = null;
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
});

describe('search loading and recovery', () => {
  it('shows the empty-search guidance without making a query', async () => {
    mount('');
    await flush();

    expect(host.textContent).toContain('Type a search query above to find articles');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(searchMock.calls).toBe(0);
  });

  it('renders the search skeleton while results are pending', async () => {
    searchMock.responses = [{ pending: true }];
    mount('quiet gardens');
    await flush();

    expect(host.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows query errors and retries into the empty-results state', async () => {
    searchMock.responses = [
      { result: { data: null, count: 0, error: new Error('temporary search failure') } },
      { result: { data: [], count: 0, error: null } },
    ];
    mount('quiet gardens');
    await flush();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('We couldn’t load the latest stories right now.');
    const retry = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Retry');
    expect(retry).toBeTruthy();
    act(() => { retry!.click(); });
    await flush();

    expect(searchMock.calls).toBe(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('No articles found');
  });
});
