import { useCallback, useEffect, useState } from 'react';
import { BellRing, ShieldCheck, Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import {
  describeDevice,
  getOrCreateDeviceId,
  parsePushConfig,
  parsePushDevices,
  parsePushTestResult,
  pushSupportAvailable,
  pushTestReasonMessage,
  subscriptionPayload,
  urlBase64ToUint8Array,
  type PushConfig,
  type PushDeviceRow,
} from '../lib/webPushClient';

type PermissionState = 'unknown' | 'default' | 'granted' | 'denied' | 'unsupported';

interface SubscriptionSnapshot {
  endpoint: string;
  p256dh: string;
  auth: string;
}

function browserPermission(): PermissionState {
  if (typeof window === 'undefined') return 'unknown';
  if (!pushSupportAvailable({
    serviceWorker: navigator.serviceWorker,
    pushManager: 'PushManager' in window ? window.PushManager : undefined,
    notification: 'Notification' in window ? window.Notification : undefined,
  })) {
    return 'unsupported';
  }
  return Notification.permission as PermissionState;
}

async function activeSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) ?? null;
}

export default function PushNotificationsPanel() {
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [devices, setDevices] = useState<PushDeviceRow[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmTest, setConfirmTest] = useState(false);

  const loadDevices = useCallback(async () => {
    const { data, error } = await supabase
      .from('push_device_subscriptions')
      .select('id, device_id, label, enabled, revoked_at, last_delivery_status, last_seen_at')
      .order('last_seen_at', { ascending: false });
    if (error) return;
    const rows = parsePushDevices(data);
    if (rows) setDevices(rows);
  }, []);

  const loadConfig = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('automation-push', { body: { action: 'config' } });
    if (error) return;
    const parsed = parsePushConfig(data, null);
    if (parsed) setConfig(parsed);
  }, []);

  useEffect(() => {
    setPermission(browserPermission());
    void loadConfig();
    void loadDevices();
  }, [loadConfig, loadDevices]);

  // The worker only relays this: it never posts credentials itself.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        setMessage('Your push subscription changed. Confirm this device again to keep receiving alerts.');
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  const deviceId = typeof window === 'undefined'
    ? ''
    : getOrCreateDeviceId(window.localStorage);
  const thisDevice = devices.find((row) => row.deviceId === deviceId && !row.revoked);
  const thisDeviceSubscription = async (): Promise<SubscriptionSnapshot | null> => {
    const subscription = await activeSubscription();
    return subscription ? subscriptionPayload(subscription) : null;
  };

  const registerThisDevice = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (!config?.keysReady) {
        setMessage('Add the three Web Push keys in the Keys page first: public key, private key and contact subject.');
        return;
      }
      const applicationServerKey = urlBase64ToUint8Array(config.publicKey);
      if (!applicationServerKey) {
        setMessage('The stored VAPID public key is not a valid key. Re-save it in the Keys page.');
        return;
      }
      const granted = await Notification.requestPermission();
      setPermission(granted as PermissionState);
      if (granted !== 'granted') {
        setMessage('Notifications are blocked for this site, so nothing can be sent to this device. Owner alerts still reach you on Telegram.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      const payload = subscriptionPayload(subscription);
      if (!payload) {
        setMessage('The browser returned an unusable subscription. Revoke this device and try again.');
        return;
      }
      const { data, error } = await supabase.rpc('push_device_upsert', {
        p_device_id: deviceId,
        p_label: describeDevice(navigator.userAgent),
        p_endpoint: payload.endpoint,
        p_p256dh: payload.p256dh,
        p_auth: payload.auth,
        p_enable: true,
      });
      if (error || !data) {
        setMessage('This device could not be registered. Check that you are signed in as the owner.');
        return;
      }
      setMessage('This device is confirmed. Send a test notification to check delivery.');
      await loadDevices();
    } catch {
      setMessage('The browser could not complete push registration. Nothing was enabled.');
    } finally {
      setBusy(false);
    }
  };

  const confirmThisDevice = async () => {
    setBusy(true);
    setMessage('');
    try {
      const payload = await thisDeviceSubscription();
      if (!payload) {
        setMessage('No browser subscription exists yet. Use "Register this device" first.');
        return;
      }
      const { error } = await supabase.rpc('push_device_upsert', {
        p_device_id: deviceId,
        p_label: describeDevice(navigator.userAgent),
        p_endpoint: payload.endpoint,
        p_p256dh: payload.p256dh,
        p_auth: payload.auth,
        p_enable: true,
      });
      setMessage(error ? 'This device could not be confirmed.' : 'This device is confirmed for owner alerts.');
      await loadDevices();
    } finally {
      setBusy(false);
    }
  };

  const disableThisDevice = async () => {
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('push_device_upsert', {
        p_device_id: deviceId,
        p_label: describeDevice(navigator.userAgent),
        p_endpoint: null,
        p_p256dh: null,
        p_auth: null,
        p_enable: false,
      });
      setMessage(error ? 'This device could not be paused.' : 'Delivery to this device is paused. Its keys are kept until you revoke it.');
      await loadDevices();
    } finally {
      setBusy(false);
    }
  };

  const revokeDevice = async (target: PushDeviceRow) => {
    setBusy(true);
    setMessage('');
    try {
      if (target.deviceId === deviceId) {
        const subscription = await activeSubscription();
        if (subscription) await subscription.unsubscribe().catch(() => undefined);
      }
      const { error } = await supabase.rpc('push_device_revoke', { p_device_id: target.deviceId });
      setMessage(error ? 'Revocation failed; the device may still be confirmed.' : 'Device revoked. Its endpoint and keys were erased.');
      await loadDevices();
    } finally {
      setBusy(false);
    }
  };

  const revokeAll = async () => {
    setBusy(true);
    setMessage('');
    try {
      const subscription = await activeSubscription();
      if (subscription) await subscription.unsubscribe().catch(() => undefined);
      const { data, error } = await supabase.rpc('push_device_revoke_all');
      if (error) {
        setMessage('Revoke-all failed; some devices may still be confirmed.');
        return;
      }
      setMessage(`${typeof data === 'number' ? data : 0} device(s) revoked. Endpoints and keys were erased.`);
      await loadDevices();
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setConfirmTest(false);
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('automation-push', {
        body: { action: 'test', confirm: true },
      });
      if (error) {
        setMessage('The test notification could not be sent.');
        return;
      }
      const result = parsePushTestResult(data);
      if (!result) {
        setMessage('The test returned an unrecognized result.');
        return;
      }
      setMessage(
        result.ok
          ? `${pushTestReasonMessage('delivered')} (${result.sent} of ${result.devices} device(s) reached.)`
          : pushTestReasonMessage(result.reason),
      );
      await loadDevices();
      await loadConfig();
    } finally {
      setBusy(false);
    }
  };

  const statusLine = (() => {
    if (permission === 'unsupported') return 'This browser cannot receive Web Push. Owner alerts still reach you on Telegram.';
    if (permission === 'denied') return 'Notifications are blocked for this site. Owner alerts still reach you on Telegram.';
    if (!config) return 'Checking the stored Web Push keys…';
    if (!config.privateKeyConfigured && !config.publicKey) return 'No Web Push keys are stored yet. Add them in the Keys page.';
    if (!config.keysReady) return 'Web Push keys are incomplete. Public key, private key and contact subject are all required.';
    if (!thisDevice) return 'Ready. Register this device to receive owner alerts.';
    if (!thisDevice.enabled) return 'This device is registered but not confirmed. Confirm it to allow delivery.';
    return 'This device is confirmed for owner alerts.';
  })();

  const canRegister = permission === 'granted' || permission === 'default';

  return (
    <section aria-labelledby="push-notifications-title" className="mb-6 rounded-sm border border-taupe/30 bg-white p-5 sm:p-6">
      <h2 id="push-notifications-title" className="flex items-center gap-2 text-base font-medium text-charcoal">
        <BellRing size={16} className="text-bronze" aria-hidden="true" /> Owner notifications
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-charcoal-muted">
        Phone notifications are opt-in, device by device. Nothing is sent to anyone else, no notification contains article or customer data,
        and revoking a device erases its address and keys immediately.
      </p>

      <p role="status" aria-live="polite" className="mt-3 text-sm text-charcoal">{statusLine}</p>

      {config && !config.pushEnabled && config.keysReady && (
        <p className="mt-2 rounded-sm border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          The automatic <strong>automation.push</strong> switch is off. A test notification still works, but scheduled alerts stay silent until you turn that switch on.
        </p>
      )}

      {permission === 'denied' && (
        <div className="mt-3 rounded-sm border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
          <p className="font-medium">Notifications are blocked in this browser</p>
          <p className="mt-1">
            Allow notifications for this site in the browser&apos;s site settings (the padlock in the address bar), then reload this page.
            Nothing else is lost: <strong>owner alerts still arrive on Telegram</strong> in the meantime.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={registerThisDevice}
          disabled={busy || !config?.keysReady || !canRegister}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-charcoal px-4 py-2 text-sm font-medium text-white hover:bg-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60"
        >
          <Smartphone size={16} aria-hidden="true" /> {thisDevice ? 'Update this device' : 'Register this device'}
        </button>

        {thisDevice && !thisDevice.enabled && (
          <button
            type="button"
            onClick={confirmThisDevice}
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-bronze/40 px-4 py-2 text-sm font-medium text-charcoal hover:bg-taupe-light/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60"
          >
            <ShieldCheck size={16} aria-hidden="true" /> Confirm this device
          </button>
        )}

        {thisDevice?.enabled && (
          <button
            type="button"
            onClick={disableThisDevice}
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center rounded-sm border border-taupe/40 px-4 py-2 text-sm text-charcoal hover:bg-taupe-light/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60"
          >
            Pause this device
          </button>
        )}

        {confirmTest ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={sendTest}
              disabled={busy}
              className="inline-flex min-h-11 items-center justify-center rounded-sm bg-bronze px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60"
            >
              Confirm: send the test now
            </button>
            <button
              type="button"
              onClick={() => setConfirmTest(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-sm border border-taupe/40 px-4 py-2 text-sm text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmTest(true)}
            disabled={busy || !config?.keysReady}
            className="inline-flex min-h-11 items-center justify-center rounded-sm border border-taupe/40 px-4 py-2 text-sm text-charcoal hover:bg-taupe-light/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60"
          >
            Send test notification
          </button>
        )}
      </div>

      {message && <p role="status" aria-live="polite" className="mt-3 text-sm text-charcoal">{message}</p>}

      <div className="mt-5">
        <h3 className="text-sm font-medium text-charcoal">Confirmed devices</h3>
        {devices.length === 0 ? (
          <p className="mt-1 text-sm text-charcoal-muted">No device is registered yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-taupe/30 bg-taupe-light/40 p-3">
                <div>
                  <p className="text-sm font-medium text-charcoal">
                    {device.label}{device.deviceId === deviceId ? ' (this device)' : ''}
                  </p>
                  <p className="text-xs text-charcoal-muted">
                    {device.revoked
                      ? 'Revoked — address and keys erased'
                      : device.enabled
                        ? `Active${device.lastDeliveryStatus ? ` · last delivery: ${device.lastDeliveryStatus}` : ''}`
                        : 'Paused'}
                  </p>
                </div>
                {!device.revoked && (
                  <button
                    type="button"
                    onClick={() => revokeDevice(device)}
                    disabled={busy}
                    className="inline-flex min-h-11 items-center justify-center rounded-sm border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {devices.some((device) => !device.revoked) && (
          <button
            type="button"
            onClick={revokeAll}
            disabled={busy}
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-sm border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60"
          >
            Revoke all devices
          </button>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-charcoal-muted">
        If a notification never arrives, the alert pipeline still emails you and falls back to Telegram. Android install and playback checks stay an owner step.
      </p>
    </section>
  );
}
