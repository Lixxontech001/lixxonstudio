import { describe, expect, it, vi } from 'vitest';
import {
  buildProviderCheckRequest,
  classifyProviderResponse,
  fetchProviderStatus,
  isAllowedAutomationOrigin,
  localCredentialCheck,
} from '../../supabase/functions/_shared/automationKeyChecks';

describe('server-side automation credential checks', () => {
  it('maps provider HTTP outcomes to safe result codes without needing response bodies', () => {
    expect(classifyProviderResponse(200)).toBe('ok');
    expect(classifyProviderResponse(204)).toBe('ok');
    expect(classifyProviderResponse(400)).toBe('invalid');
    expect(classifyProviderResponse(401)).toBe('invalid');
    expect(classifyProviderResponse(403)).toBe('invalid');
    expect(classifyProviderResponse(403, new Headers({ 'x-ratelimit-remaining': '0' }))).toBe('rate_limited');
    expect(classifyProviderResponse(429)).toBe('rate_limited');
    expect(classifyProviderResponse(503)).toBe('unavailable');
  });

  it('consumes provider bodies and returns only a safe status code', async () => {
    const secret = 'FAKE-PROVIDER-RESPONSE-SECRET';
    const response = new Response(JSON.stringify({ account: secret }), { status: 200 });
    const fetcher: typeof fetch = vi.fn(async () => response);
    const request = buildProviderCheckRequest('openai_api_key', 'FAKE-OPENAI-KEY')!;
    const status = await fetchProviderStatus(request, fetcher, 100);
    expect(status).toBe('ok');
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(response.bodyUsed).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(request.url, expect.objectContaining({
      method: 'GET', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    }));

    const rejected = new Response(`raw ${secret}`, { status: 401 });
    expect(await fetchProviderStatus(request, async () => rejected, 100)).toBe('invalid');
    expect(rejected.bodyUsed).toBe(true);
  });

  it('fails closed on a provider timeout or network exception', async () => {
    const request = buildProviderCheckRequest('openai_api_key', 'FAKE-OPENAI-KEY')!;
    const hangingFetch: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    expect(await fetchProviderStatus(request, hangingFetch, 5)).toBe('unavailable');
    expect(await fetchProviderStatus(request, async () => { throw new Error('network'); }, 100)).toBe('unavailable');
  });

  it('uses only HTTPS read-only requests and keeps bearer keys out of provider URLs', () => {
    const secret = 'FAKE-KEY-NEVER-RETURN-THIS';
    const providers = [
      'openai_api_key', 'gemini_api_key', 'anthropic_api_key', 'github_dispatch_token',
      'flutterwave_secret_key', 'resend_api_key', 'meta_access_token', 'threads_access_token',
      'tiktok_access_token', 'pinterest_access_token', 'linkedin_access_token', 'coverr_api_key',
    ];
    for (const name of providers) {
      const request = buildProviderCheckRequest(name, secret);
      expect(request).not.toBeNull();
      expect(new URL(request!.url).protocol).toBe('https:');
      expect(request!.init.method).toBe('GET');
      expect(request!.init.redirect).toBe('error');
      expect(request!.url).not.toContain(secret);
      expect((request!.init.headers as Record<string, string>)).toBeDefined();
    }
    expect(buildProviderCheckRequest('unsupported_secret', secret)).toBeNull();
  });

  it('uses the Telegram path format without returning token content to a caller', () => {
    const token = '12345:ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const request = buildProviderCheckRequest('telegram_bot_token', token)!;
    expect(request.url).toBe(`https://api.telegram.org/bot${token}/getMe`);
    expect(request.init.method).toBe('GET');
    expect(request.init.redirect).toBe('error');
    expect(localCredentialCheck('telegram_bot_token', token)).toBeNull();
    expect(localCredentialCheck('telegram_bot_token', 'bad')).toBe('invalid');
  });

  it('marks local-only values as local and does not make paid X API requests', () => {
    expect(localCredentialCheck('flutterwave_webhook_hash', '0123456789abcdef')).toBe('local_ok');
    expect(localCredentialCheck('vapid_private_key', 'A'.repeat(43))).toBe('local_ok');
    expect(localCredentialCheck('vapid_public_key', 'B'.repeat(87))).toBe('local_ok');
    expect(localCredentialCheck('vapid_subject', 'mailto:owner@example.com')).toBe('local_ok');
    expect(localCredentialCheck('x_access_token', 'FAKE-X-TOKEN-IS-LOCAL-ONLY')).toBe('local_ok');
    expect(buildProviderCheckRequest('x_access_token', 'FAKE-X-TOKEN-IS-LOCAL-ONLY')).toBeNull();
    expect(localCredentialCheck('vapid_private_key', 'too-short')).toBe('invalid');
    expect(localCredentialCheck('openai_api_key', 'FAKE')).toBeNull();
  });

  it('allows only the production, known preview and local development origins', () => {
    expect(isAllowedAutomationOrigin('https://lixxonstudio.com')).toBe(true);
    expect(isAllowedAutomationOrigin('https://www.lixxonstudio.com')).toBe(true);
    expect(isAllowedAutomationOrigin('https://lixxonstudio-git-arena-branch-team.vercel.app')).toBe(true);
    expect(isAllowedAutomationOrigin('https://5173-sandbox123.e2b.app')).toBe(true);
    expect(isAllowedAutomationOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedAutomationOrigin('https://evil.example')).toBe(false);
    expect(isAllowedAutomationOrigin('https://lixxonstudio.example')).toBe(false);
    expect(isAllowedAutomationOrigin('http://evil.example')).toBe(false);
    expect(isAllowedAutomationOrigin(null)).toBe(false);
    expect(isAllowedAutomationOrigin('https://custom.example', 'https://custom.example')).toBe(true);
  });
});
