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

/** Register the hand-rolled service worker (offline shell + cached articles). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
      // tell the user when a new version is ready
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) window.dispatchEvent(new CustomEvent('lixxon:update-ready'));
        });
      });
    }).catch(() => undefined);
  });
}
