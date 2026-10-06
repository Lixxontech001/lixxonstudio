/**
 * Browser-side Web Push helpers for the owner app.
 *
 * Pure parsing/conversion only — the network calls stay in the panel so this
 * module is testable without a browser. Nothing here stores or returns the
 * VAPID private key; the browser only ever receives the public key.
 */

export interface PushConfig {
  publicKey: string;
  subject: string;
  keysReady: boolean;
  privateKeyConfigured: boolean;
  pushEnabled: boolean;
}

export type PushTestReason =
  | 'delivered'
  | 'confirmation_required'
  | 'missing_keys'
  | 'no_device'
  | 'rate_limited'
  | 'unavailable'
  | 'credentials_invalid'
  | 'encryption_failed'
  | 'provider_rejected'
  | 'network_error'
  | 'timeout'
  | 'not_sent';

export interface PushTestResult {
  ok: boolean;
  sent: number;
  failed: number;
  expired: number;
  devices: number;
  reason: PushTestReason;
}

export interface PushDeviceRow {
  id: string;
  deviceId: string;
  label: string;
  enabled: boolean;
  revoked: boolean;
  lastDeliveryStatus: 'sent' | 'failed' | 'expired' | null;
  lastSeenAt: string | null;
}

const TEST_REASONS = new Set<PushTestReason>([
  'delivered', 'confirmation_required', 'missing_keys', 'no_device', 'rate_limited', 'unavailable',
  'credentials_invalid', 'encryption_failed', 'provider_rejected', 'network_error', 'timeout', 'not_sent',
]);
const DELIVERY_STATUSES = new Set(['sent', 'failed', 'expired']);
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function safeTime(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Base64url VAPID public key -> applicationServerKey bytes. Null when malformed. */
export function urlBase64ToUint8Array(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{80,120}={0,2}$/.test(value.trim())) return null;
  const normalised = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.length === 65 ? bytes : null;
  } catch {
    return null;
  }
}

export function arrayBufferToBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Stable per-install device id. Never derived from a user agent or an account id. */
export function getOrCreateDeviceId(storage: Pick<Storage, 'getItem' | 'setItem'>): string {
  try {
    const existing = storage.getItem('lixxon.push.deviceId');
    if (existing && DEVICE_ID_RE.test(existing)) return existing;
    const created = crypto.randomUUID().replace(/-/g, '');
    storage.setItem('lixxon.push.deviceId', created);
    return created;
  } catch {
    return '';
  }
}

export function describeDevice(userAgent: string): string {
  if (/android/i.test(userAgent)) return 'Android device';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS device';
  if (/macintosh|mac os x/i.test(userAgent)) return 'Mac';
  if (/windows/i.test(userAgent)) return 'Windows PC';
  if (/linux/i.test(userAgent)) return 'Linux device';
  return 'This device';
}

export function parsePushConfig(value: unknown, item: unknown): PushConfig | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const publicKey = safeString(value.public_key, 200);
  const subject = safeString(value.subject, 300);
  const storeItem = isRecord(item) ? item : {};
  return {
    publicKey,
    subject,
    keysReady: value.keys_ready === true && urlBase64ToUint8Array(publicKey) !== null,
    privateKeyConfigured: value.private_key_configured === true,
    pushEnabled: value.push_enabled === true || storeItem.pushEnabled === true,
  };
}

export function parsePushTestResult(value: unknown): PushTestResult | null {
  if (!isRecord(value)) return null;
  const reason = typeof value.reason === 'string' && TEST_REASONS.has(value.reason as PushTestReason)
    ? value.reason as PushTestReason
    : 'not_sent';
  const count = (raw: unknown): number =>
    // The endpoint tests at most 5 devices; anything larger is not a real result.
    typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 10 ? raw : 0;
  return {
    ok: value.ok === true,
    sent: count(value.sent),
    failed: count(value.failed),
    expired: count(value.expired),
    devices: count(value.devices),
    reason,
  };
}

/** Rows come from the RLS-protected table's safe columns; ids and labels are validated. */
export function parsePushDevices(value: unknown): PushDeviceRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: PushDeviceRow[] = [];
  for (const row of value) {
    if (!isRecord(row)) return null;
    const id = typeof row.id === 'string' && UUID_RE.test(row.id) ? row.id : '';
    const deviceId = typeof row.device_id === 'string' && DEVICE_ID_RE.test(row.device_id) ? row.device_id : '';
    if (!id || !deviceId) return null;
    const status = typeof row.last_delivery_status === 'string' && DELIVERY_STATUSES.has(row.last_delivery_status)
      ? row.last_delivery_status as 'sent' | 'failed' | 'expired'
      : null;
    rows.push({
      id,
      deviceId,
      label: safeString(row.label, 80) || 'This device',
      enabled: row.enabled === true,
      revoked: typeof row.revoked_at === 'string',
      lastDeliveryStatus: status,
      lastSeenAt: safeTime(row.last_seen_at),
    });
  }
  return rows;
}

export function subscriptionPayload(subscription: PushSubscription): {
  endpoint: string;
  p256dh: string;
  auth: string;
} | null {
  if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.endpoint.startsWith('https://')) return null;
  const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : null;
  const keys = json && typeof json.keys === 'object' && json.keys ? json.keys as Record<string, unknown> : {};
  const p256dh = safeString(keys.p256dh, 256);
  const auth = safeString(keys.auth, 256);
  if (p256dh.length < 20 || auth.length < 8) return null;
  return { endpoint: subscription.endpoint.slice(0, 2048), p256dh, auth };
}

export function pushSupportAvailable(scope: {
  serviceWorker?: unknown;
  pushManager?: unknown;
  notification?: unknown;
}): boolean {
  return Boolean(scope.serviceWorker && scope.pushManager && typeof scope.notification === 'function');
}

export function pushTestReasonMessage(reason: PushTestReason): string {
  switch (reason) {
    case 'delivered': return 'Test notification delivered to your confirmed device.';
    case 'confirmation_required': return 'Confirmation is required before a test notification is sent.';
    case 'missing_keys': return 'This needs the three Web Push keys in the Keys page before a test can be sent.';
    case 'no_device': return 'No confirmed device yet: confirm this device first, then send the test.';
    case 'rate_limited': return 'Too many test notifications just now. Try again in a few minutes.';
    case 'credentials_invalid': return 'The stored VAPID key pair does not match. Re-save both VAPID values in the Keys page.';
    case 'provider_rejected': return 'The push service rejected the test. Confirm the device again and retry.';
    case 'encryption_failed': return 'The device subscription could not be encrypted. Revoke this device and confirm it again.';
    case 'network_error':
    case 'timeout': return 'The push service could not be reached. This is retryable.';
    case 'unavailable': return 'The delivery check is temporarily unavailable.';
    case 'not_sent': return 'No test notification was sent.';
  }
}
