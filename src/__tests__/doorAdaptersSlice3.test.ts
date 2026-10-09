// Phase 6 slice 3: the Medium, WordPress.com and Pixelfed senders, and their read-only checks.
// A fake network records each request. No real door is contacted.
import { describe, expect, it } from 'vitest';
import {
  sendMedium,
  sendPixelfed,
  sendWordPressCom,
  wordpressComSite,
  type DoorImage,
  type FetchLike,
} from '../../supabase/functions/_shared/doorAdapters';
import { testDoorConnection } from '../../supabase/functions/_shared/doorConnectionTests';
import { fetchArticleImage } from '../../supabase/functions/_shared/articleImage';

const LINK = 'https://lixxonstudio.example/blog/easy-routine-dry-skin';
const TEXT = `New on the blog: Easy routine for dry skin\n${LINK}`;
const MEDIUM_TOKEN = 'MEDIUM-TOKEN-SECRET';
const WP_TOKEN = 'WORDPRESS-TOKEN-SECRET';
const PIXEL_TOKEN = 'PIXELFED-TOKEN-SECRET';
const PICTURE: DoorImage = { data: new Uint8Array([1, 2, 3, 4]).buffer, contentType: 'image/jpeg' };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function network(answer: (url: string, method: string) => Response | 'throw') {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, body: init.body });
    const response = answer(url, method);
    if (response === 'throw') throw new TypeError('network down');
    return response;
  };
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ALL_SECRETS = [MEDIUM_TOKEN, WP_TOKEN, PIXEL_TOKEN];

describe('wordpressComSite: a site as a host name', () => {
  it('a plain host, a pasted address and a capital letter are all read to the same host', () => {
    expect(wordpressComSite('lixxon.wordpress.com')).toBe('lixxon.wordpress.com');
    expect(wordpressComSite('https://Lixxon.WordPress.com/')).toBe('lixxon.wordpress.com');
    expect(wordpressComSite('  notes.example.org  ')).toBe('notes.example.org');
  });

  it('anything that is not a host name is refused', () => {
    for (const bad of ['', 'no-dot', 'lixxon..com', 'https://x.com/path/../../', 'a b.com', '-bad.com', 'javascript:alert(1).com']) {
      expect(wordpressComSite(bad), bad).toBeNull();
    }
  });
});

describe('Medium: one story with the link back, through the owner\'s own token', () => {
  it('reads the account, then posts a public story with the article as its canonical link', async () => {
    const { fetchImpl, calls } = network((url) => (url.endsWith('/v1/me') ? json({ data: { id: 'ACCT1' } }) : json({ data: { id: 'story-1' } }, 201)));
    const result = await sendMedium({ accessToken: MEDIUM_TOKEN }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: 'story-1' });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://api.medium.com/v1/me',
      'POST https://api.medium.com/v1/users/ACCT1/posts',
    ]);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${MEDIUM_TOKEN}`);
    const body = JSON.parse(String(calls[1].body));
    expect(body).toMatchObject({
      title: 'New on the blog: Easy routine for dry skin',
      contentFormat: 'html',
      canonicalUrl: LINK,
      publishStatus: 'public',
    });
    expect(body.content).toBe(`<p><a href="${LINK}">${LINK}</a></p>`);
  });

  it('no token is refused before any request', async () => {
    const { fetchImpl, calls } = network(() => json({}));
    expect(await sendMedium({ accessToken: '' }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Medium is not connected yet.' });
    expect(calls).toHaveLength(0);
  });

  it('a refused token is a plain reason, and the token is never in it', async () => {
    const { fetchImpl } = network(() => json({ errors: [{ message: MEDIUM_TOKEN }] }, 401));
    const result = await sendMedium({ accessToken: MEDIUM_TOKEN }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'Medium did not accept the integration token.' });
    for (const secret of ALL_SECRETS) expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('an account with no usable id is refused, and no post is made', async () => {
    const { fetchImpl, calls } = network(() => json({ data: { id: 'bad/id' } }));
    expect(await sendMedium({ accessToken: MEDIUM_TOKEN }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Medium did not return the account.' });
    expect(calls).toHaveLength(1);
  });

  it('a story that comes back without an id is not counted as posted', async () => {
    const { fetchImpl } = network((url) => (url.endsWith('/v1/me') ? json({ data: { id: 'ACCT1' } }) : json({}, 201)));
    expect(await sendMedium({ accessToken: MEDIUM_TOKEN }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Medium did not take the story.' });
  });

  it('a network failure is reported plainly', async () => {
    const { fetchImpl } = network(() => 'throw');
    expect(await sendMedium({ accessToken: MEDIUM_TOKEN }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'Could not reach the door.' });
  });
});

describe('WordPress.com: a short post with the link back', () => {
  it('posts a published post with the title and the link only, to the site', async () => {
    const { fetchImpl, calls } = network(() => json({ id: 42 }, 201));
    const result = await sendWordPressCom({ site: 'lixxon.wordpress.com', accessToken: WP_TOKEN }, TEXT, fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: '42' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://public-api.wordpress.com/wp/v2/sites/lixxon.wordpress.com/posts');
    expect(calls[0].headers.Authorization).toBe(`Bearer ${WP_TOKEN}`);
    const body = JSON.parse(String(calls[0].body));
    expect(body).toEqual({ title: 'New on the blog: Easy routine for dry skin', content: `<p><a href="${LINK}">${LINK}</a></p>`, status: 'publish' });
  });

  it('a site that is not a host name is refused before any request', async () => {
    const { fetchImpl, calls } = network(() => json({}));
    expect(await sendWordPressCom({ site: 'bad site', accessToken: WP_TOKEN }, TEXT, fetchImpl)).toEqual({
      ok: false,
      reason: 'The WordPress.com site address is not in the right form.',
    });
    expect(calls).toHaveLength(0);
  });

  it('a missing site or token is "not connected", with no request', async () => {
    const { fetchImpl, calls } = network(() => json({}));
    expect(await sendWordPressCom({ site: '', accessToken: WP_TOKEN }, TEXT, fetchImpl)).toEqual({ ok: false, reason: 'WordPress.com is not connected yet.' });
    expect(calls).toHaveLength(0);
  });

  it('a refused token, an unknown site and a limit each have their own plain reason', async () => {
    const values = { site: 'lixxon.wordpress.com', accessToken: WP_TOKEN };
    expect(await sendWordPressCom(values, TEXT, network(() => json({}, 403)).fetchImpl)).toEqual({ ok: false, reason: 'WordPress.com did not accept the access token.' });
    expect(await sendWordPressCom(values, TEXT, network(() => json({}, 404)).fetchImpl)).toEqual({ ok: false, reason: 'WordPress.com did not find that site.' });
    expect(await sendWordPressCom(values, TEXT, network(() => json({}, 429)).fetchImpl)).toEqual({ ok: false, reason: 'WordPress.com is limiting posts. Try later.' });
  });
});

describe('Pixelfed: the article picture, then one status with that picture', () => {
  const SERVER = { instanceUrl: 'https://pixelfed.example', accessToken: PIXEL_TOKEN };

  it('uploads the picture, then posts a status with it and the link text, keyed by the reserved row', async () => {
    const { fetchImpl, calls } = network((url) => (url.endsWith('/api/v1/media') ? json({ id: 'm-9' }) : json({ id: 'status-7' })));
    const result = await sendPixelfed(SERVER, TEXT, PICTURE, 'row-pixelfed', fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: 'status-7' });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://pixelfed.example/api/v1/media',
      'POST https://pixelfed.example/api/v1/statuses',
    ]);
    expect(calls[0].body).toBeInstanceOf(FormData);
    const form = calls[0].body as FormData;
    expect(form.get('description')).toBe('New on the blog: Easy routine for dry skin');
    expect((form.get('file') as File).type).toBe('image/jpeg');
    const status = JSON.parse(String(calls[1].body));
    expect(status).toMatchObject({ status: TEXT, caption: TEXT, media_ids: ['m-9'], visibility: 'public' });
    expect(calls[1].headers['Idempotency-Key']).toBe('row-pixelfed');
    expect(calls[1].headers.Authorization).toBe(`Bearer ${PIXEL_TOKEN}`);
  });

  it('no picture is refused before any request, so Pixelfed never posts text alone', async () => {
    const { fetchImpl, calls } = network(() => json({}));
    expect(await sendPixelfed(SERVER, TEXT, null, 'row', fetchImpl)).toEqual({ ok: false, reason: 'This article has no picture for Pixelfed.' });
    expect(calls).toHaveLength(0);
  });

  it('a picture type Pixelfed does not take is refused before any request', async () => {
    const { fetchImpl, calls } = network(() => json({}));
    const gif: DoorImage = { data: new Uint8Array([1]).buffer, contentType: 'image/gif' };
    expect(await sendPixelfed(SERVER, TEXT, gif, 'row', fetchImpl)).toEqual({ ok: false, reason: 'The article picture is not a type Pixelfed takes.' });
    expect(calls).toHaveLength(0);
  });

  it('a server address that is not https, or has a path, is refused before any request', async () => {
    const { fetchImpl, calls } = network(() => json({}));
    for (const instanceUrl of ['http://pixelfed.example', 'https://pixelfed.example/some/path', '']) {
      const result = await sendPixelfed({ instanceUrl, accessToken: PIXEL_TOKEN }, TEXT, PICTURE, 'row', fetchImpl);
      expect(result.ok, instanceUrl).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it('a failed upload stops before the status: nothing is posted', async () => {
    const { fetchImpl, calls } = network(() => json({ error: 'nope' }, 422));
    expect(await sendPixelfed(SERVER, TEXT, PICTURE, 'row', fetchImpl)).toEqual({ ok: false, reason: 'Pixelfed did not take the picture.' });
    expect(calls).toHaveLength(1);
  });

  it('a status that is refused is reported as not taken, and the token is never in the reason', async () => {
    const { fetchImpl } = network((url) => (url.endsWith('/api/v1/media') ? json({ id: 'm-9' }) : json({ error: PIXEL_TOKEN }, 401)));
    const result = await sendPixelfed(SERVER, TEXT, PICTURE, 'row', fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'Pixelfed did not accept the access token.' });
    expect(JSON.stringify(result)).not.toContain(PIXEL_TOKEN);
  });
});

describe('the read-only checks for the three new doors', () => {
  it('Medium: the account read is the check, and it posts nothing', async () => {
    const good = network(() => json({ data: { id: 'ACCT1' } }));
    expect(await testDoorConnection('medium', { medium_integration_token: MEDIUM_TOKEN }, good.fetchImpl)).toBe('connected');
    expect(good.calls.map((call) => call.method)).toEqual(['GET']);
    expect(await testDoorConnection('medium', { medium_integration_token: MEDIUM_TOKEN }, network(() => json({}, 401)).fetchImpl)).toBe('invalid');
  });

  it('WordPress.com: the site read is the check; a bad site is refused before any request', async () => {
    const good = network(() => json({ ID: 1 }));
    expect(await testDoorConnection('wordpress_com', { wordpress_com_site: 'lixxon.wordpress.com', wordpress_com_access_token: WP_TOKEN }, good.fetchImpl)).toBe('connected');
    expect(good.calls[0].url).toBe('https://public-api.wordpress.com/rest/v1.1/sites/lixxon.wordpress.com');
    const bad = network(() => json({ ID: 1 }));
    expect(await testDoorConnection('wordpress_com', { wordpress_com_site: 'bad site', wordpress_com_access_token: WP_TOKEN }, bad.fetchImpl)).toBe('invalid');
    expect(bad.calls).toHaveLength(0);
  });

  it('Pixelfed: the account check on the server; a server address that is not https is refused', async () => {
    const good = network(() => json({ id: '3' }));
    expect(await testDoorConnection('pixelfed', { pixelfed_instance_url: 'https://pixelfed.example', pixelfed_access_token: PIXEL_TOKEN }, good.fetchImpl)).toBe('connected');
    expect(good.calls[0].url).toBe('https://pixelfed.example/api/v1/accounts/verify_credentials');
    const bad = network(() => json({ id: '3' }));
    expect(await testDoorConnection('pixelfed', { pixelfed_instance_url: 'http://pixelfed.example', pixelfed_access_token: PIXEL_TOKEN }, bad.fetchImpl)).toBe('invalid');
    expect(bad.calls).toHaveLength(0);
  });
});

describe('the article picture is read once, with its bytes kept for the upload', () => {
  it('a good JPEG comes back with its type and its bytes', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const loaded = await fetchArticleImage('/assets/covers/a.jpg', 'https://lixxonstudio.example', async () => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.contentType).toBe('image/jpeg');
      expect(loaded.bytes).toBe(3);
      expect(Array.from(new Uint8Array(loaded.data))).toEqual([9, 8, 7]);
    }
  });

  it('no cover, or a page instead of a picture, is a plain failure with no bytes', async () => {
    expect(await fetchArticleImage(null, 'https://lixxonstudio.example')).toEqual({ ok: false, reason: 'no_image' });
    const page = await fetchArticleImage('https://x.example/a.jpg', null, async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect(page).toEqual({ ok: false, reason: 'not_an_image' });
  });
});
