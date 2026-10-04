// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverStaleChunk } from '../lib/chunkRecovery';
import {
  claimUpdateCheckSlot,
  checkBuildId,
  checkServiceWorkerUpdates,
  handleWaitingRegistration,
} from '../lib/swUpdate';

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
