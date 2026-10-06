import { describe, expect, it } from 'vitest';
import {
  buildDistributionReadback,
  parseDistributionReadback,
  parseResendReceipt,
  parseTelegramChatReadback,
  parseTelegramReceipt,
} from '../../supabase/functions/_shared/distributionAdapters';

const TOKEN = 'FAKE-DISTRIBUTION-SECRET-NEVER-RETURN';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('distribution provider adapters', () => {
  it('builds fixed HTTPS read-only requests and keeps bearer tokens out of URLs', () => {
    const cases = [
      ['instagram', { meta_access_token: TOKEN, instagram_user_id: '17841400000000001' }],
      ['facebook', { meta_access_token: TOKEN, facebook_page_id: '123456789' }],
      ['threads', { threads_access_token: TOKEN, threads_user_id: '123456789' }],
      ['tiktok', { tiktok_access_token: TOKEN }],
      ['pinterest', { pinterest_access_token: TOKEN, pinterest_board_id: '987654321' }],
      ['linkedin', { linkedin_access_token: TOKEN, linkedin_organization_id: '123456' }],
      ['whatsapp', { whatsapp_access_token: TOKEN, whatsapp_phone_number_id: '123456789' }],
      ['newsletter', { resend_api_key: TOKEN }],
    ] as const;

    for (const [channel, credentials] of cases) {
      const request = buildDistributionReadback(channel, credentials);
      expect(request).not.toBeNull();
      expect(new URL(request!.url).protocol).toBe('https:');
      expect(request!.init.method).toBe('GET');
      expect(request!.init.redirect).toBe('error');
      expect(request!.init.cache).toBe('no-store');
      expect(request!.url).not.toContain(TOKEN);
      // The credential belongs only in the server-side bearer header, never a provider URL.
      expect((request!.init.headers as Record<string, string>).Authorization).toContain(TOKEN);
    }
  });

  it('keeps X and Tumblr manual-only and rejects malformed Telegram credentials without a request', () => {
    expect(buildDistributionReadback('x', {
      x_api_key: 'key', x_api_secret: 'secret', x_access_token: 'access', x_access_token_secret: 'token-secret',
    })).toBeNull();
    expect(buildDistributionReadback('tumblr', {
      tumblr_consumer_key: 'key', tumblr_consumer_secret: 'secret', tumblr_access_token: 'access',
      tumblr_token_secret: 'token-secret', tumblr_blog_identifier: 'blog.tumblr.com',
    })).toBeNull();
    expect(buildDistributionReadback('telegram', { telegram_bot_token: 'bad', telegram_chat_id: '12345' })).toBeNull();
  });

  it('requires the provider to confirm the expected account resource instead of trusting HTTP 200', async () => {
    const expectedId = '17841400000000001';
    expect(await parseDistributionReadback('instagram', jsonResponse({ id: expectedId, username: 'private-account' }), expectedId))
      .toEqual({ status: 'connected', code: 'PROVIDER_READBACK_OK' });
    expect(await parseDistributionReadback('instagram', jsonResponse({ id: 'different-account' }), expectedId))
      .toEqual({ status: 'unavailable', code: 'PROVIDER_UNEXPECTED' });

    const privateError = 'FAKE-PROVIDER-ERROR-SECRET';
    const denied = await parseDistributionReadback('instagram', jsonResponse({ error: { code: 190, message: privateError } }), expectedId);
    expect(denied).toEqual({ status: 'blocked_by_provider_review', code: 'PROVIDER_AUTH' });
    expect(JSON.stringify(denied)).not.toContain(privateError);

    expect(await parseDistributionReadback('tiktok', jsonResponse({
      data: { user: { open_id: 'user-id' } }, error: { code: 'ok', message: 'ok' },
    }))).toEqual({ status: 'connected', code: 'PROVIDER_READBACK_OK' });
    expect(await parseDistributionReadback('tiktok', jsonResponse({
      data: { user: {} }, error: { code: 'access_token_invalid', message: privateError },
    }))).toEqual({ status: 'blocked_by_provider_review', code: 'PROVIDER_AUTH' });
    expect(await parseDistributionReadback('newsletter', jsonResponse({ data: [] })))
      .toEqual({ status: 'blocked_by_provider_review', code: 'PROVIDER_REVIEW_REQUIRED' });
    expect(await parseDistributionReadback('newsletter', jsonResponse({ data: [{ name: 'lixxonstudio.com', status: 'not_started' }] })))
      .toEqual({ status: 'blocked_by_provider_review', code: 'PROVIDER_REVIEW_REQUIRED' });
    expect(await parseDistributionReadback('newsletter', jsonResponse({ data: [{ name: 'lixxonstudio.com', status: 'verified' }] })))
      .toEqual({ status: 'connected', code: 'PROVIDER_READBACK_OK' });

    const emailReceipt = await parseResendReceipt(jsonResponse({ id: 'resend-test-42', to: [TOKEN], message: TOKEN }));
    expect(emailReceipt).toEqual({ ok: true, remoteMessageId: 'resend-test-42', safeStatus: 'connected', safeCode: 'PROVIDER_READBACK_OK' });
    expect(JSON.stringify(emailReceipt)).not.toContain(TOKEN);
    expect((await parseResendReceipt(jsonResponse({ id: TOKEN.slice(0, 4), message: TOKEN }, 403))).safeCode)
      .toBe('PROVIDER_REVIEW_REQUIRED');
  });

  it('confirms only the configured Telegram chat and returns only a bounded message receipt', async () => {
    const chatId = '-1001234567890';
    expect(await parseTelegramChatReadback(jsonResponse({
      ok: true, result: { id: Number(chatId), title: 'Private owner channel', type: 'channel' },
    }), chatId)).toEqual({ status: 'connected', code: 'PROVIDER_READBACK_OK' });
    expect(await parseTelegramChatReadback(jsonResponse({ ok: true, result: { id: 77, title: TOKEN } }), chatId))
      .toEqual({ status: 'unavailable', code: 'PROVIDER_UNEXPECTED' });

    const receipt = await parseTelegramReceipt(jsonResponse({
      ok: true,
      result: { message_id: 42, chat: { id: Number(chatId), title: 'Private owner channel' }, text: TOKEN },
    }), chatId);
    expect(receipt).toEqual({
      ok: true, remoteMessageId: '42', safeStatus: 'connected', safeCode: 'PROVIDER_READBACK_OK',
    });
    expect(JSON.stringify(receipt)).not.toContain(TOKEN);
    expect((await parseTelegramReceipt(jsonResponse({
      ok: true, result: { message_id: 43, chat: { id: 77 }, text: 'not the configured chat' },
    }), chatId)).ok).toBe(false);
  });
});
