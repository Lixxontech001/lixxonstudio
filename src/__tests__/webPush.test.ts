/**
 * Web Push crypto + client-parser tests.
 *
 * The encryption test is a real round trip: the payload is encrypted with the
 * sender implementation, then decrypted with an independent receiver
 * implementation built only from the user-agent private key, exactly as a
 * browser would.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  bytesToBase64Url,
  base64UrlToBytes,
  buildVapidAuthorization,
  decodeVapidCredentials,
  encryptPushPayload,
  sendPushNotification,
  testNotificationPayload,
} from '../../supabase/functions/_shared/webPush';
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
} from '../lib/webPushClient';

async function makeUserAgentKeys() {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return {
    keyPair,
    target: {
      id: '11111111-1111-4111-8111-111111111111',
      device_id: 'test-device-0001',
      endpoint: 'https://push.example.test/v1/send/abc',
      p256dh: bytesToBase64Url(publicBytes),
      auth_key: bytesToBase64Url(authSecret),
    },
    publicBytes,
    authSecret,
  };
}

async function makeVapid() {
  const ecdsa = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', ecdsa.privateKey);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ecdsa.publicKey));
  return {
    publicKey: bytesToBase64Url(rawPublic),
    privateKey: jwk.d!,
    subject: 'mailto:owner@lixxonstudio.com',
    rawPublic,
    publicKeyObject: ecdsa.publicKey,
  };
}

/** Receiver side of RFC 8291, written independently of the sender. */
async function decryptAsUserAgent(body: Uint8Array, keyPair: CryptoKeyPair, authSecret: Uint8Array) {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false);
  const keyIdLength = body[20];
  const senderPublic = body.slice(21, 21 + keyIdLength);
  const ciphertext = body.slice(21 + keyIdLength);

  const senderKey = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, keyPair.privateKey, 256));

  const hkdf = async (ikm: Uint8Array, hSalt: Uint8Array, info: string, length: number) => {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const infoBytes = new Uint8Array([...new TextEncoder().encode(info), 0]);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: hSalt, info: infoBytes }, key, length * 8,
    ));
  };

  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const ikmInfo = new Uint8Array([...new TextEncoder().encode('WebPush: info'), 0, ...uaPublic, ...senderPublic]);
  const ikmKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveBits']);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: ikmInfo }, ikmKey, 256,
  ));

  const cek = await hkdf(ikm, salt, 'Content-Encoding: aes128gcm', 16);
  const nonce = await hkdf(ikm, salt, 'Content-Encoding: nonce', 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext));

  return { plaintext, recordSize, senderPublic, salt };
}

describe('RFC 8291 payload encryption', () => {
  it('round-trips an encrypted notification and marks it as the last record', async () => {
    const { keyPair, target, authSecret } = await makeUserAgentKeys();
    const payload = testNotificationPayload();
    const body = await encryptPushPayload(new TextEncoder().encode(payload), target);
    expect(body).not.toBeNull();

    const { plaintext, recordSize, senderPublic, salt } = await decryptAsUserAgent(body!, keyPair, authSecret);
    expect(recordSize).toBe(4096);
    expect(senderPublic.length).toBe(65);
    expect(salt.length).toBe(16);
    expect(plaintext[plaintext.length - 1]).toBe(0x02);
    expect(new TextDecoder().decode(plaintext.slice(0, -1))).toBe(payload);
    // The test payload carries no article, customer or secret material.
    expect(payload).not.toMatch(/@|http|\/blog\//);
  });

  it('rejects malformed subscription material instead of sending anything', async () => {
    const { target } = await makeUserAgentKeys();
    const payload = new TextEncoder().encode('x');
    await expect(encryptPushPayload(payload, { ...target, p256dh: 'not-a-key' })).resolves.toBeNull();
    await expect(encryptPushPayload(payload, { ...target, auth_key: 'short' })).resolves.toBeNull();
    await expect(encryptPushPayload(payload, { ...target, p256dh: 'A'.repeat(86) })).resolves.toBeNull();
  });
});

describe('VAPID authorization', () => {
  it('signs a verifiable ES256 token scoped to the push service origin', async () => {
    const vapid = await makeVapid();
    const result = await buildVapidAuthorization('https://push.example.test/v1/send/abc', vapid, Date.UTC(2026, 9, 6, 12, 0, 0));
    expect(result.status).toBe('ok');
    expect(result.ttl).toBe(86400);

    const parsed = /^vapid t=([A-Za-z0-9_.-]+), k=([A-Za-z0-9_-]+)$/.exec(result.authorization);
    expect(parsed).not.toBeNull();
    const token = parsed![1];
    expect(parsed![2]).toBe(vapid.publicKey);
    const [header, payload, signature] = token!.split('.');
    // Decode byte-by-byte: TextDecoder across the test/module realm boundary is unreliable here.
    const decodeSegment = (segment: string) => String.fromCharCode(...base64UrlToBytes(segment)!);
    expect(JSON.parse(decodeSegment(header!))).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(decodeSegment(payload!));
    expect(claims.aud).toBe('https://push.example.test');
    expect(claims.sub).toBe('mailto:owner@lixxonstudio.com');
    expect(claims.exp - Math.floor(Date.UTC(2026, 9, 6, 12, 0, 0) / 1000)).toBe(86400);

    // Copy views into this realm: jsdom's SubtleCrypto rejects foreign typed arrays.
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      vapid.publicKeyObject,
      Uint8Array.from(base64UrlToBytes(signature!)!),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(verified).toBe(true);
  });

  it('refuses incomplete, oversized or mismatched credentials', async () => {
    const vapid = await makeVapid();
    const other = await makeVapid();
    await expect(buildVapidAuthorization('https://push.example.test/x', { ...vapid, privateKey: '' }))
      .resolves.toMatchObject({ status: 'invalid_credentials' });
    await expect(buildVapidAuthorization('https://push.example.test/x', { ...vapid, subject: 'owner@example.com' }))
      .resolves.toMatchObject({ status: 'invalid_credentials' });
    await expect(buildVapidAuthorization('http://push.example.test/x', vapid))
      .resolves.toMatchObject({ status: 'invalid_credentials' });
    // A private key that does not match the stored public key must never send.
    await expect(buildVapidAuthorization('https://push.example.test/x', { ...vapid, privateKey: other.privateKey }))
      .resolves.toMatchObject({ status: 'invalid_credentials' });
  });

  it('decodes only well-formed Vault material', () => {
    expect(decodeVapidCredentials({ publicKey: 'A'.repeat(86), privateKey: 'B'.repeat(43), subject: 'mailto:a@b.co' })).toBeNull();
    expect(base64UrlToBytes('not base64url!!')).toBeNull();
    expect(base64UrlToBytes(bytesToBase64Url(new Uint8Array([1, 2, 3])))).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('push delivery classification', () => {
  it('maps push service responses onto delivery statuses', async () => {
    const vapid = await makeVapid();
    const { target } = await makeUserAgentKeys();
    const payload = testNotificationPayload();

    const send = (status: number) => sendPushNotification(target, payload, vapid, {
      fetcher: vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch,
    });
    await expect(send(201)).resolves.toMatchObject({ status: 'sent' });
    await expect(send(410)).resolves.toMatchObject({ status: 'expired' });
    await expect(send(404)).resolves.toMatchObject({ status: 'expired' });
    await expect(send(500)).resolves.toMatchObject({ status: 'failed', reason: 'provider_rejected' });

    const networkFailure = await sendPushNotification(target, payload, vapid, {
      fetcher: vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch,
    });
    expect(networkFailure).toMatchObject({ status: 'failed', reason: 'network_error', httpStatus: null });

    // Nothing is sent when the stored key pair is invalid.
    const badKeys = await sendPushNotification(target, payload, { ...vapid, privateKey: '' }, {
      fetcher: vi.fn(async () => new Response(null, { status: 201 })) as unknown as typeof fetch,
    });
    expect(badKeys).toMatchObject({ status: 'failed', reason: 'credentials_invalid' });
  });
});

describe('browser push helpers', () => {
  it('reads and writes a stable device id', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    const first = getOrCreateDeviceId(storage);
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(getOrCreateDeviceId(storage)).toBe(first);
  });

  it('describes the device without using account data', () => {
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14)')).toBe('Android device');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iOS device');
    expect(describeDevice('')).toBe('This device');
  });

  it('parses only safe, well-formed server responses', () => {
    const publicKey = bytesToBase64Url(crypto.getRandomValues(new Uint8Array([4, ...crypto.getRandomValues(new Uint8Array(64))])));
    const config = parsePushConfig({
      ok: true, public_key: publicKey, subject: 'mailto:owner@lixxonstudio.com',
      private_key_configured: true, keys_ready: true, push_enabled: false,
    }, null);
    expect(config).toMatchObject({ keysReady: true, pushEnabled: false });
    expect(parsePushConfig({ ok: true, public_key: 'nope', keys_ready: true }, null)?.keysReady).toBe(false);

    expect(parsePushTestResult({ ok: true, sent: 1, failed: 0, expired: 0, devices: 1, reason: 'delivered' }))
      .toMatchObject({ ok: true, sent: 1, reason: 'delivered' });
    expect(parsePushTestResult({ ok: false, reason: 'something_new' })?.reason).toBe('not_sent');
    expect(parsePushTestResult({ ok: true, sent: 99, reason: 'delivered' })?.sent).toBe(0);

    expect(parsePushDevices([{
      id: '11111111-1111-4111-8111-111111111111', device_id: 'abc12345xyz', label: 'Android device',
      enabled: true, revoked_at: null, last_delivery_status: 'sent', last_seen_at: '2026-10-06T12:00:00.000Z',
    }])).toEqual([expect.objectContaining({ enabled: true, lastDeliveryStatus: 'sent' })]);
    expect(parsePushDevices([{ id: 'not-a-uuid', device_id: 'abc12345xyz' }])).toBeNull();
  });

  it('builds subscription material only for a real https subscription', () => {
    const endpoint = 'https://push.example.test/v1/send/abc';
    const keys = { p256dh: 'A'.repeat(44), auth: 'B'.repeat(22) };
    expect(subscriptionPayload({
      endpoint, toJSON: () => ({ endpoint, keys }),
    } as unknown as PushSubscription)).toEqual({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
    expect(subscriptionPayload({
      endpoint: 'http://insecure.test/x', toJSON: () => ({ endpoint: 'http://insecure.test/x', keys }),
    } as unknown as PushSubscription)).toBeNull();
    expect(subscriptionPayload({
      endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'short', auth: 'B'.repeat(22) } }),
    } as unknown as PushSubscription)).toBeNull();
  });

  it('reports support and honest fallback messages', () => {
    expect(pushSupportAvailable({ serviceWorker: {}, pushManager: {}, notification: () => undefined })).toBe(true);
    expect(pushSupportAvailable({ serviceWorker: {}, pushManager: {} })).toBe(false);
    expect(urlBase64ToUint8Array('short')).toBeNull();
    expect(pushTestReasonMessage('missing_keys')).toContain('Keys page');
    expect(pushTestReasonMessage('rate_limited')).toContain('Try again');
  });
});
