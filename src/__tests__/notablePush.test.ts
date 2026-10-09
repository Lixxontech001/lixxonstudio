// @vitest-environment node
// Notable events that buzz the owner's phone. Every send here is a fake: no real push goes anywhere.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUZZ_KINDS,
  NO_DEVICE_COPY,
  PUSH_HELP_COPY,
  notifyOwnerDevices,
  pushPayload,
  shouldBuzz,
  type PushNotifyDeps,
} from '../../supabase/functions/_shared/notablePush';
import type { PushSendResult, PushTarget, VapidCredentials } from '../../supabase/functions/_shared/webPush';

const KEYS: VapidCredentials = { publicKey: 'PUBLIC-TEST', subject: 'mailto:owner@example.test', privateKey: 'PRIVATE-TEST' };
const DEVICE_A: PushTarget = { id: 'dev-a', device_id: 'a', endpoint: 'https://push.example/a', p256dh: 'P256-A', auth_key: 'AUTH-A' };
const DEVICE_B: PushTarget = { id: 'dev-b', device_id: 'b', endpoint: 'https://push.example/b', p256dh: 'P256-B', auth_key: 'AUTH-B' };

interface Spy {
  sends: Array<{ endpoint: string; payload: string }>;
  gone: string[];
}

function deps(options: {
  credentials?: VapidCredentials | null;
  targets?: PushTarget[];
  sendResult?: (target: PushTarget) => PushSendResult | Promise<PushSendResult>;
  throwOnSend?: boolean;
  throwOnTargets?: boolean;
}): { spy: Spy; deps: PushNotifyDeps } {
  const spy: Spy = { sends: [], gone: [] };
  const value: PushNotifyDeps = {
    async loadCredentials() {
      return options.credentials === undefined ? KEYS : options.credentials;
    },
    async loadTargets() {
      if (options.throwOnTargets) throw new Error('database down');
      return options.targets ?? [DEVICE_A];
    },
    async send(target, payload) {
      if (options.throwOnSend) throw new Error('network down');
      spy.sends.push({ endpoint: target.endpoint, payload });
      return options.sendResult ? options.sendResult(target) : { status: 'sent', reason: 'delivered', httpStatus: 201 };
    },
    async markGone(target) {
      spy.gone.push(target.id ?? '');
    },
  };
  return { spy, deps: value };
}

describe('which events buzz the owner', () => {
  it('the buzz list is the agreed one: doors, packs, sales and clicks, traffic, the Auditor, breakage, and finished jobs', () => {
    expect([...BUZZ_KINDS].sort()).toEqual(
      ['auditor_blocked', 'door_posted', 'job_finished', 'mind_failed', 'pack_ready', 'product_click', 'sale', 'traffic_new_kind'].sort(),
    );
  });

  it('a heartbeat never buzzes, and neither do the quiet kinds', () => {
    expect(shouldBuzz('heartbeat')).toBe(false);
    expect(shouldBuzz('takeover_changed')).toBe(false);
    expect(shouldBuzz('kill_changed')).toBe(false);
    expect(shouldBuzz('article_changed')).toBe(false);
    expect(shouldBuzz('night_report_written')).toBe(false);
    expect(shouldBuzz('auditor_blocked')).toBe(true);
  });

  it('a notable kind would push, and a quiet one would not push at all', async () => {
    const quiet = deps({});
    const outcome = await notifyOwnerDevices('heartbeat', 'Still here', quiet.deps);
    expect(outcome.status).toBe('not_buzzing');
    expect(quiet.spy.sends).toHaveLength(0);

    const loud = deps({});
    const sent = await notifyOwnerDevices('door_posted', '2 free doors posted today', loud.deps);
    expect(sent.status).toBe('sent');
    expect(loud.spy.sends).toHaveLength(1);
  });
});

describe('the send to each confirmed device', () => {
  it('every confirmed device gets one notification, and the payload is only the title, the words and where a tap goes', async () => {
    const { spy, deps: value } = deps({ targets: [DEVICE_A, DEVICE_B] });
    const outcome = await notifyOwnerDevices('pack_ready', '2 gated packs are ready', value);
    expect(outcome).toEqual({ status: 'sent', sent: 2, gone: 0, failed: 0 });
    expect(spy.sends.map((item) => item.endpoint)).toEqual([DEVICE_A.endpoint, DEVICE_B.endpoint]);
    const body = JSON.parse(spy.sends[0].payload);
    expect(body).toEqual({
      title: 'Buddy',
      body: '2 gated packs are ready',
      tag: 'lixxon-pack_ready',
      renotify: true,
      data: { url: '/buddy' },
    });
  });

  it('the payload never carries a device, an address, a key, or a secret', () => {
    const payload = pushPayload('mind_failed', 'The free doors could not run');
    expect(payload).not.toMatch(/endpoint|p256dh|auth|PRIVATE|PUBLIC|https?:\/\/push/i);
  });

  it('a long title is cut to a short body, so a lock screen stays readable', () => {
    const body = JSON.parse(pushPayload('door_posted', 'x'.repeat(400))).body as string;
    expect(body.length).toBeLessThanOrEqual(120);
  });

  it('a device the push service says is gone is marked, and the others still get the message', async () => {
    const { spy, deps: value } = deps({
      targets: [DEVICE_A, DEVICE_B],
      sendResult: (target) => (target.id === 'dev-a' ? { status: 'expired', reason: 'subscription_gone', httpStatus: 410 } : { status: 'sent', reason: 'delivered', httpStatus: 201 }),
    });
    const outcome = await notifyOwnerDevices('auditor_blocked', 'Auditor stopped a change', value);
    expect(outcome).toEqual({ status: 'sent', sent: 1, gone: 1, failed: 0 });
    expect(spy.gone).toEqual(['dev-a']);
  });

  it('if every device is gone, the status says no device, and nothing is retried', async () => {
    const { spy, deps: value } = deps({
      targets: [DEVICE_A],
      sendResult: () => ({ status: 'expired', reason: 'subscription_gone', httpStatus: 404 }),
    });
    const outcome = await notifyOwnerDevices('sale', 'A sale', value);
    expect(outcome.status).toBe('no_device');
    expect(spy.gone).toEqual(['dev-a']);
  });

  it('a device that fails is counted as failed, and does not stop the others', async () => {
    const { deps: value } = deps({
      targets: [DEVICE_A, DEVICE_B],
      sendResult: (target) => (target.id === 'dev-a' ? { status: 'failed', reason: 'provider_rejected', httpStatus: 500 } : { status: 'sent', reason: 'delivered', httpStatus: 201 }),
    });
    const outcome = await notifyOwnerDevices('mind_failed', 'Something broke', value);
    expect(outcome).toEqual({ status: 'sent', sent: 1, gone: 0, failed: 1 });
  });
});

describe('the states that must never fail the day run', () => {
  it('no device registered: the status says no device, nothing is sent, and nothing throws', async () => {
    const { spy, deps: value } = deps({ targets: [] });
    const outcome = await notifyOwnerDevices('door_posted', 'A door posted', value);
    expect(outcome.status).toBe('no_device');
    expect(spy.sends).toHaveLength(0);
    expect(NO_DEVICE_COPY).toBe('no device');
  });

  it('keys missing: the status says not configured, the owner is shown the help line, and no device is read', async () => {
    const { spy, deps: value } = deps({ credentials: null });
    const outcome = await notifyOwnerDevices('door_posted', 'A door posted', value);
    expect(outcome.status).toBe('not_configured');
    expect(spy.sends).toHaveLength(0);
    expect(PUSH_HELP_COPY).toBe(
      'To turn push on: enter your VAPID values, then open /admin/settings on your phone and tap Register this device.',
    );
  });

  it('a database that cannot list devices is a failed push, and it does not throw', async () => {
    const { deps: value } = deps({ throwOnTargets: true });
    const outcome = await notifyOwnerDevices('door_posted', 'A door posted', value);
    expect(outcome.status).toBe('failed');
  });

  it('a sender that throws is a failed send for that device, and the run keeps going', async () => {
    const { deps: value } = deps({ throwOnSend: true, targets: [DEVICE_A, DEVICE_B] });
    const outcome = await notifyOwnerDevices('door_posted', 'A door posted', value);
    expect(outcome).toEqual({ status: 'failed', sent: 0, gone: 0, failed: 2 });
  });

  it('the help line is the same wording the Keys page already shows', () => {
    const generator = readFileSync(join(process.cwd(), 'src/admin/components/VapidGenerator.tsx'), 'utf8');
    expect(generator).toContain(PUSH_HELP_COPY);
  });
});
