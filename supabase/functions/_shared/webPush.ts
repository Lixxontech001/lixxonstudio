/**
 * Web Push (RFC 8291 / RFC 8188 aes128gcm) for the owner device subscriptions.
 *
 * Pure, dependency-free helpers so the crypto can be unit-tested without a
 * network or a provider. Nothing here logs, returns or throws credential
 * material: callers receive status codes only.
 *
 * Sources of truth reused from the Keys page:
 *   - `vapid_private_key` is a base64url 32-byte P-256 scalar,
 *   - `vapid_public_key` is a base64url uncompressed 65-byte point,
 *   - `vapid_subject` is a mailto: or https: contact.
 */

export interface PushTarget {
  id?: string;
  device_id?: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export interface VapidCredentials {
  publicKey: string;
  subject: string;
  privateKey: string;
}

export type PushSendStatus = 'sent' | 'expired' | 'failed';
export type PushSendReason =
  | 'delivered'
  | 'subscription_gone'
  | 'provider_rejected'
  | 'credentials_invalid'
  | 'encryption_failed'
  | 'network_error'
  | 'timeout';

export interface PushSendResult {
  status: PushSendStatus;
  reason: PushSendReason;
  httpStatus: number | null;
}

/** Single aes128gcm record: 4096-byte records, one record per notification. */
const RECORD_SIZE = 4096;
const P256_POINT_BYTES = 65;
const P256_SCALAR_BYTES = 32;
const VAPID_TTL_SECONDS = 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 8_000;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict base64url decode: rejects anything that is not the base64url alphabet. */
export function base64UrlToBytes(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function uint32BE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

/**
 * Decode the Vault-stored VAPID material. Returns null when any value is the
 * wrong shape; the caller reports a "needs key" state rather than guessing.
 */
export function decodeVapidCredentials(
  credentials: Partial<VapidCredentials> | null | undefined,
): { publicKey: Uint8Array; publicKeyBase64Url: string; privateKey: Uint8Array; subject: string } | null {
  if (!credentials) return null;
  const publicBytes = base64UrlToBytes(credentials.publicKey);
  const privateBytes = base64UrlToBytes(credentials.privateKey);
  const subject = typeof credentials.subject === 'string' ? credentials.subject.trim() : '';
  if (!publicBytes || publicBytes.byteLength !== P256_POINT_BYTES) return null;
  if (publicBytes[0] !== 0x04) return null;
  if (!privateBytes || privateBytes.byteLength !== P256_SCALAR_BYTES) return null;
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+(?:\/[^\s]*)?)$/i.test(subject)) return null;
  return {
    publicKey: publicBytes,
    publicKeyBase64Url: bytesToBase64Url(publicBytes),
    privateKey: privateBytes,
    subject,
  };
}

/**
 * VAPID authorization (RFC 8292): ES256 JWT scoped to the push service origin.
 * Returns null when the stored public/private pair does not actually match —
 * a real misconfiguration the owner must fix in the Keys page.
 */
export async function buildVapidAuthorization(
  endpoint: string,
  credentials: VapidCredentials,
  now: number = Date.now(),
): Promise<{ authorization: string; ttl: number; status: 'ok' | 'invalid_credentials' } > {
  const decoded = decodeVapidCredentials(credentials);
  if (!decoded) return { authorization: '', ttl: 0, status: 'invalid_credentials' };

  let audience: string;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return { authorization: '', ttl: 0, status: 'invalid_credentials' };
    audience = url.origin;
  } catch {
    return { authorization: '', ttl: 0, status: 'invalid_credentials' };
  }

  const header = bytesToBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const expiresAt = Math.floor(now / 1000) + VAPID_TTL_SECONDS;
  const payload = bytesToBase64Url(utf8(JSON.stringify({
    aud: audience,
    exp: expiresAt,
    sub: decoded.subject,
  })));
  const signingInput = utf8(`${header}.${payload}`);

  try {
    // WebCrypto has no raw import for EC private keys, so the JWK is rebuilt
    // from the stored scalar plus the x/y coordinates of the stored public key.
    const signingKey = await crypto.subtle.importKey('jwk', {
      kty: 'EC',
      crv: 'P-256',
      d: bytesToBase64Url(decoded.privateKey),
      x: bytesToBase64Url(decoded.publicKey.slice(1, 33)),
      y: bytesToBase64Url(decoded.publicKey.slice(33, 65)),
      ext: true,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

    const signature = new Uint8Array(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      signingKey,
      signingInput,
    ));
    if (signature.byteLength !== 64) return { authorization: '', ttl: 0, status: 'invalid_credentials' };

    // Prove the pair matches before we send: a bad pair must fail loudly here.
    const verifyKey = await crypto.subtle.importKey(
      'raw', decoded.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, verifyKey, signature, signingInput,
    );
    if (!valid) return { authorization: '', ttl: 0, status: 'invalid_credentials' };

    return {
      authorization: `vapid t=${header}.${payload}.${bytesToBase64Url(signature)}, k=${decoded.publicKeyBase64Url}`,
      ttl: VAPID_TTL_SECONDS,
      status: 'ok',
    };
  } catch {
    // Import failures are configuration failures, never transport failures.
    return { authorization: '', ttl: 0, status: 'invalid_credentials' };
  }
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, lengthBytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * RFC 8291 payload encryption. `payload` must already be the exact bytes to
 * show the device; the caller builds a minimal, data-free notification body.
 */
export async function encryptPushPayload(payload: Uint8Array, target: PushTarget): Promise<Uint8Array | null> {
  const userAgentPublic = base64UrlToBytes(target.p256dh);
  const authSecret = base64UrlToBytes(target.auth_key);
  if (!userAgentPublic || userAgentPublic.byteLength !== P256_POINT_BYTES || userAgentPublic[0] !== 0x04) return null;
  if (!authSecret || authSecret.byteLength < 16 || authSecret.byteLength > 64) return null;
  if (payload.byteLength > RECORD_SIZE - 32) return null;

  try {
    const ephemeral = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
    );
    const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
    if (publicKeyBytes.byteLength !== P256_POINT_BYTES) return null;

    const userAgentKey = await crypto.subtle.importKey(
      'raw', userAgentPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
    );
    const sharedSecret = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'ECDH', public: userAgentKey }, ephemeral.privateKey, 256),
    );

    // IKM' = HKDF-Extract(salt=auth_secret, ikm=shared) then Expand with the
    // "WebPush: info" label and both public keys (RFC 8291 §3.3/§3.4).
    const ikm = await hkdf(
      sharedSecret,
      authSecret,
      concatBytes(utf8('WebPush: info\u0000'), userAgentPublic, publicKeyBytes),
      32,
    );

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const contentEncryptionKey = await hkdf(ikm, salt, utf8('Content-Encoding: aes128gcm\u0000'), 16);
    const nonce = await hkdf(ikm, salt, utf8('Content-Encoding: nonce\u0000'), 12);

    // One record, so the plaintext carries the last-record delimiter 0x02.
    const plaintext = concatBytes(payload, new Uint8Array([0x02]));
    const aesKey = await crypto.subtle.importKey('raw', contentEncryptionKey, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

    const header = concatBytes(
      salt,
      uint32BE(RECORD_SIZE),
      new Uint8Array([publicKeyBytes.byteLength]),
      publicKeyBytes,
    );
    return concatBytes(header, ciphertext);
  } catch {
    return null;
  }
}

/**
 * Send one notification to one confirmed device. Status values map 1:1 onto the
 * database delivery statuses; 404/410 mean the subscription is gone and must be
 * revoked, everything else is a retryable failure.
 */
export async function sendPushNotification(
  target: PushTarget,
  payload: string,
  credentials: VapidCredentials,
  deps: { fetcher?: typeof fetch; now?: number; timeoutMs?: number } = {},
): Promise<PushSendResult> {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now();

  const vapid = await buildVapidAuthorization(target.endpoint, credentials, now);
  if (vapid.status !== 'ok') {
    return { status: 'failed', reason: 'credentials_invalid', httpStatus: null };
  }

  const body = await encryptPushPayload(utf8(payload), target);
  if (!body) return { status: 'failed', reason: 'encryption_failed', httpStatus: null };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(target.endpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: {
        Authorization: vapid.authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(vapid.ttl),
        Urgency: 'normal',
      },
      body,
    });
  } catch {
    clearTimeout(timer);
    return { status: 'failed', reason: controller.signal.aborted ? 'timeout' : 'network_error', httpStatus: null };
  }
  clearTimeout(timer);

  // Drain the push service body; it is never read for content.
  try {
    await response.body?.cancel();
  } catch {
    // Nothing depends on the provider body.
  }

  if (response.status === 404 || response.status === 410) {
    return { status: 'expired', reason: 'subscription_gone', httpStatus: response.status };
  }
  if (response.status >= 200 && response.status < 300) {
    return { status: 'sent', reason: 'delivered', httpStatus: response.status };
  }
  return { status: 'failed', reason: 'provider_rejected', httpStatus: response.status };
}

/**
 * The only notification this endpoint can send: a fixed, owner-initiated test.
 * It never contains article, customer or secret data.
 */
export function testNotificationPayload(): string {
  return JSON.stringify({
    title: 'Lixxon Studio',
    body: 'Test notification from your Owner app. Push is working on this device.',
    tag: 'lixxon-push-test',
    renotify: true,
    data: { url: '/admin/settings' },
  });
}
