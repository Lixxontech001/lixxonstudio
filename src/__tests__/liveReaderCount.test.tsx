// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import LiveReaderCount from '../components/LiveReaderCount';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { rpc, from },
  rows: (data: unknown) => (data || []) as unknown[],
}));
vi.mock('../lib/api', () => ({
  submitForm: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root?.render(<LiveReaderCount postId="post-uuid" />); });
  return host;
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('fp', 'fp_live_reader_test_token');
  rpc.mockReset();
  from.mockReset();
  from.mockImplementation(() => { throw new Error('reader presence must use the aggregate RPC'); });
});

describe('privacy-safe live reader count', () => {
  it('renders only an aggregate count when at least two readers are present', async () => {
    rpc.mockResolvedValueOnce({ data: 3, error: null });
    const el = mount();
    await settle();

    expect(el.textContent).toContain('3 people reading now');
    expect(el.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('3 readers are viewing this article now');
    expect(rpc).toHaveBeenCalledWith('heartbeat_article_reader', {
      p_post_id: 'post-uuid',
      p_fingerprint: 'fp_live_reader_test_token',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('hides lone readers and clears visible counts after a heartbeat failure', async () => {
    vi.useFakeTimers();
    rpc
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: 3, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('offline') });
    const el = mount();
    await settle();
    expect(el.querySelector('[role="status"]')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(el.textContent).toContain('3 people reading now');

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(el.querySelector('[role="status"]')).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
