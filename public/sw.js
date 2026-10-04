/* Lixxon Studio service worker — offline shell, hashed build assets, and cached Supabase reads.
   No build step; versions are bumped by changing CACHE (bump on EVERY change to this file).

   Rules (load-bearing — see src/__tests__/serviceWorker.test.ts):
   - respondWith() must NEVER receive undefined. Every intercepted path resolves to a real
     Response: work → cache → synthetic 504.
   - Intercept ONLY: navigations (mode === 'navigate'), same-origin /assets/*, and Supabase
     /rest/v1/* reads. Everything else returns early — especially ANY other cross-origin
     request (Pexels images, Google Fonts, analytics). Touching those is what previously
     broke every remote image via the document CSP.
   - cache.put() is best-effort and only for res.ok, non-206, non-no-store/no-cache,
     vary !== '*' responses; it is wrapped in try/catch so caching can never affect the
     response. Partial (206) responses are rejected up front: Cache.put() throws on them.
*/
const CACHE = 'lixxon-v2';
const SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
const API_HOST = /\.supabase\.co$/;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

/** Synthetic fallback so respondWith() always receives a real Response. */
const synthetic = (status, message) =>
  new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** May this response be stored? (res.ok allows 206 — reject it explicitly.) */
const cacheable = (res) => {
  if (!res || !res.ok || res.status === 206 || res.type === 'opaque') return false;
  const cc = (res.headers.get('cache-control') || '').toLowerCase();
  if (cc.split(',').some((d) => d.trim() === 'no-store' || d.trim() === 'no-cache')) return false;
  const vary = res.headers.get('vary');
  if (vary && vary.split(',').some((v) => v.trim() === '*')) return false;
  return true;
};

/** Best-effort cache write; can never fail or alter the response. */
const putSafe = async (key, res) => {
  try {
    if (!cacheable(res)) return;
    const c = await caches.open(CACHE);
    await c.put(key, res.clone());
  } catch {
    /* caching is an optimisation, never a requirement */
  }
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // never intercept non-GET

  const url = new URL(req.url);
  const isNavigation = req.mode === 'navigate';
  const isAsset = url.origin === self.location.origin && url.pathname.startsWith('/assets/');
  const isRestRead =
    API_HOST.test(url.hostname) &&
    url.pathname.startsWith('/rest/v1/') &&
    !url.pathname.includes('/rpc/');

  // Everything else — including every other cross-origin request — is left alone.
  if (!isNavigation && !isAsset && !isRestRead) return;

  if (isNavigation) {
    // Network first → cached shell → offline page → synthetic 504.
    e.respondWith(
      fetch(req)
        .then(async (res) => {
          await putSafe('/', res);
          return res;
        })
        .catch(async () => {
          const hit = (await caches.match('/')) || (await caches.match('/offline.html'));
          return hit || synthetic(504, 'You are offline and this page has not been cached yet.');
        })
    );
    return;
  }

  if (isAsset) {
    // Hashed build assets: cache first (immutable), network fallback, synthetic 504.
    e.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          await putSafe(req, res);
          return res;
        } catch {
          return synthetic(504, 'This build asset is unavailable offline.');
        }
      })()
    );
    return;
  }

  // Supabase REST reads: network first with cached fallback so visited articles open offline.
  e.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        await putSafe(req, res);
        return res;
      } catch {
        const hit = await caches.match(req);
        return hit || synthetic(504, 'This data is not cached yet and you are offline.');
      }
    })()
  );
});
