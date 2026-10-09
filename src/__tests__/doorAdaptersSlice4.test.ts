import { describe, expect, it } from 'vitest';
import {
  VIDEO_MAX_BYTES,
  onHost,
  plainVideoText,
  sendVimeo,
  sendYouTube,
  youtubeChannelCheck,
  type DoorVideo,
  type FetchLike,
} from '../../supabase/functions/_shared/doorAdapters';
import { testDoorConnection } from '../../supabase/functions/_shared/doorConnectionTests';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fake network. `answer` gives the response for each call. Every call is recorded. */
function network(answer: (call: Call) => Response | 'throw') {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : '',
    };
    calls.push(call);
    const response = answer(call);
    if (response === 'throw') throw new TypeError('network down');
    return response;
  };
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const MP4: DoorVideo = { data: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]).buffer, contentType: 'video/mp4', bytes: 8 };
const YT = { clientId: 'YT-CLIENT-ID', clientSecret: 'YT-CLIENT-SECRET-VALUE', refreshToken: 'YT-REFRESH-SECRET-VALUE' };
const VIMEO = { accessToken: 'VIMEO-TOKEN-SECRET-VALUE' };
const SECRETS = [YT.clientId, YT.clientSecret, YT.refreshToken, VIMEO.accessToken];

const YT_UPLOAD = 'https://upload.googleapis.com/upload/youtube/v3/videos?upload_id=abc';

/** The YouTube answers for a full successful upload. Overrides change one step. */
function youtubeAnswers(over: { start?: Response; put?: Response; token?: Response } = {}) {
  return (call: Call): Response => {
    if (call.url === 'https://oauth2.googleapis.com/token') return over.token ?? json({ access_token: 'ACCESS-TOKEN' });
    if (call.url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos')) {
      return over.start ?? new Response('', { status: 200, headers: { location: YT_UPLOAD } });
    }
    if (call.url === YT_UPLOAD) return over.put ?? json({ id: 'yt-video-1', status: { privacyStatus: 'public' } });
    return new Response('unexpected', { status: 500 });
  };
}

/** The Vimeo answers for a full successful upload. */
function vimeoAnswers(over: { create?: Response; patch?: Response } = {}) {
  const link = 'https://files.tus.vimeo.com/upload/abc123';
  return (call: Call): Response => {
    if (call.url === 'https://api.vimeo.com/me/videos') {
      return over.create ?? json({ uri: '/videos/98765', upload: { upload_link: link } }, 200);
    }
    if (call.url === link) return over.patch ?? new Response(null, { status: 204, headers: { 'upload-offset': '8' } });
    return new Response('unexpected', { status: 500 });
  };
}

describe('the host check: a video is sent only to the door\'s own host, over https', () => {
  it('accepts the door host and its sub-hosts, and refuses anything else', () => {
    expect(onHost('https://upload.googleapis.com/x', ['googleapis.com'])).toBe(true);
    expect(onHost('https://googleapis.com/x', ['googleapis.com'])).toBe(true);
    expect(onHost('https://googleapis.com.evil.example/x', ['googleapis.com'])).toBe(false);
    expect(onHost('https://evil.example/googleapis.com', ['googleapis.com'])).toBe(false);
    expect(onHost('http://upload.googleapis.com/x', ['googleapis.com'])).toBe(false);
    expect(onHost('not a url', ['googleapis.com'])).toBe(false);
  });

  it('plain video text drops < and >, collapses spaces, and is clipped', () => {
    expect(plainVideoText('  a <b>  c  ', 100)).toBe('a b c');
    expect(plainVideoText('x'.repeat(200), 100)).toHaveLength(100);
  });
});

describe('YouTube sends only a real MP4, as a resumable public upload', () => {
  it('is not connected without all three saved values, and makes no request', async () => {
    const { fetchImpl, calls } = network(youtubeAnswers());
    expect(await sendYouTube({ ...YT, refreshToken: '' }, 'text', 'title', MP4, fetchImpl)).toEqual({ ok: false, reason: 'YouTube is not connected yet.' });
    expect(calls).toHaveLength(0);
  });

  it('with no video, it refuses without a request: never a fake upload', async () => {
    const { fetchImpl, calls } = network(youtubeAnswers());
    expect(await sendYouTube(YT, 'text', 'title', null, fetchImpl)).toEqual({ ok: false, reason: 'There is no video for this article yet.' });
    expect(calls).toHaveLength(0);
  });

  it('refuses a file that is not an MP4, an empty file, and a file over the size limit', async () => {
    const { fetchImpl, calls } = network(youtubeAnswers());
    expect(await sendYouTube(YT, 'text', 'title', { ...MP4, contentType: 'video/webm' }, fetchImpl)).toEqual({ ok: false, reason: 'The video is not an MP4 file.' });
    expect(await sendYouTube(YT, 'text', 'title', { ...MP4, bytes: 0 }, fetchImpl)).toEqual({ ok: false, reason: 'The video file is empty. Nothing was sent.' });
    expect(await sendYouTube(YT, 'text', 'title', { ...MP4, bytes: VIDEO_MAX_BYTES + 1 }, fetchImpl)).toEqual({ ok: false, reason: 'The video is too large for this door.' });
    expect(calls).toHaveLength(0);
  });

  it('a full upload: sign in, describe the video as public, send the bytes to Google, and return the video id', async () => {
    const { fetchImpl, calls } = network(youtubeAnswers());
    const result = await sendYouTube(YT, 'Short routine.', 'Easy routine', MP4, fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: 'yt-video-1' });
    expect(calls.map((call) => `${call.method} ${call.url.split('?')[0]}`)).toEqual([
      'POST https://oauth2.googleapis.com/token',
      'POST https://www.googleapis.com/upload/youtube/v3/videos',
      `PUT ${YT_UPLOAD.split('?')[0]}`,
    ]);
    const start = calls[1];
    expect(start.url).toContain('uploadType=resumable');
    expect(start.headers['X-Upload-Content-Type']).toBe('video/mp4');
    expect(start.headers['X-Upload-Content-Length']).toBe('8');
    const meta = JSON.parse(start.body);
    expect(meta.status.privacyStatus).toBe('public');
    expect(meta.snippet.title).toBe('Easy routine');
    expect(meta.snippet.description).toBe('Short routine.');
  });

  it('the sign-in token is never sent to Google\'s upload address', async () => {
    const { fetchImpl, calls } = network(youtubeAnswers());
    await sendYouTube(YT, 'text', 'title', MP4, fetchImpl);
    const put = calls[2];
    expect(put.headers.Authorization).toBeUndefined();
    expect(calls[1].headers.Authorization).toBe('Bearer ACCESS-TOKEN');
  });

  it('an upload address that is not on Google is refused, and the bytes are never sent', async () => {
    const { fetchImpl, calls } = network(youtubeAnswers({ start: new Response('', { status: 200, headers: { location: 'https://evil.example/upload' } }) }));
    expect(await sendYouTube(YT, 'text', 'title', MP4, fetchImpl)).toEqual({ ok: false, reason: 'YouTube did not start the upload.' });
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('a private upload is reported with a note, never called public', async () => {
    const { fetchImpl } = network(youtubeAnswers({ put: json({ id: 'yt-2', status: { privacyStatus: 'private' } }) }));
    const result = await sendYouTube(YT, 'text', 'title', MP4, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.note).toMatch(/kept it private/);
  });

  it('refusals are plain: a sign-in refusal, a daily limit, and a failed upload', async () => {
    const refused = (answers: ReturnType<typeof youtubeAnswers>) => sendYouTube(YT, 'text', 'title', MP4, network(answers).fetchImpl);
    expect(await refused(youtubeAnswers({ token: new Response('no', { status: 400 }) }))).toEqual({ ok: false, reason: 'Google did not accept the YouTube sign-in details.' });
    expect(await refused(youtubeAnswers({ start: new Response('no', { status: 403 }) }))).toEqual({ ok: false, reason: 'YouTube refused the upload. It may be the daily upload limit or the upload permission.' });
    expect(await refused(youtubeAnswers({ start: new Response('no', { status: 429 }) }))).toEqual({ ok: false, reason: 'YouTube is limiting uploads. Try later.' });
    expect(await refused(youtubeAnswers({ put: new Response('no', { status: 500 }) }))).toEqual({ ok: false, reason: 'YouTube did not take the video.' });
  });

  it('a network failure is a plain reason, and no secret appears in any reason', async () => {
    const { fetchImpl } = network(() => 'throw');
    const result = await sendYouTube(YT, 'text', 'title', MP4, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'Could not reach the door.' });
    const bad = await sendYouTube(YT, 'text', 'title', MP4, network(youtubeAnswers({ token: new Response(SECRETS.join(' '), { status: 401 }) })).fetchImpl);
    for (const secret of SECRETS) expect(JSON.stringify(bad)).not.toContain(secret);
  });

  it('the title and description have no < or >, and stay within YouTube\'s length limits', async () => {
    const { fetchImpl, calls } = network(youtubeAnswers());
    await sendYouTube(YT, `<b>${'word '.repeat(2000)}`, `<h1>${'t'.repeat(300)}`, MP4, fetchImpl);
    const meta = JSON.parse(calls[1].body);
    expect(meta.snippet.title).not.toMatch(/[<>]/);
    expect(meta.snippet.title.length).toBeLessThanOrEqual(100);
    expect(meta.snippet.description).not.toMatch(/[<>]/);
    expect(meta.snippet.description.length).toBeLessThanOrEqual(5000);
  });
});

describe('Vimeo sends only a real MP4, as a resumable upload, and checks the whole file arrived', () => {
  it('is not connected without a token, and makes no request', async () => {
    const { fetchImpl, calls } = network(vimeoAnswers());
    expect(await sendVimeo({ accessToken: '' }, 'text', 'title', MP4, fetchImpl)).toEqual({ ok: false, reason: 'Vimeo is not connected yet.' });
    expect(calls).toHaveLength(0);
  });

  it('with no video, it refuses without a request', async () => {
    const { fetchImpl, calls } = network(vimeoAnswers());
    expect(await sendVimeo(VIMEO, 'text', 'title', null, fetchImpl)).toEqual({ ok: false, reason: 'There is no video for this article yet.' });
    expect(calls).toHaveLength(0);
  });

  it('a full upload: create the video with its size, send the bytes to Vimeo, and return the video id', async () => {
    const { fetchImpl, calls } = network(vimeoAnswers());
    expect(await sendVimeo(VIMEO, 'Short routine.', 'Easy routine', MP4, fetchImpl)).toEqual({ ok: true, externalRef: '98765' });
    const create = calls[0];
    expect(create.method).toBe('POST');
    expect(create.headers.Authorization).toBe(`Bearer ${VIMEO.accessToken}`);
    const body = JSON.parse(create.body);
    expect(body.upload).toEqual({ approach: 'tus', size: '8' });
    expect(body.privacy.view).toBe('anybody');
    const patch = calls[1];
    expect(patch.method).toBe('PATCH');
    expect(patch.headers['Tus-Resumable']).toBe('1.0.0');
    expect(patch.headers['Upload-Offset']).toBe('0');
    expect(patch.headers['Content-Type']).toBe('application/offset+octet-stream');
    expect(patch.headers.Authorization).toBeUndefined();
  });

  it('an upload address that is not on Vimeo is refused, and the bytes are never sent', async () => {
    const { fetchImpl, calls } = network(vimeoAnswers({ create: json({ uri: '/videos/1', upload: { upload_link: 'https://evil.example/u' } }) }));
    expect(await sendVimeo(VIMEO, 'text', 'title', MP4, fetchImpl)).toEqual({ ok: false, reason: 'Vimeo did not start the upload.' });
    expect(calls).toHaveLength(1);
  });

  it('a short upload is refused: the offset must equal the size', async () => {
    const { fetchImpl } = network(vimeoAnswers({ patch: new Response(null, { status: 204, headers: { 'upload-offset': '4' } }) }));
    expect(await sendVimeo(VIMEO, 'text', 'title', MP4, fetchImpl)).toEqual({ ok: false, reason: 'Vimeo did not take the whole video.' });
  });

  it('refusals are plain: a bad token and a plan limit', async () => {
    const refused = (answers: ReturnType<typeof vimeoAnswers>) => sendVimeo(VIMEO, 'text', 'title', MP4, network(answers).fetchImpl);
    expect(await refused(vimeoAnswers({ create: new Response('no', { status: 401 }) }))).toEqual({ ok: false, reason: 'Vimeo did not accept the access token.' });
    expect(await refused(vimeoAnswers({ create: new Response('no', { status: 403 }) }))).toEqual({ ok: false, reason: 'Vimeo refused the upload. Check the upload limit on your Vimeo plan.' });
  });
});

describe('the YouTube and Vimeo checks read only: they never upload', () => {
  it('YouTube reads the signed-in channel, and says connected when there is one', async () => {
    const { fetchImpl, calls } = network((call) => {
      if (call.url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'ACCESS' });
      return json({ items: [{ id: 'UC1' }] });
    });
    expect(await youtubeChannelCheck(YT, fetchImpl)).toBe('connected');
    expect(calls[1].url).toBe('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true');
    expect(calls[1].method).toBe('GET');
  });

  it('YouTube with a signed-in account that has no channel is invalid, not connected', async () => {
    const { fetchImpl } = network((call) => (call.url === 'https://oauth2.googleapis.com/token' ? json({ access_token: 'A' }) : json({ items: [] })));
    expect(await youtubeChannelCheck(YT, fetchImpl)).toBe('invalid');
  });

  it('the connection test for YouTube and Vimeo makes no upload and no create call', async () => {
    const seen: Call[] = [];
    const track = (answer: (call: Call) => Response) => network((call) => { seen.push(call); return answer(call); }).fetchImpl;
    await testDoorConnection('youtube', { youtube_client_id: YT.clientId, youtube_client_secret: YT.clientSecret, youtube_refresh_token: YT.refreshToken },
      track((call) => (call.url.includes('oauth2') ? json({ access_token: 'A' }) : json({ items: [{ id: 'UC' }] }))));
    await testDoorConnection('vimeo', { vimeo_access_token: VIMEO.accessToken }, track(() => json({ uri: '/users/1' })));
    expect(seen.map((call) => call.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
      'https://api.vimeo.com/me',
    ]);
    expect(seen.some((call) => /upload|\/me\/videos|\/posts/.test(call.url))).toBe(false);
  });

  it('the podcast check accepts a secure JPEG or PNG cover of at most 510 KB, and refuses the rest', async () => {
    const podcast = (cover: string) => ({ podcast_show_title: 'Show', podcast_show_author: 'Author', podcast_cover_url: cover });
    const picture = (type: string, bytes: number) => network(() => new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } })).fetchImpl;
    expect(await testDoorConnection('podcast', podcast('https://x.example/c.jpg'), picture('image/jpeg', 1000))).toBe('connected');
    expect(await testDoorConnection('podcast', podcast('https://x.example/c.png'), picture('image/png', 1000))).toBe('connected');
    expect(await testDoorConnection('podcast', podcast('http://x.example/c.jpg'), picture('image/jpeg', 1000))).toBe('invalid');
    expect(await testDoorConnection('podcast', podcast('https://x.example/c.gif'), picture('image/gif', 1000))).toBe('invalid');
    expect(await testDoorConnection('podcast', podcast('https://x.example/c.jpg'), picture('image/jpeg', 511 * 1024))).toBe('invalid');
    expect(await testDoorConnection('podcast', podcast('not a url'), picture('image/jpeg', 1000))).toBe('invalid');
  });
});
