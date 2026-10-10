import { describe, expect, it } from 'vitest';
import {
  blueskyLinkFacets,
  mastodonOrigin,
  sendBluesky,
  sendMastodon,
  type FetchLike,
} from '../../supabase/functions/_shared/doorAdapters';

const PASSWORD = 'APP-PASS-SECRET-1234';
const JWT = 'JWT-SECRET-5678';
const HANDLE = 'lixxon.bsky.social';
const DID = 'did:plc:abc123';
const URL_TEXT = 'https://lixxonstudio.example/blog/easy-routine';
const TEXT = `New on the blog: Easy routine for dry skin\n${URL_TEXT}`;
const TOKEN = 'MASTO-TOKEN-SECRET';
const INSTANCE = 'https://mastodon.example';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Answers each Bluesky call by its address. Records every call. */
function bluesky(answers: { session?: () => Response; record?: () => Response }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('com.atproto.server.createSession')) {
      return answers.session ? answers.session() : json({ accessJwt: JWT, did: DID });
    }
    return answers.record ? answers.record() : json({ uri: `at://${DID}/app.bsky.feed.post/3kabc`, cid: 'c' });
  };
  return { fetchImpl, calls };
}

describe('Bluesky: sign in with the app password, then write one post', () => {
  it('signs in at the Bluesky server, then writes an app.bsky.feed.post record, and returns the post address', async () => {
    const { fetchImpl, calls } = bluesky({});
    const result = await sendBluesky({ handle: HANDLE, appPassword: PASSWORD }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: `at://${DID}/app.bsky.feed.post/3kabc` });
    expect(calls.map((call) => call.url)).toEqual([
      'https://bsky.social/xrpc/com.atproto.server.createSession',
      'https://bsky.social/xrpc/com.atproto.repo.createRecord',
    ]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ identifier: HANDLE, password: PASSWORD });
    const headers = calls[1].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${JWT}`);
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.repo).toBe(DID);
    expect(body.collection).toBe('app.bsky.feed.post');
    expect(body.record.$type).toBe('app.bsky.feed.post');
    expect(body.record.text).toBe(TEXT);
    expect(typeof body.record.createdAt).toBe('string');
  });

  it('a leading @ and capitals in the handle are accepted and tidied', async () => {
    const { fetchImpl, calls } = bluesky({});
    await sendBluesky({ handle: '@Lixxon.bsky.social', appPassword: PASSWORD }, TEXT, fetchImpl);
    expect(JSON.parse(String(calls[0].init.body)).identifier).toBe(HANDLE);
  });

  it('a handle in the wrong form is refused before any request', async () => {
    for (const handle of ['no-dot', 'bad handle.example', '-x.bsky.social', 'a..b.example', 'x'.repeat(260) + '.example']) {
      const { fetchImpl, calls } = bluesky({});
      const result = await sendBluesky({ handle, appPassword: PASSWORD }, TEXT, fetchImpl);
      expect(result, handle).toEqual({ ok: false, reason: 'The Bluesky handle is not in the right form.' });
      expect(calls).toHaveLength(0);
    }
  });

  it('a refused sign-in gives a plain reason and no password', async () => {
    const { fetchImpl, calls } = bluesky({ session: () => json({ error: `bad ${PASSWORD}` }, 401) });
    const result = await sendBluesky({ handle: HANDLE, appPassword: PASSWORD }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'Bluesky did not accept the handle or the app password.' });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(calls).toHaveLength(1);
  });

  it('a sign-in that is limited is a plain "try later"', async () => {
    const { fetchImpl } = bluesky({ session: () => json({}, 429) });
    expect(await sendBluesky({ handle: HANDLE, appPassword: PASSWORD }, TEXT, fetchImpl)).toEqual({
      ok: false,
      reason: 'Bluesky is limiting sign-ins. Try later.',
    });
  });

  it('a refused post gives a plain reason, and the session token never appears in it', async () => {
    const { fetchImpl } = bluesky({ record: () => json({ message: `no ${JWT}` }, 400) });
    const result = await sendBluesky({ handle: HANDLE, appPassword: PASSWORD }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'Bluesky did not take the post.' });
    expect(JSON.stringify(result)).not.toContain(JWT);
  });

  it('an expired session on the post is a plain reason', async () => {
    const { fetchImpl } = bluesky({ record: () => json({}, 401) });
    expect(await sendBluesky({ handle: HANDLE, appPassword: PASSWORD }, TEXT, fetchImpl)).toEqual({
      ok: false,
      reason: 'Bluesky did not accept the session.',
    });
  });

  it('a network failure is a plain reason, with no password in it', async () => {
    const result = await sendBluesky({ handle: HANDLE, appPassword: PASSWORD }, TEXT, async () => {
      throw new TypeError(`failed ${PASSWORD}`);
    });
    expect(result).toEqual({ ok: false, reason: 'Could not reach the door.' });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it('missing a handle or a password, it sends nothing', async () => {
    const { fetchImpl, calls } = bluesky({});
    expect(await sendBluesky({ handle: '', appPassword: PASSWORD }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Bluesky is not connected yet.' });
    expect(await sendBluesky({ handle: HANDLE, appPassword: '' }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Bluesky is not connected yet.' });
    expect(calls).toHaveLength(0);
  });
});

describe('Bluesky: the link is a facet, so it is clickable', () => {
  it('the facet covers the URL at the end of the text, counted in bytes', () => {
    const [facet] = blueskyLinkFacets(TEXT);
    const bytes = new TextEncoder().encode(TEXT);
    const start = (facet.index as { byteStart: number }).byteStart;
    const end = (facet.index as { byteEnd: number }).byteEnd;
    expect(new TextDecoder().decode(bytes.slice(start, end))).toBe(URL_TEXT);
    expect(facet.features).toEqual([{ $type: 'app.bsky.richtext.facet#link', uri: URL_TEXT }]);
  });

  it('the byte count is right after multi-byte characters', () => {
    const text = `Café ☕ tea\n${URL_TEXT}`;
    const [facet] = blueskyLinkFacets(text);
    const bytes = new TextEncoder().encode(text);
    expect(new TextDecoder().decode(bytes.slice((facet.index as { byteStart: number }).byteStart, (facet.index as { byteEnd: number }).byteEnd))).toBe(URL_TEXT);
  });

  it('text with no link at the end has no facet', () => {
    expect(blueskyLinkFacets('Just words')).toEqual([]);
  });
});

describe('Mastodon: one status with the access token', () => {
  it('posts the status to the server with the token and an idempotency key, and returns the status id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await sendMastodon({ instanceUrl: `${INSTANCE}/`, accessToken: TOKEN }, TEXT, 'row-1', async (url, init) => {
      calls.push({ url, init });
      return json({ id: '112233', url: `${INSTANCE}/@lixxon/112233` });
    });
    expect(result).toEqual({ ok: true, externalRef: '112233' });
    expect(calls[0].url).toBe(`${INSTANCE}/api/v1/statuses`);
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['Idempotency-Key']).toBe('row-1');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ status: TEXT });
  });

  it('the server address must be https, with no path, query or user name', () => {
    expect(mastodonOrigin('https://mastodon.social')).toBe('https://mastodon.social');
    expect(mastodonOrigin('https://mastodon.social/')).toBe('https://mastodon.social');
    for (const bad of ['mastodon.social', 'http://mastodon.social', 'https://mastodon.social/web', 'https://m.example?x=1', 'https://user:pw@m.example', 'not a url', 'https://']) {
      expect(mastodonOrigin(bad), bad).toBeNull();
    }
  });

  it('a bad server address is refused before any request, with a plain reason', async () => {
    let called = false;
    const result = await sendMastodon({ instanceUrl: 'mastodon.social', accessToken: TOKEN }, TEXT, 'row-1', async () => {
      called = true;
      return json({});
    });
    expect(result).toEqual({ ok: false, reason: 'The Mastodon server address must start with https:// and have no path.' });
    expect(called).toBe(false);
  });

  it('a refused token gives a plain reason and no token', async () => {
    const result = await sendMastodon({ instanceUrl: INSTANCE, accessToken: TOKEN }, TEXT, 'row-1', async () => json({ error: `bad ${TOKEN}` }, 401));
    expect(result).toEqual({ ok: false, reason: 'Mastodon did not accept the access token.' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('a limit gives a plain "try later"', async () => {
    expect(await sendMastodon({ instanceUrl: INSTANCE, accessToken: TOKEN }, TEXT, 'row-1', async () => json({}, 429))).toEqual({
      ok: false,
      reason: 'Mastodon is limiting posts. Try later.',
    });
  });

  it('an answer with no status id is not a success', async () => {
    expect(await sendMastodon({ instanceUrl: INSTANCE, accessToken: TOKEN }, TEXT, 'row-1', async () => json({}, 200))).toEqual({
      ok: false,
      reason: 'Mastodon did not take the post.',
    });
  });

  it('a network failure is a plain reason with no token in it', async () => {
    const result = await sendMastodon({ instanceUrl: INSTANCE, accessToken: TOKEN }, TEXT, 'row-1', async () => {
      throw new TypeError(`failed ${TOKEN}`);
    });
    expect(result).toEqual({ ok: false, reason: 'Could not reach the door.' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('missing the server or the token, it sends nothing', async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return json({});
    };
    expect(await sendMastodon({ instanceUrl: '', accessToken: TOKEN }, TEXT, 'row-1', fetchImpl)).toEqual({ ok: false, reason: 'Mastodon is not connected yet.' });
    expect(await sendMastodon({ instanceUrl: INSTANCE, accessToken: '' }, TEXT, 'row-1', fetchImpl)).toEqual({ ok: false, reason: 'Mastodon is not connected yet.' });
    expect(called).toBe(false);
  });
});
