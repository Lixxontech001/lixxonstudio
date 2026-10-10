import { describe, expect, it } from 'vitest';
import {
  oauthAuthorization,
  oauthEncode,
  sendBlogger,
  sendTumblr,
  splitLinkText,
  type FetchLike,
} from '../../supabase/functions/_shared/doorAdapters';

const TEXT = 'New on the blog: Easy routine for dry skin\nhttps://lixxonstudio.example/blog/easy-routine';
const TUMBLR = {
  consumerKey: 'TUMBLR-CONSUMER-KEY-VALUE',
  consumerSecret: 'TUMBLR-CONSUMER-SECRET-VALUE',
  accessToken: 'TUMBLR-ACCESS-VALUE',
  tokenSecret: 'TUMBLR-TOKEN-SECRET-VALUE',
  blogName: 'lixxon',
};
const BLOGGER = {
  clientId: 'BLOGGER-CLIENT-ID.apps.example',
  clientSecret: 'BLOGGER-CLIENT-SECRET-VALUE',
  refreshToken: 'BLOGGER-REFRESH-TOKEN-VALUE',
  blogId: '8070105920543249955',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function recorder(answer: (url: string) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return answer(url);
  };
  return { fetchImpl, calls };
}

describe('OAuth 1.0a signing (used by Tumblr)', () => {
  it('encodes the way OAuth requires, including ! ( ) * and the apostrophe', () => {
    expect(oauthEncode("a b!c'd(e)f*g~h")).toBe('a%20b%21c%27d%28e%29f%2Ag~h');
  });

  it('matches the published OAuth 1.0a example (the signature for the status update request, with its nonce and timestamp)', async () => {
    const header = await oauthAuthorization({
      method: 'POST',
      url: 'https://api.twitter.com/1/statuses/update.json',
      consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
      consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
      params: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!', include_entities: 'true' },
      nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      timestamp: 1318622958,
    });
    expect(header).toContain('oauth_signature="tnnArxj06cWHq44gCs1OSKk%2FjLY%3D"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header.startsWith('OAuth ')).toBe(true);
  });

  it('the header never shows the consumer secret or the token secret', async () => {
    const header = await oauthAuthorization({
      method: 'POST',
      url: 'https://api.tumblr.com/v2/blog/lixxon.tumblr.com/posts',
      consumerKey: TUMBLR.consumerKey,
      consumerSecret: TUMBLR.consumerSecret,
      token: TUMBLR.accessToken,
      tokenSecret: TUMBLR.tokenSecret,
    });
    expect(header).not.toContain(TUMBLR.consumerSecret);
    expect(header).not.toContain(TUMBLR.tokenSecret);
  });
});

describe('splitting the door text', () => {
  it('the first line is the heading and the last line is the link', () => {
    expect(splitLinkText(TEXT)).toEqual({
      head: 'New on the blog: Easy routine for dry skin',
      url: 'https://lixxonstudio.example/blog/easy-routine',
    });
  });

  it('a link that is not https, or has spaces, is refused', () => {
    expect(splitLinkText('Head\nhttp://lixxonstudio.example/blog/a')).toBeNull();
    expect(splitLinkText('Head\nhttps://lixxonstudio.example/a b')).toBeNull();
    expect(splitLinkText('no break at all')).toBeNull();
  });
});

describe('Tumblr: one published text post with the link, signed', () => {
  it('posts the blocks to the blog, with an OAuth header, and returns the post id', async () => {
    const { fetchImpl, calls } = recorder(() => new Response('{"meta":{"status":201},"response":{"id":642337957436588032}}', { status: 201 }));
    const result = await sendTumblr(TUMBLR, TEXT, fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: '642337957436588032' });
    expect(calls[0].url).toBe('https://api.tumblr.com/v2/blog/lixxon.tumblr.com/posts');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization.startsWith('OAuth ')).toBe(true);
    expect(headers.Authorization).toContain(`oauth_token="${oauthEncode(TUMBLR.accessToken)}"`);
    expect(headers.Authorization).not.toContain(TUMBLR.consumerSecret);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      state: 'published',
      content: [
        { type: 'text', text: 'New on the blog: Easy routine for dry skin' },
        { type: 'link', url: 'https://lixxonstudio.example/blog/easy-routine' },
      ],
    });
  });

  it('a blog name written with .tumblr.com or in capitals is tidied', async () => {
    const { fetchImpl, calls } = recorder(() => json({ response: { id: 1 } }, 201));
    await sendTumblr({ ...TUMBLR, blogName: 'Lixxon.tumblr.com' }, TEXT, fetchImpl);
    expect(calls[0].url).toBe('https://api.tumblr.com/v2/blog/lixxon.tumblr.com/posts');
  });

  it('a blog name in the wrong form is refused before any request', async () => {
    for (const blogName of ['bad name', 'a.b.c', '../x', 'x'.repeat(33)]) {
      const { fetchImpl, calls } = recorder(() => json({}, 201));
      expect(await sendTumblr({ ...TUMBLR, blogName }, TEXT, fetchImpl), blogName).toEqual({
        ok: false,
        reason: 'The Tumblr blog name is not in the right form.',
      });
      expect(calls).toHaveLength(0);
    }
  });

  it('missing a key or the blog name, it sends nothing', async () => {
    const { fetchImpl, calls } = recorder(() => json({}, 201));
    expect(await sendTumblr({ ...TUMBLR, accessToken: '' }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Tumblr is not connected yet.' });
    expect(calls).toHaveLength(0);
  });

  it('a refused key or token gives a plain reason, with no secret in it', async () => {
    const { fetchImpl } = recorder(() => new Response(`bad ${TUMBLR.tokenSecret}`, { status: 401 }));
    const result = await sendTumblr(TUMBLR, TEXT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'Tumblr did not accept the keys or the access token.' });
    expect(JSON.stringify(result)).not.toContain(TUMBLR.tokenSecret);
  });

  it('a missing blog, a limit, and a refused answer each give a plain reason', async () => {
    expect(await sendTumblr(TUMBLR, TEXT, recorder(() => new Response('', { status: 404 })).fetchImpl)).toEqual({
      ok: false,
      reason: 'Tumblr did not find that blog.',
    });
    expect(await sendTumblr(TUMBLR, TEXT, recorder(() => new Response('', { status: 429 })).fetchImpl)).toEqual({
      ok: false,
      reason: 'Tumblr is limiting posts. Try later.',
    });
    expect(await sendTumblr(TUMBLR, TEXT, recorder(() => new Response('', { status: 500 })).fetchImpl)).toEqual({
      ok: false,
      reason: 'Tumblr did not take the post.',
    });
  });

  it('a success with no readable id is still a success, with no reference', async () => {
    const result = await sendTumblr(TUMBLR, TEXT, recorder(() => new Response('{}', { status: 201 })).fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: null });
  });

  it('a network failure is a plain reason with no secret in it', async () => {
    const result = await sendTumblr(TUMBLR, TEXT, async () => {
      throw new TypeError(`failed ${TUMBLR.consumerSecret}`);
    });
    expect(result).toEqual({ ok: false, reason: 'Could not reach the door.' });
    expect(JSON.stringify(result)).not.toContain(TUMBLR.consumerSecret);
  });
});

describe('Blogger: an access token from the refresh token, then one published post', () => {
  it('exchanges the refresh token, then posts with the access token as a bearer', async () => {
    const { fetchImpl, calls } = recorder((url) =>
      url.startsWith('https://oauth2.googleapis.com/token')
        ? json({ access_token: 'ACCESS-FROM-REFRESH' })
        : json({ id: '4455667788', url: 'https://example.blogspot.com/x' }),
    );
    const result = await sendBlogger(BLOGGER, TEXT, fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: '4455667788' });

    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0].init.method).toBe('POST');
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe(BLOGGER.refreshToken);
    expect(form.get('client_id')).toBe(BLOGGER.clientId);
    expect(form.get('client_secret')).toBe(BLOGGER.clientSecret);

    expect(calls[1].url).toBe('https://www.googleapis.com/blogger/v3/blogs/8070105920543249955/posts/');
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer ACCESS-FROM-REFRESH');
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.kind).toBe('blogger#post');
    expect(body.title).toBe('New on the blog: Easy routine for dry skin');
    expect(body.content).toBe(
      '<p>New on the blog: Easy routine for dry skin</p><p><a href="https://lixxonstudio.example/blog/easy-routine">https://lixxonstudio.example/blog/easy-routine</a></p>',
    );
  });

  it('the title and the link are escaped, so the post cannot carry markup of its own', async () => {
    const hostile = 'Tips & <script>x</script> "q"\nhttps://lixxonstudio.example/blog/a';
    const { fetchImpl, calls } = recorder((url) => (url.includes('oauth2') ? json({ access_token: 'A' }) : json({ id: '1' })));
    await sendBlogger(BLOGGER, hostile, fetchImpl);
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.content).not.toContain('<script>');
    expect(body.content).toContain('Tips &amp; &lt;script&gt;');
    expect(body.content).toContain('&quot;q&quot;');
  });

  it('a refused refresh gives a plain reason, with no secret in it', async () => {
    const { fetchImpl, calls } = recorder(() => new Response(`invalid_grant ${BLOGGER.refreshToken}`, { status: 400 }));
    const result = await sendBlogger(BLOGGER, TEXT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'Google did not accept the Blogger sign-in details.' });
    expect(JSON.stringify(result)).not.toContain(BLOGGER.refreshToken);
    expect(calls).toHaveLength(1);
  });

  it('a refused post, a limit, and a missing blog each give a plain reason', async () => {
    const tokenThen = (status: number) =>
      recorder((url) => (url.includes('oauth2') ? json({ access_token: 'A' }) : new Response('', { status })));
    expect(await sendBlogger(BLOGGER, TEXT, tokenThen(401).fetchImpl)).toEqual({ ok: false, reason: 'Blogger did not accept the access.' });
    expect(await sendBlogger(BLOGGER, TEXT, tokenThen(429).fetchImpl)).toEqual({ ok: false, reason: 'Blogger is limiting posts. Try later.' });
    expect(await sendBlogger(BLOGGER, TEXT, tokenThen(404).fetchImpl)).toEqual({ ok: false, reason: 'Blogger did not find that blog.' });
    expect(await sendBlogger(BLOGGER, TEXT, tokenThen(500).fetchImpl)).toEqual({ ok: false, reason: 'Blogger did not take the post.' });
  });

  it('a blog ID that is not digits is refused before any request', async () => {
    const { fetchImpl, calls } = recorder(() => json({}));
    expect(await sendBlogger({ ...BLOGGER, blogId: 'abc/../x' }, TEXT, fetchImpl)).toEqual({
      ok: false,
      reason: 'The Blogger blog ID is not in the right form.',
    });
    expect(calls).toHaveLength(0);
  });

  it('missing a value, it sends nothing', async () => {
    const { fetchImpl, calls } = recorder(() => json({}));
    expect(await sendBlogger({ ...BLOGGER, refreshToken: '' }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Blogger is not connected yet.' });
    expect(calls).toHaveLength(0);
  });
});
