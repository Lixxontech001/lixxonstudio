import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverPendingDistributionFailureAlerts } from '../../supabase/functions/_shared/automationAlerts';

const EMAIL_KEY = 're_FAKE_DISTRIBUTION_ALERT_KEY';
const TELEGRAM_TOKEN = '123456:FAKE_DISTRIBUTION_ALERT_BOT';
const TELEGRAM_CHAT = '-1001234567890';
const ALERT_ID = 71;

function mockClient(handler: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(handler) } as never;
}

function alertRow(overrides: Record<string, unknown> = {}) {
  return {
    alert_id: ALERT_ID, channel_key: 'telegram', failure_class: 'authentication',
    safe_error_code: 'PROVIDER_AUTH', attempt_count: 1, ...overrides,
  };
}

function mockDenoEnv() {
  vi.stubGlobal('Deno', { env: { get: (name: string) => name === 'EMAIL_FROM' ? 'Lixxon Studio <alerts@example.com>' : undefined } });
}

afterEach(() => vi.unstubAllGlobals());

describe('distribution failure alerts', () => {
  it('sends a plain-English, redacted owner alert by email and completes the queue row', async () => {
    mockDenoEnv();
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const client = mockClient(async (name, args) => {
      calls.push([name, args]);
      if (name === 'automation_claim_distribution_failure_alerts') return { data: [alertRow()], error: null };
      if (name === 'automation_alert_recipients') return { data: [{ email: 'owner@example.com' }], error: null };
      if (name === 'automation_secret_get_internal' && args?.p_secret_name === 'resend_api_key') return { data: EMAIL_KEY, error: null };
      if (name === 'automation_complete_distribution_failure_alert') return { data: true, error: null };
      return { data: null, error: null };
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'safe-receipt', message: EMAIL_KEY }), { status: 200 }));

    const result = await deliverPendingDistributionFailureAlerts(client, fetcher);

    expect(result).toEqual([{ alertId: ALERT_ID, channel: 'email', failureClass: 'authentication', delivered: true }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${EMAIL_KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(['owner@example.com']);
    expect(body.text).toContain('Telegram is paused because its credentials were rejected or are missing.');
    expect(body.text).toContain('The approved Daily Kit is still available.');
    expect(body.text).not.toContain(EMAIL_KEY);
    expect(body.text).not.toContain('article body');
    expect(JSON.stringify(result)).not.toContain(EMAIL_KEY);
    expect(calls).toContainEqual(['automation_complete_distribution_failure_alert', {
      p_alert_id: ALERT_ID, p_status: 'delivered', p_delivery_channel: 'email',
    }]);
  });

  it('uses only the private Telegram fallback when owner email delivery is unavailable', async () => {
    const client = mockClient(async (name, args) => {
      if (name === 'automation_claim_distribution_failure_alerts') return { data: [alertRow({ failure_class: 'policy', safe_error_code: 'PROVIDER_REVIEW_REQUIRED' })], error: null };
      if (name === 'automation_alert_recipients') return { data: [{ email: 'owner@example.com' }], error: null };
      if (name === 'automation_secret_get_internal') {
        if (args?.p_secret_name === 'telegram_bot_token') return { data: TELEGRAM_TOKEN, error: null };
        if (args?.p_secret_name === 'telegram_chat_id') return { data: TELEGRAM_CHAT, error: null };
        return { data: null, error: null };
      }
      return { data: true, error: null };
    });
    const fetcher = vi.fn(async () => new Response('ignored provider body', { status: 200 }));

    const result = await deliverPendingDistributionFailureAlerts(client, fetcher);

    expect(result[0]).toMatchObject({ alertId: ALERT_ID, channel: 'telegram', failureClass: 'policy', delivered: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`);
    const body = JSON.parse(String(init.body));
    expect(body.chat_id).toBe(TELEGRAM_CHAT);
    expect(body.text).toContain('platform requires account review');
    expect(body.text).toContain('Daily Kit is still available');
    expect(JSON.stringify(result)).not.toContain(TELEGRAM_TOKEN);
  });

  it('records a blocked alert path honestly when no owner delivery key exists', async () => {
    const completed: unknown[] = [];
    const client = mockClient(async (name, args) => {
      if (name === 'automation_claim_distribution_failure_alerts') return { data: [alertRow()], error: null };
      if (name === 'automation_secret_get_internal') return { data: null, error: { message: EMAIL_KEY } };
      if (name === 'automation_complete_distribution_failure_alert') { completed.push(args); return { data: true, error: null }; }
      return { data: [{ email: 'owner@example.com' }], error: null };
    });
    const fetcher = vi.fn();

    const result = await deliverPendingDistributionFailureAlerts(client, fetcher);

    expect(result).toEqual([{ alertId: ALERT_ID, channel: 'none', failureClass: 'authentication', delivered: false }]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(completed).toEqual([{ p_alert_id: ALERT_ID, p_status: 'blocked', p_delivery_channel: 'none' }]);
  });

  it('ignores malformed rows without exposing raw failure text', async () => {
    const client = mockClient(async (name) => name === 'automation_claim_distribution_failure_alerts'
      ? { data: [alertRow({ channel_key: 'untrusted-provider-body', safe_error_code: EMAIL_KEY })], error: null }
      : { data: null, error: { message: EMAIL_KEY } });
    const fetcher = vi.fn();

    expect(await deliverPendingDistributionFailureAlerts(client, fetcher)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
