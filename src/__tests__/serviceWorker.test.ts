/**
 * Regression tests for public/sw.js (the "Failed to convert value to 'Response'" /
 * 206 partial / Pexels CSP production bugs).
 *
 * The worker is a standalone script (no build step), so the tests execute the real
 * file in a mocked service-worker scope and assert on its observable behaviour.
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
}): Harness {
  const store = opts.store ?? new Map<string, Response>();
  const cacheNames = opts.cacheNames ?? ['lixxon-v2'];
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
  it('never hands respondWith() undefined — offline navigation with an empty cache still resolves to a real Response (synthetic 504)', async () => {
    const h = loadWorker({ fetchImpl: () => Promise.reject(new TypeError('offline')) });
    const responded = h.dispatchFetch(mockRequest('https://lixxonstudio.vercel.app/blog/x', { mode: 'navigate' }));
    expect(responded).toBeDefined();
    const res = await responded!;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(504);
  });

  it('a failing cache.put() never affects the response', async () => {
    const h = loadWorker({
      fetchImpl: () => Promise.resolve(new Response('asset-body', { status: 200 })),
      putImpl: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const res = await h.dispatchFetch(mockRequest('https://lixxonstudio.vercel.app/assets/index-abc.js'))!;
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
    const res = await h.dispatchFetch(mockRequest('https://lixxonstudio.vercel.app/assets/index-abc.js'))!;
    expect(res.status).toBe(200);
    expect(h.putMock).not.toHaveBeenCalled();
  });

  it('does not cache 206 partial responses (Cache.put would throw on them)', async () => {
    const h = loadWorker({
      fetchImpl: () => Promise.resolve(new Response('partial', { status: 206 })),
    });
    const res = await h.dispatchFetch(
      mockRequest('https://example.supabase.co/rest/v1/posts?select=*')
    )!;
    expect(res.status).toBe(206);
    expect(h.putMock).not.toHaveBeenCalled();
  });

  it('serves the cached shell/offline page for offline navigations', async () => {
    const store = new Map<string, Response>([['/', new Response('shell')]]);
    const h = loadWorker({ fetchImpl: () => Promise.reject(new TypeError('offline')), store });
    const res = await h.dispatchFetch(mockRequest('https://lixxonstudio.vercel.app/shop', { mode: 'navigate' }))!;
    expect(await res.text()).toBe('shell');

    // nothing cached but the offline page → that one
    const store2 = new Map<string, Response>([['/offline.html', new Response('offline-page')]]);
    const h2 = loadWorker({ fetchImpl: () => Promise.reject(new TypeError('offline')), store: store2 });
    const res2 = await h2.dispatchFetch(mockRequest('https://lixxonstudio.vercel.app/', { mode: 'navigate' }))!;
    expect(await res2.text()).toBe('offline-page');
  });

  it('never intercepts non-GET requests', () => {
    const h = loadWorker({});
    const responded = h.dispatchFetch(
      mockRequest('https://lixxonstudio.vercel.app/rest/v1/anything', { method: 'POST' })
    );
    expect(responded).toBeUndefined();
  });

  it('purges stale caches on activate and keeps only lixxon-v2 (cache scope)', async () => {
    const cacheNames = ['lixxon-v1', 'lixxon-v2', 'lixxon-v0-old'];
    const h = loadWorker({ cacheNames });
    await h.runExtendable('activate');
    expect(cacheNames).toEqual(['lixxon-v2']);
    expect(h.claim).toHaveBeenCalled();
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
});
