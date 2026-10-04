const AUTO_RELOAD_FLAG = 'lixxon_sw_auto_reload_done';
const UPDATE_CHECK_FLAG = 'lixxon_sw_update_checked_at';
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export const RUNNING_BUILD_ID = typeof __COMMIT_SHA__ === 'string' && __COMMIT_SHA__
  ? __COMMIT_SHA__
  : 'dev';

type Reload = () => void;

let fallbackUpdateCheckAt = 0;

/** Reserve the single update-check slot shared by startup, focus, and visibility events. */
export function claimUpdateCheckSlot(now = Date.now()): boolean {
  try {
    const previous = Number(window.sessionStorage.getItem(UPDATE_CHECK_FLAG) || 0);
    if (Number.isFinite(previous) && previous > 0 && now - previous < UPDATE_CHECK_INTERVAL_MS) {
      return false;
    }
    window.sessionStorage.setItem(UPDATE_CHECK_FLAG, String(now));
    return true;
  } catch {
    if (fallbackUpdateCheckAt > 0 && now - fallbackUpdateCheckAt < UPDATE_CHECK_INTERVAL_MS) return false;
    fallbackUpdateCheckAt = now;
    return true;
  }
}

/** A waiting worker may reload once per tab session, never once per cooldown window. */
function reloadOnce(reload: Reload = () => window.location.reload()): boolean {
  try {
    if (window.sessionStorage.getItem(AUTO_RELOAD_FLAG) === '1') return false;
    window.sessionStorage.setItem(AUTO_RELOAD_FLAG, '1');
    reload();
    return true;
  } catch {
    return false;
  }
}

export function handleWaitingRegistration(registration: ServiceWorkerRegistration, reload?: Reload): boolean {
  const waiting = registration.waiting;
  if (!waiting) return false;

  window.dispatchEvent(new CustomEvent('lixxon:update-ready'));
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // v2 workers only understood the string form. Keep this compatibility message
  // until every existing client has crossed the v3 worker boundary.
  waiting.postMessage('SKIP_WAITING');
  return reloadOnce(reload);
}

async function runServiceWorkerUpdateChecks(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(async (registration) => {
      try {
        await registration.update();
      } catch {
        // A failed update check must not interrupt the rest of the app.
      }
      handleWaitingRegistration(registration);
    }));
  } catch {
    // Service workers are an enhancement; the site remains usable without them.
  }
}

export async function checkServiceWorkerUpdates(): Promise<void> {
  if (!claimUpdateCheckSlot()) return;
  await runServiceWorkerUpdateChecks();
}

export async function checkBuildId(
  runningBuildId = RUNNING_BUILD_ID,
  fetcher: typeof fetch = window.fetch.bind(window),
  _reload?: Reload,
): Promise<boolean> {
  void _reload; // Keep the old call shape, but never auto-reload after a build mismatch.
  try {
    const response = await fetcher('/version.json', { cache: 'no-store' });
    if (!response.ok) return false;
    const payload = await response.json() as { buildId?: unknown };
    if (typeof payload.buildId !== 'string' || !payload.buildId || payload.buildId === runningBuildId) {
      return false;
    }

    // Build mismatches only announce an available version. App.tsx wires the toast's
    // explicit Reload button; a version probe must never reload on the user's behalf.
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lixxon:update-ready'));
    return true;
  } catch {
    return false;
  }
}

async function refreshUpdateState(): Promise<void> {
  if (!claimUpdateCheckSlot()) return;
  await Promise.all([
    runServiceWorkerUpdateChecks(),
    checkBuildId(),
  ]);
}

async function renderDiagnostics(): Promise<void> {
  const panel = document.querySelector<HTMLElement>('[data-lixxon-diag]');
  if (!panel) return;

  let controllerPresent = 'no';
  let serviceWorkerScriptUrl = 'unavailable';
  if ('serviceWorker' in navigator) {
    const controller = navigator.serviceWorker.controller;
    controllerPresent = controller ? 'yes' : 'no';
    serviceWorkerScriptUrl = controller?.scriptURL || 'none';
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const scriptUrls = new Set<string>();
      registrations.forEach((registration) => {
        [registration.active, registration.waiting, registration.installing].forEach((worker) => {
          if (worker) scriptUrls.add(worker.scriptURL);
        });
      });
      if (scriptUrls.size) serviceWorkerScriptUrl = [...scriptUrls].join(', ');
    } catch {
      // Keep the controller URL or "none" if registrations are unavailable.
    }
  }

  let cacheNames = 'unavailable';
  try {
    if (typeof caches !== 'undefined') cacheNames = (await caches.keys()).join(', ') || 'none';
  } catch {
    // Cache storage may be unavailable in private browsing.
  }

  let fetchedBuildId = 'unavailable';
  try {
    const response = await window.fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) {
      fetchedBuildId = `HTTP ${response.status}`;
    } else {
      const payload = await response.json() as { buildId?: unknown };
      fetchedBuildId = typeof payload.buildId === 'string' ? payload.buildId : 'invalid';
    }
  } catch {
    // Keep "unavailable" when the diagnostic request cannot reach the server.
  }

  panel.textContent = [
    'Lixxon diagnostics',
    `Controller present: ${controllerPresent}`,
    `SW script URL: ${serviceWorkerScriptUrl}`,
    `Caches: ${cacheNames}`,
    `Running build ID: ${RUNNING_BUILD_ID}`,
    `Fetched build ID: ${fetchedBuildId}`,
  ].join('\n');
}

function installDiagnostics(): void {
  if (new URLSearchParams(window.location.search).get('diag') !== '1') return;
  const panel = document.createElement('aside');
  panel.dataset.lixxonDiag = '';
  panel.setAttribute('aria-label', 'Lixxon diagnostics');
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;max-width:calc(100vw - 24px);padding:12px 14px;background:#1A1A1A;color:#F2EDE7;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;border:1px solid #C48B71;box-shadow:0 4px 20px rgb(0 0 0 / 0.2);';
  document.body.appendChild(panel);
  void renderDiagnostics();
}

export function initSwUpdate(): void {
  if (typeof window === 'undefined') return;

  installDiagnostics();
  void refreshUpdateState();

  const refreshWhenVisible = () => {
    if (document.visibilityState === 'visible') void refreshUpdateState();
  };
  window.addEventListener('load', () => void refreshUpdateState());
  document.addEventListener('visibilitychange', refreshWhenVisible);
  window.addEventListener('focus', () => void refreshUpdateState());
}
