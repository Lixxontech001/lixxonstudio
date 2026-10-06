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
import { parseDistributionReadback } from '../../supabase/functions/_shared/distributionAdapters';

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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
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

  it('runs mocked readbacks for all 13 channel outcomes and keeps manual-only channels network-silent', async () => {
    const privateProviderDetail = 'FAKE_PROVIDER_ACCOUNT_DETAIL_DO_NOT_RETURN';
    const telegramToken = '12345:AAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const chatId = '-1001234567890';
    const scenarios: Array<{
      channel: string;
      credentials: Record<string, string>;
      providerBody?: unknown;
      expectedState: 'connected' | 'manual_kit';
      expectedRequests: number;
    }> = [
      { channel: 'instagram', credentials: { meta_access_token: 'FAKE_META_TOKEN', instagram_user_id: '17841400000000001' }, providerBody: { id: '17841400000000001', username: privateProviderDetail }, expectedState: 'connected', expectedRequests: 1 },
      { channel: 'facebook', credentials: { meta_access_token: 'FAKE_META_TOKEN', facebook_page_id: '123456789' }, providerBody: { id: '123456789', name: privateProviderDetail }, expectedState: 'connected', expectedRequests: 1 },
      { channel: 'youtube_shorts', credentials: { youtube_client_id: 'FAKE_YOUTUBE_CLIENT', youtube_client_secret: 'FAKE_YOUTUBE_SECRET', youtube_refresh_token: 'FAKE_YOUTUBE_REFRESH' }, providerBody: { items: [{ id: 'youtube-channel-id', snippet: privateProviderDetail }] }, expectedState: 'connected', expectedRequests: 2 },
      { channel: 'tiktok', credentials: { tiktok_access_token: 'FAKE_TIKTOK_TOKEN' }, providerBody: { data: { user: { open_id: 'tiktok-open-id', display_name: privateProviderDetail } }, error: { code: 'ok', message: 'ok' } }, expectedState: 'connected', expectedRequests: 1 },
      { channel: 'pinterest', credentials: { pinterest_access_token: 'FAKE_PINTEREST_TOKEN', pinterest_board_id: '987654321' }, providerBody: { id: '987654321', name: privateProviderDetail }, expectedState: 'connected', expectedRequests: 1 },
      { channel: 'telegram', credentials: { telegram_bot_token: telegramToken, telegram_chat_id: chatId }, providerBody: { ok: true, result: { id: Number(chatId), title: privateProviderDetail, username: privateProviderDetail } }, expectedState: 'connected', expectedRequests: 1 },
      { channel: 'threads', credentials: { threads_access_token: 'FAKE_THREADS_TOKEN', threads_user_id: '123456789' }, providerBody: { id: '123456789', username: privateProviderDetail }, expectedState: 'connected', expectedRequests: 1 },
      { channel: 'linkedin', credentials: { linkedin_access_token: 'FAKE_LINKEDIN_TOKEN', linkedin_organization_id: '123456' }, providerBody: { id: '123456', localizedName: privateProviderDetail }, expectedState: 'connected', expectedRequests: 1 },
      { channel: 'x', credentials: { x_api_key: 'FAKE_X_KEY', x_api_secret: 'FAKE_X_SECRET', x_access_token: 'FAKE_X_ACCESS', x_access_token_secret: 'FAKE_X_TOKEN_SECRET' }, expectedState: 'manual_kit', expectedRequests: 0 },
      { channel: 'tumblr', credentials: { tumblr_consumer_key: 'FAKE_TUMBLR_KEY', tumblr_consumer_secret: 'FAKE_TUMBLR_SECRET', tumblr_access_token: 'FAKE_TUMBLR_ACCESS', tumblr_token_secret: 'FAKE_TUMBLR_TOKEN_SECRET', tumblr_blog_identifier: 'lixxon.tumblr.com' }, expectedState: 'manual_kit', expectedRequests: 0 },
      { channel: 'whatsapp', credentials: { whatsapp_access_token: 'FAKE_WHATSAPP_TOKEN', whatsapp_phone_number_id: '123456789' }, providerBody: { id: '123456789', verified_name: privateProviderDetail, display_phone_number: '+10000000000' }, expectedState: 'connected', expectedRequests: 1 },
      { channel: 'newsletter', credentials: { resend_api_key: 'FAKE_RESEND_TOKEN' }, providerBody: { data: [{ name: 'lixxonstudio.com', status: 'verified', id: privateProviderDetail }] }, expectedState: 'connected', expectedRequests: 1 },
      { channel: 'site_widget', credentials: {}, expectedState: 'manual_kit', expectedRequests: 0 },
    ];

    for (const scenario of scenarios) {
      const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
        if (name === 'automation_secret_get_internal') {
          return { data: scenario.credentials[String(args?.p_secret_name)] ?? null, error: null };
        }
        if (name === 'automation_record_channel_readback') return { data: true, error: null };
        if (name === 'automation_claim_distribution_failure_alerts') return { data: [], error: null };
        return { data: null, error: null };
      });
      const service = { rpc };
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        if (scenario.channel === 'youtube_shorts' && String(input) === 'https://oauth2.googleapis.com/token') {
          return jsonResponse({ access_token: 'FAKE_SHORT_LIVED_YOUTUBE_TOKEN' });
        }
        return jsonResponse(scenario.providerBody);
      });
      if (scenario.channel === 'instagram') {
        expect(await parseDistributionReadback('instagram', jsonResponse(scenario.providerBody), '17841400000000001'))
          .toEqual({ status: 'connected', code: 'PROVIDER_READBACK_OK' });
      }
      const response = await handleAutomationDistribution(request({ action: 'check', channel: scenario.channel }), {
        caller: mocks.caller,
        service: (() => service) as never,
        fetcher: fetcher as typeof fetch,
        siteOrigin: origin => origin === 'https://lixxonstudio.com',
        ownerCheck: mocks.ownerCheck,
      });
      const body = await response.json();
      expect(response.status, scenario.channel).toBe(200);
      expect(body.channel, scenario.channel).toBe(scenario.channel);
      expect(body.state, `${scenario.channel}: ${JSON.stringify({ body, requests: fetcher.mock.calls.map(([input]) => String(input)) })}`).toBe(scenario.expectedState);
      expect(JSON.stringify(body)).not.toContain(privateProviderDetail);
      expect(fetcher).toHaveBeenCalledTimes(scenario.expectedRequests);

      if (scenario.expectedState === 'connected') {
        expect(body.message).toContain('Per-item approval is still required.');
        expect(rpc).toHaveBeenCalledWith('automation_record_channel_readback', expect.objectContaining({
          p_channel_key: scenario.channel, p_status: 'connected', p_safe_code: 'PROVIDER_READBACK_OK',
        }));
      } else {
        expect(body.message).toMatch(/manual|local-only/);
        expect(rpc).not.toHaveBeenCalledWith('automation_record_channel_readback', expect.anything());
      }
    }
  });
});
