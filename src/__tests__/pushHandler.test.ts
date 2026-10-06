/**
 * Owner-only Web Push endpoint tests.
 *
 * The Vault read is stubbed, so these prove routing, authorisation, explicit
 * confirmation, rate limiting and redaction — not live delivery (the real send
 * happens only when the owner stores VAPID keys and confirms a device).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caller: vi.fn(),
  service: vi.fn(),
  fetcher: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('../../supabase/functions/_shared/http.ts', () => ({
  callerUser: mocks.caller,
  serviceClient: mocks.service,
  rateLimit: mocks.rateLimit,
  env: (name: string) => (name === 'SITE_URL' ? 'https://lixxonstudio.com' : undefined),
}));

import { handleAutomationPush } from '../../supabase/functions/automation-push/handler';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const ENDPOINT = 'https://push.example.test/v1/send/owner-device-abc';
// Real user-agent key material: an invalid point must never be used as a fixture.
let P256DH = '';
let AUTH = '';
const BOGUS_P256DH = 'B'.repeat(87);
// Generated per run: a real P-256 pair, so the handler's own key-pair self-check passes.
let PRIVATE_KEY = '';
let PUBLIC_KEY = '';

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://project.supabase.co/functions/v1/automation-push', {
    method: 'POST',
    headers: {
      Origin: 'https://lixxonstudio.com',
      Authorization: 'Bearer verified-owner-jwt',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Minimal service client double: records RPC calls and returns scripted data. */
function createService(options: { targets?: unknown[]; targetsError?: boolean; recordCalls?: string[] } = {}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    options.recordCalls?.push(`${name}:${JSON.stringify(args)}`);
    switch (name) {
      case 'automation_secret_get_internal':
        if (args.p_secret_name === 'vapid_private_key') return { data: PRIVATE_KEY, error: null };
        if (args.p_secret_name === 'vapid_public_key') return { data: PUBLIC_KEY, error: null };
        if (args.p_secret_name === 'vapid_subject') return { data: 'mailto:owner@lixxonstudio.com', error: null };
        return { data: null, error: null };
      case 'automation_feature_flags':
        return { data: { 'automation.push': false }, error: null };
      case 'push_test_targets':
        return options.targetsError
          ? { data: null, error: new Error('internal database detail') }
          : { data: options.targets ?? [], error: null };
      default:
        return { data: true, error: null };
    }
  });
  return { rpc };
}

function ownerRequest(body: unknown, options: Parameters<typeof createService>[0] = {}) {
  const service = createService(options);
  mocks.service.mockReturnValue(service);
  return handleAutomationPush(request(body), {
    fetcher: mocks.fetcher as unknown as typeof fetch,
    ownerCheck: async () => true,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const ecdsa = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', ecdsa.privateKey);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ecdsa.publicKey));
  let binary = '';
  for (const byte of rawPublic) binary += String.fromCharCode(byte);
  PUBLIC_KEY = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  PRIVATE_KEY = jwk.d!;
  const toBase64Url = (bytes: Uint8Array) => {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const userAgent = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  P256DH = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', userAgent.publicKey)));
  AUTH = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  mocks.caller.mockResolvedValue({ id: OWNER_ID, email: 'owner@lixxonstudio.com' });
  mocks.rateLimit.mockResolvedValue(true);
  mocks.fetcher.mockResolvedValue(new Response(null, { status: 201 }));
});

describe('owner-only push endpoint', () => {
  it('rejects an unauthenticated caller and a non-owner caller', async () => {
    mocks.caller.mockResolvedValue(null);
    const anonymous = await handleAutomationPush(request({ action: 'config' }), { fetcher: mocks.fetcher as unknown as typeof fetch });
    expect(anonymous.status).toBe(401);

    mocks.caller.mockResolvedValue({ id: OWNER_ID, email: 'owner@lixxonstudio.com' });
    const service = createService();
    mocks.service.mockReturnValue(service);
    const other = await handleAutomationPush(request({ action: 'config' }), {
      fetcher: mocks.fetcher as unknown as typeof fetch,
      ownerCheck: async () => false,
    });
    expect(other.status).toBe(403);
    // No Vault read happens for a rejected caller.
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it('rejects a disallowed origin and a non-POST method', async () => {
    const foreign = await handleAutomationPush(request({ action: 'config' }, { Origin: 'https://evil.example' }), {
      fetcher: mocks.fetcher as unknown as typeof fetch,
      ownerCheck: async () => true,
    });
    expect(foreign.status).toBe(403);

    const get = await handleAutomationPush(new Request('https://project.supabase.co/functions/v1/automation-push', {
      method: 'GET', headers: { Origin: 'https://lixxonstudio.com' },
    }), { fetcher: mocks.fetcher as unknown as typeof fetch, ownerCheck: async () => true });
    expect(get.status).toBe(405);
  });

  it('returns the public key for config and never the private key', async () => {
    const response = await ownerRequest({ action: 'config' });
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      public_key: PUBLIC_KEY,
      subject: 'mailto:owner@lixxonstudio.com',
      private_key_configured: true,
      keys_ready: true,
      push_enabled: false,
    });
    expect(JSON.stringify(body)).not.toContain(PRIVATE_KEY);
  });

  it('requires an explicit confirmation before sending a test', async () => {
    const response = await ownerRequest({ action: 'test' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, reason: 'confirmation_required' });
    expect(mocks.fetcher).not.toHaveBeenCalled();
  });

  it('sends one fixed test notification per confirmed device and records the outcome', async () => {
    const recordCalls: string[] = [];
    const response = await ownerRequest({ action: 'test', confirm: true }, {
      targets: [{ id: DEVICE_ID, device_id: 'owner-device-abc', endpoint: ENDPOINT, p256dh: P256DH, auth_key: AUTH }],
      recordCalls,
    });
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, sent: 1, failed: 0, expired: 0, devices: 1, reason: 'delivered' });
    expect(recordCalls.some((call) => call.startsWith('push_record_test_delivery:') && call.includes('"p_status":"sent"'))).toBe(true);

    // The payload is the fixed test notification: no article, customer or key data.
    const [url, init] = mocks.fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^vapid t=[A-Za-z0-9_.-]+, k=[A-Za-z0-9_-]+$/);
    expect((init.headers as Record<string, string>)['Content-Encoding']).toBe('aes128gcm');
    // The body is a real encrypted record (salt + record size + sender key), never the plaintext.
    const sent = new Uint8Array(init.body as Uint8Array);
    expect(sent.byteLength).toBeGreaterThan(100);
    expect(new TextDecoder().decode(sent)).not.toContain('Test notification');
    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain(PRIVATE_KEY);
    expect(responseText).not.toContain(ENDPOINT);
    expect(responseText).not.toContain(P256DH);
    expect(responseText).not.toContain(AUTH);
    expect(responseText).not.toContain('push.example.test');
  });

  it('revokes an expired subscription and reports a truthful failure', async () => {
    const recordCalls: string[] = [];
    mocks.fetcher.mockResolvedValue(new Response(null, { status: 410 }));
    const response = await ownerRequest({ action: 'test', confirm: true }, {
      targets: [{ id: DEVICE_ID, device_id: 'owner-device-abc', endpoint: ENDPOINT, p256dh: P256DH, auth_key: AUTH }],
      recordCalls,
    });
    expect(await response.json()).toMatchObject({ ok: false, sent: 0, expired: 1, reason: 'delivered' });
    expect(recordCalls.some((call) => call.startsWith('push_record_delivery:') && call.includes('"p_status":"expired"'))).toBe(true);
    expect(recordCalls.some((call) => call.startsWith('push_record_test_delivery:') && call.includes('"p_status":"failed"'))).toBe(true);
  });

  it('refuses malformed device key material instead of sending anything', async () => {
    const recordCalls: string[] = [];
    const response = await ownerRequest({ action: 'test', confirm: true }, {
      targets: [{ id: DEVICE_ID, device_id: 'owner-device-abc', endpoint: ENDPOINT, p256dh: BOGUS_P256DH, auth_key: AUTH }],
      recordCalls,
    });
    expect(await response.json()).toMatchObject({ ok: false, sent: 0, reason: 'encryption_failed' });
    expect(mocks.fetcher).not.toHaveBeenCalled();
    expect(recordCalls.some((call) => call.startsWith('push_record_test_delivery:') && call.includes('"p_status":"failed"'))).toBe(true);
  });

  it('reports honest states for missing keys, no device, rate limiting and unavailable storage', async () => {
    const noDevice = await ownerRequest({ action: 'test', confirm: true }, { targets: [] });
    expect(await noDevice.json()).toMatchObject({ ok: false, reason: 'no_device' });

    const unavailable = await ownerRequest({ action: 'test', confirm: true }, { targetsError: true });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ ok: false, reason: 'unavailable' });

    mocks.rateLimit.mockResolvedValue(false);
    const limited = await ownerRequest({ action: 'test', confirm: true }, { targets: [] });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ ok: false, reason: 'rate_limited' });

    // Keys absent: no send attempt, and the failed outcome is still recorded.
    mocks.rateLimit.mockResolvedValue(true);
    const service = createService({ targets: [] });
    service.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_secret_get_internal') return { data: null, error: null };
      if (name === 'automation_feature_flags') return { data: { 'automation.push': false }, error: null };
      return { data: true, error: null };
    });
    mocks.service.mockReturnValue(service);
    const missing = await handleAutomationPush(request({ action: 'test', confirm: true }), {
      fetcher: mocks.fetcher as unknown as typeof fetch,
      ownerCheck: async () => true,
    });
    expect(await missing.json()).toMatchObject({ ok: false, reason: 'missing_keys' });
    expect(mocks.fetcher).not.toHaveBeenCalled();
  });

  it('rejects oversized and malformed bodies and unknown actions', async () => {
    const big = await ownerRequest({ action: 'config', padding: 'x'.repeat(2000) });
    expect(big.status).toBe(413);

    const unknown = await ownerRequest({ action: 'send-anything' });
    expect(unknown.status).toBe(400);

    const malformed = await handleAutomationPush(new Request('https://project.supabase.co/functions/v1/automation-push', {
      method: 'POST',
      headers: { Origin: 'https://lixxonstudio.com', Authorization: 'Bearer x' },
      body: 'not json',
    }), { fetcher: mocks.fetcher as unknown as typeof fetch, ownerCheck: async () => true });
    expect(malformed.status).toBe(400);
  });
});
