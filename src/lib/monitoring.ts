/**
 * Optional error tracking (Sentry free tier: 5k errors/month). Completely inert unless
 * VITE_SENTRY_DSN is set, and the SDK is only downloaded in that case (dynamic import).
 */
export async function initMonitoring() {
  // VERCEL exposes the DSN as SENTRY_DSN; vite.config.ts re-exposes it (and the commit SHA)
  // at build time, because Vite alone would only inline VITE_-prefixed variables.
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) || __SENTRY_DSN__;
  if (!dsn || !import.meta.env.PROD) return;
  try {
    const Sentry = await import('@sentry/react');
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: (import.meta.env.VITE_COMMIT_SHA as string | undefined) || __COMMIT_SHA__ || undefined,
      sampleRate: 1,
      tracesSampleRate: 0, // keep well inside the free quota
      sendDefaultPii: false,
      beforeSend(event) {
        // never ship emails / tokens that might be in URLs
        if (event.request?.url) event.request.url = event.request.url.replace(/token=[^&]+/g, 'token=[redacted]');
        return event;
      },
      ignoreErrors: ['ResizeObserver loop', 'Load failed', 'NetworkError', /Loading chunk \d+ failed/],
    });
  } catch { /* offline / blocked — ignore */ }
}

/**
 * Escape hatch: visiting any page with ?reset-sw=1 unregisters every service worker,
 * deletes every cache and reloads — for a visitor stuck on a broken old worker.
 * The query param is stripped so the reload cannot loop.
 */
async function resetServiceWorkerAndReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* nothing else we can do — still reload */ }
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('reset-sw');
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

/** Register the hand-rolled service worker (offline shell + cached articles). */
export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (new URLSearchParams(window.location.search).has('reset-sw')) {
    void resetServiceWorkerAndReload();
    return;
  }
  if (!import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    // updateViaCache: 'none' — never serve /sw.js from the HTTP cache, so fixes ship on
    // the next page load and the old worker self-replaces (skipWaiting in the worker).
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
      // tell the user when a new version is ready
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) window.dispatchEvent(new CustomEvent('lixxon:update-ready'));
        });
      });
      // re-check for updates whenever the tab regains focus
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => undefined);
      });
    }).catch(() => undefined);
  });
}
