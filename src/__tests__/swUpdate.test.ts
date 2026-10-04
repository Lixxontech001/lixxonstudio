// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkBuildId, handleWaitingRegistration } from '../lib/swUpdate';

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('service-worker update recovery', () => {
  it('posts SKIP_WAITING and reloads exactly once within the cooldown', () => {
    const reload = vi.fn();
    const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
    const registration = { waiting } as ServiceWorkerRegistration;

    expect(handleWaitingRegistration(registration, reload)).toBe(true);
    expect(handleWaitingRegistration(registration)).toBe(false);

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when the deployed build id differs from the running build id', async () => {
    const reload = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ buildId: 'new-build' }), { status: 200 }));

    expect(await checkBuildId('old-build', fetcher, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the deployed build id matches', async () => {
    const reload = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ buildId: 'same-build' }), { status: 200 }));

    expect(await checkBuildId('same-build', fetcher, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
