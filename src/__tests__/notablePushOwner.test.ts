import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BRIEFING_NOTABLE_KINDS } from '../../supabase/functions/_shared/buddyBriefing';
import { PUSH_HELP_COPY, notifyOwnerDevices, shouldBuzz, type PushNotifyDeps } from '../../supabase/functions/_shared/notablePush';
import { sendPushNotification, type PushTarget, type VapidCredentials } from '../../supabase/functions/_shared/webPush';

// Phase D slice 4: the notable writer makes one owner push attempt for each briefing kind, through the existing
// Web Push helper. Missing VAPID is an honest skip. Every send in these tests is a fake: no real push goes anywhere.

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
const DEVICE: PushTarget = { id: 'dev-1', endpoint: 'https://push.example.test/dev-1', p256dh: 'P', auth_key: 'A' };
const KEYS: VapidCredentials = { publicKey: 'PUB-TEST', subject: 'mailto:owner@example.test', privateKey: 'PRIV-TEST' };

function deps(options: { credentials: VapidCredentials | null; targets?: PushTarget[] }) {
  const send = vi.fn(async () => ({ status: 'sent' as const, reason: 'delivered' as const, httpStatus: 201 }));
  const loadTargets = vi.fn(async () => options.targets ?? [DEVICE]);
  const pushDeps: PushNotifyDeps = {
    loadCredentials: async () => options.credentials,
    loadTargets,
    send,
  };
  return { pushDeps, send, loadTargets };
}

describe('every briefing kind buzzes the owner, once per device', () => {
  it('each briefing kind is a buzz kind', () => {
    expect(BRIEFING_NOTABLE_KINDS.length).toBeGreaterThan(0);
    for (const kind of BRIEFING_NOTABLE_KINDS) expect(shouldBuzz(kind)).toBe(true);
  });

  it('the kinds that were quiet before now buzz: takeover, Kill, week up and down, door failed, order blocked', () => {
    for (const kind of ['takeover_changed', 'kill_changed', 'week_up', 'week_down', 'door_failed', 'order_blocked']) {
      expect(shouldBuzz(kind)).toBe(true);
    }
  });

  it('a briefing kind with keys and a device gets one fake send per device, and the status is sent', async () => {
    for (const kind of BRIEFING_NOTABLE_KINDS) {
      const { pushDeps, send } = deps({ credentials: KEYS, targets: [DEVICE, { ...DEVICE, id: 'dev-2', endpoint: 'https://push.example.test/dev-2' }] });
      const outcome = await notifyOwnerDevices(kind, 'A briefing event', pushDeps);
      expect(outcome).toEqual({ status: 'sent', sent: 2, gone: 0, failed: 0 });
      expect(send).toHaveBeenCalledTimes(2);
    }
  });
});

describe('missing VAPID is an honest skip, and nothing is sent', () => {
  it('every briefing kind returns not_configured, reads no devices, and sends nothing', async () => {
    for (const kind of BRIEFING_NOTABLE_KINDS) {
      const { pushDeps, send, loadTargets } = deps({ credentials: null });
      const outcome = await notifyOwnerDevices(kind, 'A briefing event', pushDeps);
      expect(outcome.status).toBe('not_configured');
      expect(send).not.toHaveBeenCalled();
      expect(loadTargets).not.toHaveBeenCalled();
    }
  });

  it('the owner is shown the same help line the Keys page uses', () => {
    expect(PUSH_HELP_COPY).toMatch(/VAPID/);
    expect(PUSH_HELP_COPY).toMatch(/Register this device/);
  });
});

describe('the Web Push helper, with a fake fetch only', () => {
  it('invalid VAPID values make the helper fail before any network call, so the fake fetch is never used', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
    const { pushDeps } = deps({ credentials: KEYS });
    const outcome = await notifyOwnerDevices('door_failed', 'A door did not send', {
      ...pushDeps,
      send: (target, payload, credentials) => sendPushNotification(target, payload, credentials, { fetcher }),
    });
    expect(outcome.status).toBe('failed');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('the day run writes the briefing notables through one helper, and the night report writes none', () => {
  const placement = read('supabase/functions/minds-run-placement/index.ts');

  it('the one notable writer buzzes only when shouldBuzz allows, and records the push status on the row', () => {
    expect(placement).toMatch(/if \(!shouldBuzz\(kind\)\) return null;/);
    expect(placement).toMatch(/notifyOwnerDevices\(kind, title, ownerPushDeps\(sb, owner\)\)/);
    expect(placement).toMatch(/update\(\{ push_note: outcome\.status \}\)/);
  });

  it('a missing key or device writes one honest daily-log line, with the same help copy', () => {
    expect(placement).toMatch(/action: "Owner phone push"/);
    expect(placement).toMatch(/outcome\.status === "no_device" \? NO_DEVICE_COPY : PUSH_HELP_COPY/);
  });

  it('night report writes no notables, so it has no push path of its own to route', () => {
    const night = read('supabase/functions/_shared/nightReportRun.ts');
    const report = read('supabase/functions/_shared/mindsNightReport.ts');
    expect(night).not.toMatch(/notifyOwnerDevices|minds_notable_events/);
    expect(report).not.toMatch(/notifyOwnerDevices|sendPushNotification/);
  });
});
