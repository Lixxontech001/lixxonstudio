// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
}));

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
    from: () => ({ select: () => ({ order: mocks.order }) }),
  },
}));

import PushNotificationsPanel from '../components/automation-push-panel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEVICE_UUID = '11111111-1111-4111-8111-111111111111';
const PUBLIC_KEY = 'A'.repeat(87);

function configBody(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    public_key: PUBLIC_KEY,
    subject: 'mailto:owner@lixxonstudio.com',
    private_key_configured: true,
    keys_ready: true,
    push_enabled: false,
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root | null = null;

async function settle() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll('button'));
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return buttons().find((button) => (button.textContent || '').includes(text));
}

async function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(<PushNotificationsPanel />); });
  await settle();
  return host;
}

function stubBrowser(permission: NotificationPermission, subscription: unknown = null) {
  const subscribe = vi.fn(async () => subscription);
  const getSubscription = vi.fn(async () => subscription);
  const serviceWorker = {
    ready: Promise.resolve({ pushManager: { subscribe, getSubscription } }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.assign(navigator, { serviceWorker });
  Object.assign(window, { PushManager: function PushManager() { /* marker */ } });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: Object.assign(function Notification() { /* marker */ }, { permission, requestPermission: vi.fn(async () => permission) }),
  });
  return { subscribe, getSubscription };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  localStorage.clear();
  mocks.invoke.mockResolvedValue({ data: configBody(), error: null });
  mocks.order.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockResolvedValue({ data: { id: DEVICE_UUID, enabled: true }, error: null });
  stubBrowser('granted');
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('owner push notifications panel', () => {
  it('states the honest fallback when notifications are blocked', async () => {
    stubBrowser('denied');
    const page = await render();
    const text = page.textContent || '';
    expect(text).toContain('Notifications are blocked for this site');
    expect(text).toContain('owner alerts still arrive on Telegram');
    const register = buttonByText('Register this device');
    expect(register?.disabled).toBe(true);

    // No subscription attempt is made while permission is denied.
    const subscription = await navigator.serviceWorker.ready;
    expect(subscription.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('explains which keys are missing instead of offering a dead button', async () => {
    mocks.invoke.mockResolvedValue({
      data: configBody({ keys_ready: false, private_key_configured: false, public_key: null }),
      error: null,
    });
    const page = await render();
    expect(page.textContent).toContain('No Web Push keys are stored yet');
    expect(buttonByText('Register this device')?.disabled).toBe(true);
    expect(buttonByText('Send test notification')?.disabled).toBe(true);
  });

  it('registers this device with the VAPID public key and owner-scoped RPC', async () => {
    const subscription = {
      endpoint: 'https://push.example.test/v1/send/this-device',
      toJSON: () => ({ endpoint: 'https://push.example.test/v1/send/this-device', keys: { p256dh: 'B'.repeat(44), auth: 'C'.repeat(22) } }),
      unsubscribe: vi.fn(),
    };
    const browser = stubBrowser('granted', null);
    browser.subscribe.mockResolvedValue(subscription);

    const page = await render();
    await act(async () => { buttonByText('Register this device')?.click(); });
    await settle();

    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    const [call] = mocks.rpc.mock.calls.filter(([name]) => name === 'push_device_upsert');
    expect(call?.[1]).toMatchObject({
      p_endpoint: 'https://push.example.test/v1/send/this-device',
      p_p256dh: 'B'.repeat(44),
      p_auth: 'C'.repeat(22),
      p_enable: true,
    });
    expect(String(call?.[1].p_device_id)).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(page.textContent).toContain('This device is confirmed');
  });

  it('requires a second, explicit confirmation before sending a test notification', async () => {
    const page = await render();
    const test = buttonByText('Send test notification');
    expect(test).not.toBeUndefined();
    expect(page.textContent).not.toContain('Confirm: send the test now');

    await act(async () => { test?.click(); });
    await settle();
    expect(page.textContent).toContain('Confirm: send the test now');
    // Nothing was sent by the first click.
    expect(mocks.invoke.mock.calls.filter(([, init]) => (init as { body?: { action?: string } }).body?.action === 'test')).toHaveLength(0);

    mocks.invoke.mockResolvedValue({ data: { ok: true, sent: 1, failed: 0, expired: 0, devices: 1, reason: 'delivered' }, error: null });
    await act(async () => { buttonByText('Confirm: send the test now')?.click(); });
    await settle();
    const testCalls = mocks.invoke.mock.calls.filter(([, init]) => (init as { body?: { action?: string } }).body?.action === 'test');
    expect(testCalls).toHaveLength(1);
    expect((testCalls[0][1] as { body: Record<string, unknown> }).body).toMatchObject({ confirm: true });
    expect(page.textContent).toContain('Test notification delivered');
  });

  it('reports a failed test truthfully instead of claiming success', async () => {
    const page = await render();
    mocks.invoke.mockResolvedValue({
      data: { ok: false, sent: 0, failed: 1, expired: 0, devices: 1, reason: 'provider_rejected' },
      error: null,
    });
    await act(async () => { buttonByText('Send test notification')?.click(); });
    await settle();
    await act(async () => { buttonByText('Confirm: send the test now')?.click(); });
    await settle();
    expect(page.textContent).toContain('The push service rejected the test');
    expect(page.textContent).not.toContain('Test notification delivered');
  });

  it('lists this device and revokes it, erasing server-side material', async () => {
    mocks.order.mockResolvedValue({
      data: [{
        id: DEVICE_UUID, device_id: localStorage.getItem('lixxon.push.deviceId') ?? '',
        label: 'Android device', enabled: true, revoked_at: null,
        last_delivery_status: 'sent', last_seen_at: '2026-10-06T12:00:00.000Z',
      }],
      error: null,
    });
    const unsubscribe = vi.fn(async () => true);
    stubBrowser('granted', {
      endpoint: 'https://push.example.test/v1/send/this-device',
      toJSON: () => ({ endpoint: 'https://push.example.test/v1/send/this-device', keys: { p256dh: 'B'.repeat(44), auth: 'C'.repeat(22) } }),
      unsubscribe,
    });
    // The device row needs an id, so render once to create the stored device id.
    await render();
    document.body.innerHTML = '';
    if (root) act(() => root?.unmount());
    mocks.order.mockResolvedValue({
      data: [{
        id: DEVICE_UUID, device_id: localStorage.getItem('lixxon.push.deviceId') ?? '',
        label: 'Android device', enabled: true, revoked_at: null,
        last_delivery_status: 'sent', last_seen_at: '2026-10-06T12:00:00.000Z',
      }],
      error: null,
    });
    const page = await render();
    expect(page.textContent).toContain('Android device');

    await act(async () => { buttonByText('Revoke')?.click(); });
    await settle();
    expect(unsubscribe).toHaveBeenCalled();
    const revokeCall = mocks.rpc.mock.calls.find(([name]) => name === 'push_device_revoke');
    expect(revokeCall?.[1]).toMatchObject({ p_device_id: localStorage.getItem('lixxon.push.deviceId') });
  });
});
