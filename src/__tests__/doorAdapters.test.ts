import { describe, expect, it } from 'vitest';
import {
  sendDiscord,
  sendTelegram,
  validDiscordWebhook,
  type FetchLike,
} from '../../supabase/functions/_shared/doorAdapters';

const TOKEN = 'TOKEN-SECRET-123456';
const CHAT = '-1001234567890';
const HOOK = 'https://discord.com/api/webhooks/1111/HOOK-SECRET-abc';
const TEXT = 'New on the blog: Easy routine\nhttps://lixxonstudio.example/blog/easy-routine';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function recorder(response: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { fetchImpl, calls };
}

describe('Telegram: one message through the bot', () => {
  it('sends the message to the chat through the bot route, and returns the message id', async () => {
    const { fetchImpl, calls } = recorder(() => json({ ok: true, result: { message_id: 77 } }));
    const result = await sendTelegram({ token: TOKEN, chatId: CHAT }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: '77' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ chat_id: CHAT, text: TEXT, disable_web_page_preview: false });
  });

  it('a refused token or chat gives a plain reason with no token in it', async () => {
    const { fetchImpl } = recorder(() => json({ ok: false, description: 'Unauthorized' }, 401));
    const result = await sendTelegram({ token: TOKEN, chatId: CHAT }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'Telegram did not accept the bot token or the chat.' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('a limit gives a plain "try later"', async () => {
    const { fetchImpl } = recorder(() => json({ ok: false }, 429));
    expect(await sendTelegram({ token: TOKEN, chatId: CHAT }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Telegram is limiting posts. Try later.' });
  });

  it('an answer that is not ok is a plain failure, and the provider text is not repeated', async () => {
    const { fetchImpl } = recorder(() => json({ ok: false, description: `leaked ${TOKEN}` }, 500));
    const result = await sendTelegram({ token: TOKEN, chatId: CHAT }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'Telegram did not take the message.' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('a network failure and a timeout each give their own plain reason', async () => {
    const network = await sendTelegram({ token: TOKEN, chatId: CHAT }, TEXT, async () => {
      throw new TypeError(`fetch failed for ${TOKEN}`);
    });
    expect(network).toEqual({ ok: false, reason: 'Could not reach the door.' });
    expect(JSON.stringify(network)).not.toContain(TOKEN);

    const timeout = await sendTelegram({ token: TOKEN, chatId: CHAT }, TEXT, async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    expect(timeout).toEqual({ ok: false, reason: 'The door did not answer in time.' });
  });

  it('missing a token or a chat, it sends nothing', async () => {
    const { fetchImpl, calls } = recorder(() => json({ ok: true, result: {} }));
    expect(await sendTelegram({ token: '', chatId: CHAT }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Telegram is not connected yet.' });
    expect(await sendTelegram({ token: TOKEN, chatId: '' }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Telegram is not connected yet.' });
    expect(calls).toHaveLength(0);
  });
});

describe('Discord: one message through the channel webhook', () => {
  it('a Discord webhook address is https on a Discord host, on the webhook path', () => {
    expect(validDiscordWebhook(HOOK)).toBe(true);
    expect(validDiscordWebhook('https://discordapp.com/api/webhooks/1/x')).toBe(true);
    expect(validDiscordWebhook('http://discord.com/api/webhooks/1/x')).toBe(false);
    expect(validDiscordWebhook('https://evil.example/api/webhooks/1/x')).toBe(false);
    expect(validDiscordWebhook('https://discord.com/channels/1/2')).toBe(false);
    expect(validDiscordWebhook('not a url')).toBe(false);
  });

  it('a bad address is refused before any request, and the reason does not repeat it', async () => {
    const { fetchImpl, calls } = recorder(() => json({}));
    const result = await sendDiscord('https://evil.example/api/webhooks/1/HOOK-SECRET', TEXT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'The Discord webhook address is not in the right form.' });
    expect(JSON.stringify(result)).not.toContain('HOOK-SECRET');
    expect(calls).toHaveLength(0);
  });

  it('sends the content with wait=true, and returns the message id', async () => {
    const { fetchImpl, calls } = recorder(() => json({ id: '999' }, 200));
    const result = await sendDiscord(HOOK, TEXT, fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: '999' });
    expect(calls[0].url).toBe(`${HOOK}?wait=true`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ content: TEXT });
  });

  it('a 204 with no body is still a success, with no reference', async () => {
    const { fetchImpl } = recorder(() => new Response(null, { status: 204 }));
    expect(await sendDiscord(HOOK, TEXT, fetchImpl)).toEqual({ ok: true, externalRef: null });
  });

  it('a missing webhook (404) or a limit (429) gives a plain reason, never the address', async () => {
    const missing = await sendDiscord(HOOK, TEXT, recorder(() => json({}, 404)).fetchImpl);
    expect(missing).toEqual({ ok: false, reason: 'Discord did not find that webhook.' });
    const limited = await sendDiscord(HOOK, TEXT, recorder(() => json({}, 429)).fetchImpl);
    expect(limited).toEqual({ ok: false, reason: 'Discord is limiting posts. Try later.' });
    expect(JSON.stringify([missing, limited])).not.toContain('HOOK-SECRET');
  });

  it('missing the address, it sends nothing', async () => {
    const { fetchImpl, calls } = recorder(() => json({}));
    expect(await sendDiscord('', TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Discord is not connected yet.' });
    expect(calls).toHaveLength(0);
  });
});
