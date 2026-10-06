import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caller: vi.fn(),
  rateLimit: vi.fn(),
  service: vi.fn(),
  ownerCheck: vi.fn(),
  fetcher: vi.fn(),
}));

vi.mock('../../supabase/functions/_shared/http.ts', () => ({
  callerUser: mocks.caller,
  EMAIL_RE: /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/,
  env: (name: string) => name === 'EMAIL_FROM' ? 'Lixxon Studio <verified@example.com>' : undefined,
  rateLimit: mocks.rateLimit,
  serviceClient: mocks.service,
}));

import { handleAutomationDistribution } from '../../supabase/functions/automation-distribution/handler';

const RECIPIENT = 'owner@example.com';
const KEY = 'TEST-RESEND-SECRET-DO-NOT-RETURN';
const SENTINEL = 'Owner-approved distribution excerpt only';
const DRAFT_ID = '85000000-0000-4000-8000-000000000002';
const HASH = 'a'.repeat(64);

function payload() {
  return {
    title: 'Owner title',
    subject: 'Owner subject',
    caption: SENTINEL,
    link: `https://lixxonstudio.com/blog/owner-story?utm_source=newsletter&utm_medium=email&utm_campaign=owner-story`,
    image_url: null,
    image_alt: '',
  };
}

function request(body: unknown) {
  return new Request('https://project.supabase.co/functions/v1/automation-distribution', {
    method: 'POST',
    headers: { Origin: 'https://lixxonstudio.com', Authorization: 'Bearer verified-user-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createService(options: { claimError?: boolean } = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'automation_secret_get_internal') return { data: KEY, error: null };
    if (name === 'automation_claim_newsletter_test') return options.claimError
      ? { data: null, error: new Error('private database details') }
      : { data: { ok: true, already_sent: false, test_id: 17, payload: payload() }, error: null };
    if (name === 'automation_complete_newsletter_test') return { data: true, error: null };
    return { data: null, error: null };
  });
  return { rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caller.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000001',
    email: RECIPIENT,
    email_confirmed_at: '2026-10-01T00:00:00.000Z',
  });
  mocks.rateLimit.mockResolvedValue(true);
  mocks.ownerCheck.mockResolvedValue(true);
  mocks.service.mockReturnValue(createService());
  mocks.fetcher.mockResolvedValue(new Response(JSON.stringify({ id: 'resend-receipt-17', to: [RECIPIENT], message: KEY }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
});

describe('owner-only newsletter test delivery handler', () => {
  it('sends only to the verified caller email and returns a redacted receipt', async () => {
    const response = await handleAutomationDistribution(request({
      action: 'test_newsletter', channel: 'newsletter', draft_id: DRAFT_ID, payload_sha256: HASH,
    }), {
      caller: mocks.caller,
      service: mocks.service,
      fetcher: mocks.fetcher,
      siteOrigin: origin => origin === 'https://lixxonstudio.com',
      ownerCheck: mocks.ownerCheck,
      emailFrom: () => 'Lixxon Studio <verified@example.com>',
    });

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, sent: true, alreadySent: false, testEmailId: 'resend-receipt-17' });
    expect(JSON.stringify(body)).not.toContain(RECIPIENT);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(mocks.fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetcher.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(url).toBe('https://api.resend.com/emails');
    expect(sent.to).toEqual([RECIPIENT]);
    expect(sent.subject).toBe('[TEST] Owner subject');
    expect(sent.text).toContain(SENTINEL);
    expect(sent.text).not.toContain('full article body');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(url).not.toContain(KEY);
    expect(sent.to).not.toContain('subscriber@example.com');
  });

  it('fails closed for an unconfirmed owner email or a database claim failure', async () => {
    mocks.caller.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000001', email: RECIPIENT, email_confirmed_at: null,
    });
    const unconfirmed = await handleAutomationDistribution(request({ action: 'test_newsletter', channel: 'newsletter' }), {
      caller: mocks.caller, service: mocks.service, fetcher: mocks.fetcher,
      siteOrigin: () => true, ownerCheck: mocks.ownerCheck,
    });
    expect(unconfirmed.status).toBe(409);
    expect(mocks.fetcher).not.toHaveBeenCalled();

    mocks.service.mockReturnValue(createService({ claimError: true }));
    const claimFailure = await handleAutomationDistribution(request({
      action: 'test_newsletter', channel: 'newsletter', draft_id: DRAFT_ID, payload_sha256: HASH,
    }), {
      caller: mocks.caller, service: mocks.service, fetcher: mocks.fetcher,
      siteOrigin: () => true, ownerCheck: mocks.ownerCheck,
    });
    expect(claimFailure.status).toBe(409);
    const safeError = await claimFailure.json();
    expect(JSON.stringify(safeError)).not.toContain('private database details');
    expect(mocks.fetcher).not.toHaveBeenCalled();
  });
});
