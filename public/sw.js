/* Lixxon Studio service worker — cache only Vite's content-hashed build assets.
   No build step; bump CACHE on every change to this file.

   Invariants (load-bearing — see src/__tests__/serviceWorker.test.ts):
   - Never cache HTML or intercept navigations; the browser always fetches documents directly.
   - Never touch Supabase or any cross-origin request.
   - Only same-origin /assets/* content-hashed assets are cached, cache-first, with a
     network fallback and a synthetic 504 when an asset cannot be fetched.
   - respondWith() is used only for an intercepted asset and always receives a real Response.
   - Cache writes are best-effort and can never fail or alter the network response.

   Web Push additions (owner opt-in only):
   - Push payloads are treated as untrusted input: every field is length-capped and
     the click target must be a same-origin path. Only the fixed owner test
     notification is ever sent, and it carries no article, customer or secret data.
   - pushsubscriptionchange never invents or posts credentials; it only asks an open
     page to re-register, so the server keeps seeing owner-confirmed devices.
*/
const CACHE = 'lixxon-v5';
const SHELL = ['/offline.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

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

/** Same-origin path only (never an absolute or protocol-relative URL). */
const safePath = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value.slice(0, 200);
};

const capText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

self.addEventListener('push', (e) => {
  let payload = {};
  try {
    payload = e.data ? e.data.json() : {};
  } catch {
    payload = {};
  }
  if (!payload || typeof payload !== 'object') payload = {};
  const link = payload.data && typeof payload.data === 'object' ? payload.data : {};
  e.waitUntil(
    self.registration.showNotification(capText(payload.title, 80) || 'Lixxon Studio', {
      body: capText(payload.body, 180),
      tag: capText(payload.tag, 64) || 'lixxon-push',
      data: { url: safePath(link.url) },
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = safePath(e.notification.data && e.notification.data.url);
  e.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (typeof client.focus === 'function') {
          await client.focus();
          if (typeof client.navigate === 'function') await client.navigate(target).catch(() => undefined);
          return;
        }
      }
      if (typeof self.clients.openWindow === 'function') await self.clients.openWindow(target);
    })()
  );
});

/** The endpoint may have rotated: ask an open page to re-register. No payload is sent. */
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (typeof client.postMessage === 'function') client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
        }
      })
      .catch(() => undefined)
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // never intercept non-GET

  const url = new URL(req.url);
  const isAsset = url.origin === self.location.origin && url.pathname.startsWith('/assets/');

  // Navigations, Supabase requests, and all other traffic are left to the browser.
  if (!isAsset) return;

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
});
