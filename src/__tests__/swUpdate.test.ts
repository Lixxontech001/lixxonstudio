// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverStaleChunk } from '../lib/chunkRecovery';
import { createSupabaseFetch } from '../lib/supabaseClient';
import {
  claimUpdateCheckSlot,
  checkBuildId,
  checkServiceWorkerUpdates,
  handleServiceWorkerKillSwitch,
  handleWaitingRegistration,
  selfHealServiceWorker,
} from '../lib/swUpdate';

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('service-worker update recovery', () => {
  it('posts SKIP_WAITING and automatically reloads at most once per session', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
    const registration = { waiting } as ServiceWorkerRegistration;

    expect(handleWaitingRegistration(registration, reload)).toBe(true);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(handleWaitingRegistration(registration, reload)).toBe(false);

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(waiting.postMessage).toHaveBeenCalledWith('SKIP_WAITING');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('checks for updates no more than once every 30 minutes in the session', () => {
    const start = 1_700_000_000_000;
    expect(claimUpdateCheckSlot(start)).toBe(true);
    expect(claimUpdateCheckSlot(start + 29 * 60 * 1000)).toBe(false);
    expect(claimUpdateCheckSlot(start + 30 * 60 * 1000)).toBe(true);
    expect(claimUpdateCheckSlot(start + 30 * 60 * 1000 + 1)).toBe(false);
  });

  it('does not run registration.update more than once per 30 minutes', async () => {
    vi.useFakeTimers();
    const update = vi.fn(async () => undefined);
    const registration = { waiting: null, update } as unknown as ServiceWorkerRegistration;
    const getRegistrations = vi.fn(async () => [registration]);
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations },
    });

    try {
      await checkServiceWorkerUpdates();
      await checkServiceWorkerUpdates();
      expect(update).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(30 * 60 * 1000);
      await checkServiceWorkerUpdates();
      expect(update).toHaveBeenCalledTimes(2);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, 'serviceWorker', originalDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
    }
  });

  it('announces a build mismatch without reloading; App owns the user-click toast action', async () => {
    const reload = vi.fn();
    const updateReady = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ buildId: 'new-build' }), { status: 200 }));
    window.addEventListener('lixxon:update-ready', updateReady);

    try {
      expect(await checkBuildId('old-build', fetcher, reload)).toBe(true);
      expect(updateReady).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('lixxon:update-ready', updateReady);
    }
  });

  it('does not announce when the deployed build id matches', async () => {
    const reload = vi.fn();
    const updateReady = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ buildId: 'same-build' }), { status: 200 }));
    window.addEventListener('lixxon:update-ready', updateReady);

    try {
      expect(await checkBuildId('same-build', fetcher, reload)).toBe(false);
      expect(updateReady).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('lixxon:update-ready', updateReady);
    }
  });

  it('self-heals after three consecutive Supabase network failures, with success resetting the count', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: {} },
    });
    const fetcher = vi.fn(async (): Promise<Response> => new Response('ok', { status: 200 }));
    const onSelfHeal = vi.fn();
    const trackedFetch = createSupabaseFetch(fetcher, onSelfHeal);

    try {
      fetcher.mockRejectedValue(new TypeError('offline'));
      await expect(trackedFetch('/rest/v1/posts')).rejects.toThrow('offline');
      await expect(trackedFetch('/rest/v1/posts')).rejects.toThrow('offline');
      expect(onSelfHeal).not.toHaveBeenCalled();

      fetcher.mockResolvedValueOnce(new Response('ok', { status: 200 }));
      await expect(trackedFetch('/rest/v1/posts')).resolves.toBeInstanceOf(Response);
      await expect(trackedFetch('/rest/v1/posts')).rejects.toThrow('offline');
      await expect(trackedFetch('/rest/v1/posts')).rejects.toThrow('offline');
      expect(onSelfHeal).not.toHaveBeenCalled();
      await expect(trackedFetch('/rest/v1/posts')).rejects.toThrow('offline');
      expect(onSelfHeal).toHaveBeenCalledTimes(1);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, 'serviceWorker', originalDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
    }
  });

  it('unregisters workers, clears caches, and respects the five-minute self-heal cooldown', async () => {
    vi.useFakeTimers();
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const unregister = vi.fn(async () => true);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: {},
        getRegistrations: vi.fn(async () => [{ unregister }]),
      },
    });
    const cacheDelete = vi.fn(async () => true);
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => ['lixxon-v3', 'old-cache']),
      delete: cacheDelete,
    });
    const reload = vi.fn();

    try {
      expect(await selfHealServiceWorker(reload)).toBe(true);
      expect(unregister).toHaveBeenCalledTimes(1);
      expect(cacheDelete).toHaveBeenCalledTimes(2);
      expect(reload).toHaveBeenCalledTimes(1);

      expect(await selfHealServiceWorker(reload)).toBe(false);
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(await selfHealServiceWorker(reload)).toBe(true);
      expect(reload).toHaveBeenCalledTimes(2);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, 'serviceWorker', originalDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
    }
  });

  it.each(['no-sw', 'reset-sw'] as const)('clears workers and caches for the ?%s=1 kill switch', async (flag) => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const unregister = vi.fn(async () => true);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: vi.fn(async () => [{ unregister }]) },
    });
    const cacheDelete = vi.fn(async () => true);
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => ['lixxon-v3']),
      delete: cacheDelete,
    });
    const reload = vi.fn();
    window.history.replaceState({}, '', `/?${flag}=1`);

    try {
      const reset = handleServiceWorkerKillSwitch(reload);
      expect(reset).not.toBe(false);
      await reset;
      expect(unregister).toHaveBeenCalledTimes(1);
      expect(cacheDelete).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      window.history.replaceState({}, '', '/');
      if (originalDescriptor) {
        Object.defineProperty(navigator, 'serviceWorker', originalDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
    }
  });

  it('does not trigger chunk recovery when a service worker controller exists', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: {} },
    });

    try {
      await expect(
        recoverStaleChunk(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
      ).rejects.toThrow('Failed to fetch dynamically imported module');
      expect(sessionStorage.getItem('lixxon_chunk_reload_at')).toBeNull();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, 'serviceWorker', originalDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
    }
  });

  it('keeps chunk reloads suppressed for five minutes', async () => {
    const now = Date.now();
    const lastReload = now - (5 * 60 * 1000 - 1000);
    sessionStorage.setItem('lixxon_chunk_reload_at', String(lastReload));

    await expect(
      recoverStaleChunk(() => Promise.reject(new Error('Loading chunk 5 failed')))
    ).rejects.toThrow('Loading chunk 5 failed');
    expect(sessionStorage.getItem('lixxon_chunk_reload_at')).toBe(String(lastReload));
  });
});
