/* Lixxon Studio service worker — offline shell, cached assets, and recently read articles.
   No build step; versions are bumped by changing CACHE. */
const CACHE = 'lixxon-v1';
const SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
const API_HOST = /\.supabase\.co$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

const put = async (req, res) => { if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); } return res; };

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // SPA navigations: network first, fall back to cached shell, then offline page
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => put('/', r)).catch(async () => (await caches.match('/')) || caches.match('/offline.html')));
    return;
  }
  // hashed build assets: cache first
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(req, r))));
    return;
  }
  // Supabase REST reads (posts, categories…): network first with cached fallback so visited articles open offline
  if (API_HOST.test(url.hostname) && url.pathname.startsWith('/rest/v1/') && !url.pathname.includes('rpc')) {
    e.respondWith(fetch(req).then((r) => put(req, r)).catch(() => caches.match(req)));
    return;
  }
  // images (same-origin or storage): stale-while-revalidate
  if (req.destination === 'image') {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => put(req, r)).catch(() => hit);
      return hit || net;
    }));
  }
});
