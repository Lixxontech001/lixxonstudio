import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, fetchWithTimeout, TimeoutError } from '../lib/fetchWithTimeout';

beforeEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetch timeouts', () => {
  it('rejects with TimeoutError after the configured timeout even if fetch never resolves', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = fetchWithTimeout('/slow', undefined, 250).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(249);
    expect(await Promise.race([result, Promise.resolve('pending')])).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    const error = await result;
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).timeoutMs).toBe(250);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries one transient network failure after 800 ms and returns the response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchWithRetry('/data', undefined, 1_000);
    await vi.advanceTimersByTimeAsync(799);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    const response = await request;
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a timed-out request once, then returns a successful response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValueOnce(new Response('recovered', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchWithRetry('/slow-then-ok', undefined, 100);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(799);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    const response = await request;
    expect(await response.text()).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
