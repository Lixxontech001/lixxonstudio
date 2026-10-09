import { describe, expect, it } from 'vitest';
import { DOOR_IDS, DOORS, type DoorId } from '../../supabase/functions/_shared/doorRegistry';
import {
  DOOR_TEST_MESSAGE,
  doorTestMessage,
  testDoorConnection,
  type DoorTestStatus,
} from '../../supabase/functions/_shared/doorConnectionTests';
import type { FetchLike } from '../../supabase/functions/_shared/doorAdapters';

const VALUES: Record<DoorId, Record<string, string>> = {
  telegram: { telegram_bot_token: 'TG-TOKEN-SECRET', telegram_chat_id: '-100123' },
  discord: { discord_webhook_url: 'https://discord.com/api/webhooks/1/HOOK-SECRET?wait=true' },
  bluesky: { bluesky_handle: 'lixxon.bsky.social', bluesky_app_password: 'APP-PASS-SECRET' },
  mastodon: { mastodon_instance_url: 'https://mastodon.example', mastodon_access_token: 'MASTO-SECRET' },
  tumblr: {
    tumblr_consumer_key: 'TK-KEY',
    tumblr_consumer_secret: 'TK-CONSUMER-SECRET',
    tumblr_access_token: 'TK-ACCESS',
    tumblr_token_secret: 'TK-TOKEN-SECRET',
    tumblr_blog_name: 'lixxon',
  },
  blogger: {
    blogger_client_id: 'BL-CLIENT',
    blogger_client_secret: 'BL-CLIENT-SECRET',
    blogger_refresh_token: 'BL-REFRESH-SECRET',
    blogger_blog_id: '8070105920543249955',
  },
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fake network. `answer` returns the response for each URL. Every call is recorded. */
function network(answer: (url: string, method: string) => Response | 'throw') {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({
      url,
      method,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : '',
    });
    const response = answer(url, method);
    if (response === 'throw') throw new TypeError('network down');
    return response;
  };
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An answer that every door's check accepts, for the normal "works" path. */
function healthy(url: string): Response {
  if (url.startsWith('https://api.telegram.org/')) return json({ ok: true, result: { id: -100123 } });
  if (url.startsWith('https://discord.com/api/webhooks/')) return json({ id: '1', channel_id: '2' });
  if (url.endsWith('com.atproto.server.createSession')) return json({ accessJwt: 'JWT', did: 'did:plc:x' });
  if (url.endsWith('/api/v1/accounts/verify_credentials')) return json({ id: '9' });
  if (url.startsWith('https://api.tumblr.com/')) return json({ response: { blog: { name: 'lixxon' } } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'ACCESS' });
  if (url.startsWith('https://www.googleapis.com/blogger/v3/blogs/')) return json({ id: '8070105920543249955' });
  return new Response('unexpected', { status: 500 });
}

describe('every door check is a read: nothing is posted', () => {
  it('no request for any door reaches a posting address, and only sign-ins and token exchanges are POST', async () => {
    const seen: Call[] = [];
    for (const door of DOOR_IDS) {
      const { fetchImpl, calls } = network(healthy);
      const status = await testDoorConnection(door, VALUES[door], fetchImpl);
      expect(status, door).toBe('connected');
      seen.push(...calls);
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect(call.url, call.url).not.toMatch(/sendMessage|createRecord|\/statuses|\/posts/);
      if (call.method === 'POST') {
        const allowedPost = call.url.endsWith('com.atproto.server.createSession') || call.url === 'https://oauth2.googleapis.com/token';
        expect(allowedPost, call.url).toBe(true);
      }
    }
  });

  it('Telegram reads the chat (getChat), never sendMessage', async () => {
    const { fetchImpl, calls } = network(healthy);
    await testDoorConnection('telegram', VALUES.telegram, fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/getChat?chat_id=-100123');
    expect(calls[0].url).not.toContain('sendMessage');
  });

  it('Discord reads the webhook without its query, so nothing is sent', async () => {
    const { fetchImpl, calls } = network(healthy);
    await testDoorConnection('discord', VALUES.discord, fetchImpl);
    expect(calls).toEqual([expect.objectContaining({ url: 'https://discord.com/api/webhooks/1/HOOK-SECRET', method: 'GET' })]);
  });

  it('Blogger reads the blog record, never the posts collection', async () => {
    const { fetchImpl, calls } = network(healthy);
    await testDoorConnection('blogger', VALUES.blogger, fetchImpl);
    expect(calls.map((call) => call.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://www.googleapis.com/blogger/v3/blogs/8070105920543249955',
    ]);
    expect(calls[1].headers.Authorization).toBe('Bearer ACCESS');
  });

  it('Tumblr reads the blog info with an OAuth-signed GET', async () => {
    const { fetchImpl, calls } = network(healthy);
    await testDoorConnection('tumblr', VALUES.tumblr, fetchImpl);
    expect(calls[0].url).toBe('https://api.tumblr.com/v2/blog/lixxon.tumblr.com/info');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers.Authorization.startsWith('OAuth ')).toBe(true);
    expect(calls[0].headers.Authorization).not.toContain('TK-CONSUMER-SECRET');
    expect(calls[0].headers.Authorization).not.toContain('TK-TOKEN-SECRET');
  });
});

describe('a door that is not fully saved is not tested at all', () => {
  it('returns not_connected and makes no request', async () => {
    for (const door of DOOR_IDS) {
      if (Object.keys(VALUES[door]).length < 2) continue; // Discord has one field, so there is no partial state.
      const { fetchImpl, calls } = network(healthy);
      const partial = Object.fromEntries(Object.entries(VALUES[door]).slice(0, 1));
      expect(await testDoorConnection(door, partial, fetchImpl), door).toBe('not_connected');
      expect(calls, door).toHaveLength(0);
    }
  });

  it('an empty value counts as missing', async () => {
    const { fetchImpl, calls } = network(healthy);
    expect(await testDoorConnection('telegram', { telegram_bot_token: '', telegram_chat_id: '-1' }, fetchImpl)).toBe('not_connected');
    expect(calls).toHaveLength(0);
  });
});

describe('each door reports one plain status', () => {
  it('Telegram: a good chat is connected, a refused token is invalid, a limit is rate_limited', async () => {
    expect(await testDoorConnection('telegram', VALUES.telegram, network(healthy).fetchImpl)).toBe('connected');
    expect(await testDoorConnection('telegram', VALUES.telegram, network(() => json({ ok: false }, 401)).fetchImpl)).toBe('invalid');
    expect(await testDoorConnection('telegram', VALUES.telegram, network(() => json({ ok: false }, 200)).fetchImpl)).toBe('invalid');
    expect(await testDoorConnection('telegram', VALUES.telegram, network(() => json({}, 429)).fetchImpl)).toBe('rate_limited');
    expect(await testDoorConnection('telegram', VALUES.telegram, network(() => json({}, 500)).fetchImpl)).toBe('unavailable');
  });

  it('Discord: a bad address is refused before any request; a refused webhook is invalid', async () => {
    const bad = network(healthy);
    expect(await testDoorConnection('discord', { discord_webhook_url: 'https://evil.example/api/webhooks/1/x' }, bad.fetchImpl)).toBe('invalid');
    expect(bad.calls).toHaveLength(0);
    expect(await testDoorConnection('discord', VALUES.discord, network(() => json({}, 404)).fetchImpl)).toBe('invalid');
    expect(await testDoorConnection('discord', VALUES.discord, network(() => 'throw').fetchImpl)).toBe('unavailable');
  });

  it('Bluesky: signs in only; a bad handle is refused before any request; a wrong password is invalid', async () => {
    const bad = network(healthy);
    expect(await testDoorConnection('bluesky', { bluesky_handle: 'no-dot', bluesky_app_password: 'x' }, bad.fetchImpl)).toBe('invalid');
    expect(bad.calls).toHaveLength(0);
    const good = network(healthy);
    expect(await testDoorConnection('bluesky', VALUES.bluesky, good.fetchImpl)).toBe('connected');
    expect(good.calls.map((call) => call.url)).toEqual(['https://bsky.social/xrpc/com.atproto.server.createSession']);
    expect(await testDoorConnection('bluesky', VALUES.bluesky, network(() => json({}, 401)).fetchImpl)).toBe('invalid');
  });

  it('Mastodon: checks the account with the token; a bad server address is refused before any request', async () => {
    const good = network(healthy);
    expect(await testDoorConnection('mastodon', VALUES.mastodon, good.fetchImpl)).toBe('connected');
    expect(good.calls[0].url).toBe('https://mastodon.example/api/v1/accounts/verify_credentials');
    expect(good.calls[0].headers.Authorization).toBe('Bearer MASTO-SECRET');
    const bad = network(healthy);
    expect(await testDoorConnection('mastodon', { mastodon_instance_url: 'http://mastodon.example', mastodon_access_token: 'x' }, bad.fetchImpl)).toBe('invalid');
    expect(bad.calls).toHaveLength(0);
    expect(await testDoorConnection('mastodon', VALUES.mastodon, network(() => json({}, 403)).fetchImpl)).toBe('invalid');
  });

  it('Tumblr: a bad blog name is refused before any request; a refused key is invalid', async () => {
    const bad = network(healthy);
    expect(await testDoorConnection('tumblr', { ...VALUES.tumblr, tumblr_blog_name: 'bad name' }, bad.fetchImpl)).toBe('invalid');
    expect(bad.calls).toHaveLength(0);
    expect(await testDoorConnection('tumblr', VALUES.tumblr, network(() => json({}, 401)).fetchImpl)).toBe('invalid');
    expect(await testDoorConnection('tumblr', VALUES.tumblr, network(() => json({}, 404)).fetchImpl)).toBe('invalid');
  });

  it('Blogger: a refused refresh is invalid and stops there; a blog that cannot be read is invalid', async () => {
    const refused = network(() => json({ error: 'invalid_grant' }, 400));
    expect(await testDoorConnection('blogger', VALUES.blogger, refused.fetchImpl)).toBe('invalid');
    expect(refused.calls).toHaveLength(1);
    expect(
      await testDoorConnection('blogger', VALUES.blogger, network((url) => (url.includes('oauth2') ? json({ access_token: 'A' }) : json({}, 404))).fetchImpl),
    ).toBe('invalid');
    const bad = network(healthy);
    expect(await testDoorConnection('blogger', { ...VALUES.blogger, blogger_blog_id: 'abc/../x' }, bad.fetchImpl)).toBe('invalid');
    expect(bad.calls).toHaveLength(0);
  });
});

describe('the result never carries a value, a token, or the provider reply', () => {
  const SECRETS = Object.values(VALUES).flatMap((values) => Object.values(values));

  it('every status is one of the fixed words, and each has a plain line', () => {
    const statuses: DoorTestStatus[] = ['connected', 'invalid', 'not_connected', 'rate_limited', 'unavailable'];
    for (const status of statuses) {
      expect(doorTestMessage(status)).toBe(DOOR_TEST_MESSAGE[status]);
      expect(doorTestMessage(status)).not.toMatch(/—|Nigeria|Lagos|Naira|WAT/);
    }
  });

  it('a refusal whose body echoes a secret does not put that secret in the result', async () => {
    for (const door of DOOR_IDS) {
      const { fetchImpl } = network(() => new Response(`bad ${SECRETS.join(' ')}`, { status: 401 }));
      const status = await testDoorConnection(door, VALUES[door], fetchImpl);
      const shown = doorTestMessage(status);
      for (const secret of SECRETS) expect(shown).not.toContain(secret);
      expect(Object.keys(DOOR_TEST_MESSAGE)).toContain(status);
    }
  });

  it('a network failure is unavailable for every door, with no secret in the line', async () => {
    for (const door of DOOR_IDS) {
      const status = await testDoorConnection(door, VALUES[door], network(() => 'throw').fetchImpl);
      expect(status, door).toBe('unavailable');
    }
  });

  it('every door has a field list, so none is tested with a field left out', () => {
    for (const door of DOOR_IDS) {
      expect(DOORS[door].fields.length).toBeGreaterThan(0);
      expect(Object.keys(VALUES[door]).sort()).toEqual(DOORS[door].fields.map((field) => field.secretName).sort());
    }
  });
});
