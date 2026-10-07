/**
 * Regression tests for public/sw.js. The worker is a standalone script (no build step),
 * so the tests execute the real file in a mocked service-worker scope and assert on
 * its observable behaviour.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SW_SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

/** Minimal Request stand-in (jsdom cannot construct mode:'navigate' Requests). */
interface MockRequest {
  url: string;
  method: string;
  mode: string;
  destination: string;
  headers: Headers;
  clone: () => MockRequest;
}

function mockRequest(
  url: string,
  init: { method?: string; mode?: string; destination?: string } = {}
): MockRequest {
  const r: MockRequest = {
    url,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    destination: init.destination ?? '',
    headers: new Headers(),
    clone: () => r,
  };
  return r;
}

type FetchImpl = (req: MockRequest) => Promise<Response>;
type PutImpl = (key: string, res: Response) => Promise<void> | void;

interface Harness {
  dispatchFetch(req: MockRequest): Promise<Response> | undefined;
  dispatchExtendable(type: string, event: Record<string, unknown>): Promise<unknown>;
  runExtendable(type: 'install' | 'activate'): Promise<void>;
  dispatchMessage(data: unknown): void;
  fetchMock: ReturnType<typeof vi.fn>;
  putMock: ReturnType<typeof vi.fn>;
  skipWaiting: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  cacheNames: string[];
  store: Map<string, Response>;
}

function keyOf(key: MockRequest | string): string {
  return typeof key === 'string' ? key : key.url;
}

function loadWorker(opts: {
  fetchImpl?: FetchImpl;
  putImpl?: PutImpl;
  store?: Map<string, Response>;
  cacheNames?: string[];
  selfExtra?: Record<string, unknown>;
}): Harness {
  const store = opts.store ?? new Map<string, Response>();
  const cacheNames = opts.cacheNames ?? ['lixxon-v3'];
  const listeners = new Map<string, Array<(e: unknown) => void>>();

  const putMock = vi.fn(async (key: MockRequest | string, res: Response) => {
    if (opts.putImpl) {
      await opts.putImpl(keyOf(key), res);
      return;
    }
    store.set(keyOf(key), res);
  });

  const cache = {
    add: vi.fn(async (u: string) => {
      store.set(u, new Response('cached'));
    }),
    match: vi.fn(async (key: MockRequest | string) => store.get(keyOf(key))),
    put: putMock,
  };

  const cachesMock = {
    open: vi.fn(async () => cache),
    match: async (key: MockRequest | string) => store.get(keyOf(key)),
    keys: async () => [...cacheNames],
    delete: async (name: string) => {
      const i = cacheNames.indexOf(name);
      if (i >= 0) cacheNames.splice(i, 1);
      return i >= 0;
    },
  };

  const fetchMock = vi.fn((req: MockRequest) =>
    opts.fetchImpl ? opts.fetchImpl(req) : Promise.resolve(new Response('ok'))
  );

  const skipWaiting = vi.fn();
  const claim = vi.fn();
  const self = {
    location: { origin: 'https://lixxonstudio.vercel.app', href: 'https://lixxonstudio.vercel.app/' },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    skipWaiting,
    clients: { claim },
    ...(opts.selfExtra ?? {}),
  };

  // Execute the real worker source in a mocked service-worker scope.
  new Function('self', 'caches', 'fetch', SW_SOURCE)(self, cachesMock, fetchMock);

  return {
    dispatchFetch(req: MockRequest) {
      let responded: Promise<Response> | undefined;
      const event = {
        request: req,
        respondWith(p: Promise<Response> | Response) {
          responded = Promise.resolve(p);
        },
      };
      for (const fn of listeners.get('fetch') ?? []) fn(event);
      return responded;
    },
    async dispatchExtendable(type: string, event: Record<string, unknown>) {
      let waited: Promise<unknown> | undefined;
      const withWait = {
        ...event,
        waitUntil(p: Promise<unknown>) {
          waited = p;
        },
      };
      for (const fn of listeners.get(type) ?? []) fn(withWait);
      await waited;
      return waited;
    },
    async runExtendable(type: 'install' | 'activate') {
      let waited: Promise<unknown> | undefined;
      const event = {
        waitUntil(p: Promise<unknown>) {
          waited = p;
        },
      };
      for (const fn of listeners.get(type) ?? []) fn(event);
      await waited;
    },
    dispatchMessage(data: unknown) {
      for (const fn of listeners.get('message') ?? []) fn({ data });
    },
    fetchMock,
    putMock,
    skipWaiting,
    claim,
    cacheNames,
    store,
  };
}

describe('public/sw.js', () => {
  it('uses a new cache version and purges every previous cache on activate', async () => {
    // The current cache is created by install; every older cache must be purged.
    const cacheNames = ['lixxon-v1', 'lixxon-v2', 'lixxon-v0-old', 'lixxon-v4', 'lixxon-v5'];
    const h = loadWorker({ cacheNames });
    await h.runExtendable('activate');
    expect(cacheNames).toEqual(['lixxon-v5']);
    expect(h.claim).toHaveBeenCalled();
  });

  it('never intercepts navigations; documents are always handled by the browser', () => {
    const h = loadWorker({});
    const responded = h.dispatchFetch(
      mockRequest('https://lixxonstudio.vercel.app/blog/article', { mode: 'navigate' })
    );
    expect(responded).toBeUndefined();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('never intercepts or caches Supabase REST requests', () => {
    const h = loadWorker({});
    const responded = h.dispatchFetch(
      mockRequest('https://example.supabase.co/rest/v1/posts?select=*')
    );
    expect(responded).toBeUndefined();
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.putMock).not.toHaveBeenCalled();
    expect(h.store.size).toBe(0);
  });

  it('never writes the document root or an HTML document during fetch handling', async () => {
    const h = loadWorker({});
    h.dispatchFetch(mockRequest('https://lixxonstudio.vercel.app/', { mode: 'navigate' }));
    h.dispatchFetch(
      mockRequest('https://lixxonstudio.vercel.app/offline.html', { mode: 'navigate' })
    );
    await h.dispatchFetch(mockRequest('https://lixxonstudio.vercel.app/assets/index-abc.js'));

    const writtenKeys = [...h.store.keys()];
    expect(writtenKeys).not.toContain('/');
    expect(writtenKeys.some((key) => /\.html(?:$|[?#])/.test(key))).toBe(false);
    expect(h.putMock.mock.calls.map(([key]) => keyOf(key))).toEqual([
      'https://lixxonstudio.vercel.app/assets/index-abc.js',
    ]);
  });

  it('serves a cache-first asset when one is already available', async () => {
    const url = 'https://lixxonstudio.vercel.app/assets/index-abc.js';
    const h = loadWorker({ store: new Map([[url, new Response('cached-asset')]]) });
    const res = await h.dispatchFetch(mockRequest(url))!;
    expect(await res.text()).toBe('cached-asset');
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('uses the network for an asset and treats a failing cache.put() as best-effort', async () => {
    const h = loadWorker({
      fetchImpl: () => Promise.resolve(new Response('asset-body', { status: 200 })),
      putImpl: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const res = await h.dispatchFetch(
      mockRequest('https://lixxonstudio.vercel.app/assets/index-abc.js')
    )!;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('asset-body');
    expect(h.putMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache no-store responses', async () => {
    const h = loadWorker({
      fetchImpl: () =>
        Promise.resolve(new Response('private', { status: 200, headers: { 'Cache-Control': 'no-store' } })),
    });
    const res = await h.dispatchFetch(
      mockRequest('https://lixxonstudio.vercel.app/assets/index-abc.js')
    )!;
    expect(res.status).toBe(200);
    expect(h.putMock).not.toHaveBeenCalled();
  });

  it('does not cache 206 partial responses', async () => {
    const h = loadWorker({
      fetchImpl: () => Promise.resolve(new Response('partial', { status: 206 })),
    });
    const res = await h.dispatchFetch(
      mockRequest('https://lixxonstudio.vercel.app/assets/index-abc.js')
    )!;
    expect(res.status).toBe(206);
    expect(h.putMock).not.toHaveBeenCalled();
  });

  it('returns a real synthetic 504 when an uncached asset is offline', async () => {
    const h = loadWorker({ fetchImpl: () => Promise.reject(new TypeError('offline')) });
    const responded = h.dispatchFetch(
      mockRequest('https://lixxonstudio.vercel.app/assets/index-abc.js')
    );
    expect(responded).toBeDefined();
    const res = await responded!;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(504);
  });

  it('never intercepts non-GET requests', () => {
    const h = loadWorker({});
    const responded = h.dispatchFetch(
      mockRequest('https://lixxonstudio.vercel.app/assets/index-abc.js', { method: 'POST' })
    );
    expect(responded).toBeUndefined();
  });

  it('never touches cross-origin requests (Pexels images, fonts, analytics)', () => {
    const h = loadWorker({});
    for (const url of [
      'https://images.pexels.com/photos/3373736/pexels-photo-3373736.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'https://fonts.googleapis.com/css2?family=Inter',
      'https://www.google-analytics.com/g/collect',
    ]) {
      expect(h.dispatchFetch(mockRequest(url, { mode: 'no-cors', destination: 'image' }))).toBeUndefined();
      expect(h.dispatchFetch(mockRequest(url))).toBeUndefined();
    }
  });
  describe('owner push handling', () => {
    const pushScope = () => {
      const showNotification = vi.fn(async () => undefined);
      const postMessage = vi.fn();
      const focus = vi.fn(async () => undefined);
      const navigate = vi.fn(async () => undefined);
      const openWindow = vi.fn(async () => undefined);
      const matchAll = vi.fn(async () => [{ focus, navigate }]);
      const h = loadWorker({
        selfExtra: {
          registration: { showNotification },
          clients: { claim: vi.fn(), matchAll, openWindow },
        },
      });
      return { h, showNotification, postMessage, focus, navigate, openWindow, matchAll };
    };

    it('shows a capped notification for the fixed test payload', async () => {
      const { h, showNotification } = pushScope();
      await h.dispatchExtendable('push', {
        data: { json: () => ({ title: 'Lixxon Studio', body: 'Test notification.', tag: 'lixxon-push-test', data: { url: '/admin/settings' } }) },
      });
      expect(showNotification).toHaveBeenCalledTimes(1);
      const [title, options] = showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(title).toBe('Lixxon Studio');
      expect(options).toMatchObject({ body: 'Test notification.', tag: 'lixxon-push-test', data: { url: '/admin/settings' } });
    });

    it('treats the payload as untrusted: caps text and refuses off-site links', async () => {
      const { h, showNotification } = pushScope();
      await h.dispatchExtendable('push', {
        data: { json: () => ({ title: 'x'.repeat(500), body: 'y'.repeat(500), data: { url: 'https://evil.example/steal' } }) },
      });
      const [title, options] = showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(title.length).toBe(80);
      expect(String(options.body).length).toBe(180);
      expect(options.data).toEqual({ url: '/' });
    });

    it('falls back to a safe default when the payload is missing or invalid', async () => {
      const { h, showNotification } = pushScope();
      await h.dispatchExtendable('push', { data: { json: () => { throw new Error('bad json'); } } });
      const [title, options] = showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(title).toBe('Lixxon Studio');
      expect(options.data).toEqual({ url: '/' });
    });

    it('focuses an open window and navigates to the same-origin target on click', async () => {
      const { h, focus, navigate, openWindow } = pushScope();
      await h.dispatchExtendable('notificationclick', {
        notification: { close: vi.fn(), data: { url: '/admin/settings' } },
      });
      expect(focus).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/admin/settings');
      expect(openWindow).not.toHaveBeenCalled();
    });

    it('opens a window for an unsafe click target and never fetches anything', async () => {
      const { h, focus, openWindow, matchAll } = pushScope();
      matchAll.mockResolvedValue([]);
      await h.dispatchExtendable('notificationclick', {
        notification: { close: vi.fn(), data: { url: '//evil.example' } },
      });
      expect(openWindow).toHaveBeenCalledWith('/');
      expect(focus).not.toHaveBeenCalled();
      expect(h.fetchMock).not.toHaveBeenCalled();
    });

    it('relays a changed subscription to open pages without posting credentials', async () => {
      const { h, postMessage, matchAll } = pushScope();
      matchAll.mockResolvedValue([{ postMessage }]);
      await h.dispatchExtendable('pushsubscriptionchange', {});
      expect(postMessage).toHaveBeenCalledWith({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
      expect(h.fetchMock).not.toHaveBeenCalled();
    });
  });

});
