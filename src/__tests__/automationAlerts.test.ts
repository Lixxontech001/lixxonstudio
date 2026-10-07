import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverPendingAutomationFailureAlerts } from '../../supabase/functions/_shared/automationAlerts';

const RUN_ID = '8b7c9a31-1f82-4e92-9c74-fb8de10a63f7';
const RESEND_KEY = 're_FAKE_AUTOMATION_SECRET_DO_NOT_LOG';
const TELEGRAM_TOKEN = '123456:FAKE_TELEGRAM_BOT_TOKEN_DO_NOT_LOG';
const TELEGRAM_CHAT = '-1001234567890';

type RpcHandler = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
function mockClient(handler: RpcHandler) {
  return { rpc: vi.fn(handler) } as never;
}
function failureClaim(code = 'RUNNER_STEP_FAILED', event: 'dispatch_failed' | 'pipeline_failed' = 'pipeline_failed') {
  return [{ run_id: RUN_ID, safe_error_code: code, event }];
}
function mockDenoEnv() {
  vi.stubGlobal('Deno', { env: { get: (name: string) => name === 'EMAIL_FROM' ? 'Lixxon Studio <alerts@example.com>' : undefined } });
}

afterEach(() => vi.unstubAllGlobals());

describe('automation failure alerts', () => {
  it('delivers safe run metadata by email without including article prose or returning key material', async () => {
    mockDenoEnv();
    const logs: unknown[] = [];
    const rpc = mockClient(async (name, args) => {
      if (name === 'automation_claim_failure_alerts') return { data: failureClaim(), error: null };
      if (name === 'automation_alert_recipients') return { data: [{ email: 'owner@example.com' }], error: null };
      if (name === 'automation_secret_get_internal' && args?.p_secret_name === 'resend_api_key') return { data: RESEND_KEY, error: null };
      if (name === 'automation_write_log') { logs.push(args); return { data: 1, error: null }; }
      return { data: null, error: { message: 'not configured' } };
    });
    const fetcher = vi.fn(async () => new Response('provider response must not be read', { status: 200 }));

    const delivered = await deliverPendingAutomationFailureAlerts(rpc, fetcher);

    expect(delivered).toEqual([{ runId: RUN_ID, event: 'pipeline_failed', channel: 'email', delivered: true }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${RESEND_KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(['owner@example.com']);
    expect(body.text).toContain('Safe failure code: RUNNER_STEP_FAILED');
    expect(body.text).toContain(RUN_ID);
    expect(body.text).not.toContain('Owner-authored article prose');
    expect(body.text).not.toContain(RESEND_KEY);
    expect(delivered[0]).not.toHaveProperty('secret');
    expect(JSON.stringify(logs)).not.toContain(RESEND_KEY);
    expect(JSON.stringify(logs)).not.toContain('owner@example.com');
  });

  it('falls back to a private Telegram chat after email fails and ignores provider response bodies', async () => {
    mockDenoEnv();
    const logs: unknown[] = [];
    const rpc = mockClient(async (name, args) => {
      if (name === 'automation_claim_failure_alerts') return { data: failureClaim('GITHUB_TOKEN_MISSING', 'dispatch_failed'), error: null };
      if (name === 'automation_alert_recipients') return { data: [{ email: 'owner@example.com' }], error: null };
      if (name === 'automation_secret_get_internal') {
        if (args?.p_secret_name === 'resend_api_key') return { data: RESEND_KEY, error: null };
        if (args?.p_secret_name === 'telegram_bot_token') return { data: TELEGRAM_TOKEN, error: null };
        if (args?.p_secret_name === 'telegram_chat_id') return { data: TELEGRAM_CHAT, error: null };
      }
      if (name === 'automation_write_log') { logs.push(args); return { data: 1, error: null }; }
      return { data: null, error: null };
    });
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      return url.includes('resend.com')
        ? new Response(RESEND_KEY, { status: 503 })
        : new Response(TELEGRAM_TOKEN, { status: 200 });
    });

    const delivered = await deliverPendingAutomationFailureAlerts(rpc, fetcher);

    expect(delivered).toEqual([{ runId: RUN_ID, event: 'dispatch_failed', channel: 'telegram', delivered: true }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const telegramCall = fetcher.mock.calls.map(call => [String(call[0]), call[1] as RequestInit] as const)
      .find(([url]) => url.includes('api.telegram.org'));
    expect(telegramCall).toBeDefined();
    expect(telegramCall?.[0]).toBe(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`);
    const telegramBody = JSON.parse(String(telegramCall?.[1].body));
    expect(telegramBody.chat_id).toBe(TELEGRAM_CHAT);
    expect(telegramBody.text).toContain('GITHUB_TOKEN_MISSING');
    expect(telegramBody.text).toContain(RUN_ID);
    expect(JSON.stringify(logs)).not.toContain(RESEND_KEY);
    expect(JSON.stringify(logs)).not.toContain(TELEGRAM_TOKEN);
    expect(JSON.stringify(logs)).not.toContain(TELEGRAM_CHAT);
  });

  it('records an unconfigured alert path as blocked without calling a provider', async () => {
    mockDenoEnv();
    const logs: unknown[] = [];
    const rpc = mockClient(async (name, args) => {
      if (name === 'automation_claim_failure_alerts') return { data: failureClaim(), error: null };
      if (name === 'automation_alert_recipients') return { data: [{ email: 'owner@example.com' }], error: null };
      if (name === 'automation_secret_get_internal') return { data: null, error: { message: 'not configured' } };
      if (name === 'automation_write_log') { logs.push(args); return { data: 1, error: null }; }
      return { data: null, error: null };
    });
    const fetcher = vi.fn();

    const delivered = await deliverPendingAutomationFailureAlerts(rpc, fetcher);

    expect(delivered[0]).toMatchObject({ channel: 'none', delivered: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).toContain('blocked');
  });

  it('ignores malformed claimed rows and handles a failed claim without leaking errors', async () => {
    const rpc = mockClient(async (name) => {
      if (name === 'automation_claim_failure_alerts') return {
        data: [{ run_id: 'not-a-uuid', safe_error_code: 'RAW_PROVIDER_ERROR', event: 'pipeline_failed' }],
        error: null,
      };
      return { data: null, error: { message: RESEND_KEY } };
    });
    const fetcher = vi.fn();
    const invalid = await deliverPendingAutomationFailureAlerts(rpc, fetcher);
    expect(invalid).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();

    const unavailable = await deliverPendingAutomationFailureAlerts(mockClient(async () => ({ data: null, error: { message: RESEND_KEY } })), fetcher);
    expect(unavailable).toEqual([]);
    expect(JSON.stringify(unavailable)).not.toContain(RESEND_KEY);
  });
});
