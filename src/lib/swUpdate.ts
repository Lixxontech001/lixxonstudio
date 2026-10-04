const RELOAD_FLAG = 'lixxon_sw_reload_at';
const RELOAD_COOLDOWN_MS = 60_000;

export const RUNNING_BUILD_ID = typeof __COMMIT_SHA__ === 'string' && __COMMIT_SHA__
  ? __COMMIT_SHA__
  : 'dev';

type Reload = () => void;

function reloadOnce(reload: Reload = () => window.location.reload()): boolean {
  try {
    const previous = Number(window.sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Number.isFinite(previous) && Date.now() - previous < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
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

export async function checkServiceWorkerUpdates(): Promise<void> {
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

export async function checkBuildId(
  runningBuildId = RUNNING_BUILD_ID,
  fetcher: typeof fetch = window.fetch.bind(window),
  reload?: Reload,
): Promise<boolean> {
  try {
    const response = await fetcher('/version.json', { cache: 'no-store' });
    if (!response.ok) return false;
    const payload = await response.json() as { buildId?: unknown };
    if (typeof payload.buildId !== 'string' || !payload.buildId || payload.buildId === runningBuildId) return false;
    return reloadOnce(reload);
  } catch {
    return false;
  }
}

async function refreshUpdateState(): Promise<void> {
  await Promise.all([
    checkServiceWorkerUpdates(),
    checkBuildId(),
  ]);
}

async function renderDiagnostics(): Promise<void> {
  const panel = document.querySelector<HTMLElement>('[data-lixxon-diag]');
  if (!panel) return;

  let controller = 'none';
  if ('serviceWorker' in navigator) {
    controller = navigator.serviceWorker.controller?.scriptURL || 'none';
  }
  let cacheNames = 'unavailable';
  try {
    cacheNames = (await caches.keys()).join(', ') || 'none';
  } catch {
    // Cache storage may be unavailable in private browsing.
  }

  panel.textContent = [
    'Lixxon diagnostics',
    `Controller: ${controller}`,
    `Caches: ${cacheNames}`,
    `Build: ${RUNNING_BUILD_ID}`,
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
