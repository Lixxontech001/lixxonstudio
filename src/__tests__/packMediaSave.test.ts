// @vitest-environment node
// The pack picture and video saver. Uses a tiny local fixture (a 32 x 32 PNG and a one-second MP4), fake storage and a fake fetch.
// The real FFmpeg render runs only when LIXXON_FFMPEG points to a working FFmpeg. Nothing here posts or reaches the network.
import { mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffmpegAvailable, probeMp4, renderPackVideo } from '../../scripts/pack-video.mjs';
import {
  NO_CAPTION_NOTE,
  NO_FFMPEG_NOTE,
  STILL_BUCKET,
  STORE_FAILED_NOTE,
  VIDEO_BUCKET,
  VIDEO_FAILED_NOTE,
  VIDEO_MAX_BYTES,
  VIDEO_NOT_VALID_NOTE,
  checkStill,
  checkVideo,
  saveDayMedia,
  storagePathFor,
} from '../../scripts/save-pack-media.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const POST = 'aaaaaaaa-0000-4000-8000-000000000001';
const DAY = '2026-10-10';
const SITE = 'https://lixxonstudio.example';
const COVER_URL = `${SITE}/images/cover.png`;
const FIXTURES = join(process.cwd(), 'src/__tests__/fixtures/pack-media');
const COVER = new Uint8Array(readFileSync(join(FIXTURES, 'cover.png')));
const TINY = new Uint8Array(readFileSync(join(FIXTURES, 'tiny.mp4')));
const FFMPEG = process.env.LIXXON_FFMPEG || '';
const HAS_FFMPEG = Boolean(FFMPEG) && ffmpegAvailable(FFMPEG);

let workDir = '';
let runCount = 0;
beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pack-media-test-'));
});
afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function pack(over: Record<string, unknown> = {}) {
  return {
    owner_id: OWNER,
    post_id: POST,
    channel: 'instagram',
    caption: 'Your skin, a calm routine. Start with one step tonight.',
    pin_description: null,
    status: 'blocked',
    posted_at: null,
    still_path: null,
    video_path: null,
    ...over,
  };
}

function picture(body: Uint8Array, type = 'image/png', length = body.byteLength) {
  return new Response(body, { status: 200, headers: { 'content-type': type, 'content-length': String(length) } });
}

interface Harness {
  uploads: Array<{ bucket: string; path: string; type: string; bytes: Uint8Array }>;
  attaches: Array<{ owner: string; day: string; postId: string; stillPath: string | null; videoPath: string | null }>;
  fetches: string[];
  renders: number;
}

type Render = (input: { imagePath: string; chunks: string[]; outputPath: string }) => Promise<{ ok: boolean }>;

function run(
  options: {
    packs?: Array<Record<string, unknown>>;
    fetchImpl?: (url: string) => Response;
    uploadOk?: boolean;
    attachOk?: boolean;
    ffmpegReady?: boolean;
    renderVideo?: Render;
    renderReal?: boolean;
  } = {},
) {
  const h: Harness = { uploads: [], attaches: [], fetches: [], renders: 0 };
  // Each run gets its own folder, so one test's render never blocks another test's render.
  runCount += 1;
  const runDir = join(workDir, `run-${runCount}`);
  mkdirSync(runDir, { recursive: true });
  const fixtureRender: Render = async ({ outputPath }) => {
    await writeFile(outputPath, TINY);
    return { ok: true };
  };
  const realRender: Render = (input) => renderPackVideo({ ...input, ffmpeg: FFMPEG });
  const render: Render = options.renderVideo ?? (options.renderReal ? realRender : fixtureRender);
  const deps = {
    siteOrigin: SITE,
    workDir: runDir,
    fetchImpl: async (url: string) => {
      h.fetches.push(url);
      return options.fetchImpl ? options.fetchImpl(url) : picture(COVER);
    },
    ffmpegReady: () => options.ffmpegReady ?? true,
    renderVideo: async (input: { imagePath: string; chunks: string[]; outputPath: string }) => {
      h.renders += 1;
      return render(input);
    },
    async loadPacks() {
      return options.packs ?? [pack()];
    },
    async loadArticle() {
      return { id: POST, cover_image: COVER_URL };
    },
    async upload(bucket: string, path: string, bytes: Uint8Array, type: string) {
      h.uploads.push({ bucket, path, type, bytes });
      return options.uploadOk ?? true;
    },
    async attach(input: Harness['attaches'][number]) {
      h.attaches.push(input);
      return options.attachOk ?? true;
    },
  };
  return { h, deps };
}

describe('a still is a copy of the article picture, saved from the fixture', () => {
  it('the picture is saved under the owner, the day and the article, and attached to the pack', async () => {
    const { h, deps } = run();
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].still).toBe('saved');
    expect(h.uploads.find((item) => item.bucket === STILL_BUCKET)).toMatchObject({
      path: `${OWNER}/${DAY}/${POST}.png`,
      type: 'image/png',
    });
    expect(h.attaches).toContainEqual({ owner: OWNER, day: DAY, postId: POST, stillPath: `${OWNER}/${DAY}/${POST}.png`, videoPath: null });
  });

  it('a picture that cannot be fetched is skipped with a plain note, and nothing is uploaded or attached', async () => {
    const { h, deps } = run({ fetchImpl: () => new Response('gone', { status: 404 }) });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].still).toBe('The article picture could not be fetched.');
    expect(report[0].video).toBe('No video was made. The article picture could not be fetched.');
    expect(h.uploads).toHaveLength(0);
    expect(h.attaches).toHaveLength(0);
    expect(h.renders).toBe(0);
  });

  it('a page that is not a picture is refused', async () => {
    const { h, deps } = run({ fetchImpl: () => picture(new TextEncoder().encode('<html></html>'), 'text/html') });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].still).toBe('The article picture address did not point to a picture.');
    expect(h.uploads).toHaveLength(0);
  });

  it('a picture that is too large is refused before it is read', async () => {
    const { h, deps } = run({ fetchImpl: () => picture(COVER, 'image/png', 6 * 1024 * 1024) });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].still).toBe('The article picture is too large to use.');
    expect(h.uploads).toHaveLength(0);
  });

  it('an address that is not https or a site path is refused, and nothing is fetched', async () => {
    const { h, deps } = run();
    deps.loadArticle = async () => ({ id: POST, cover_image: 'http://elsewhere.example/cover.png' });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].still).toBe('The article picture address is not one the pack can use.');
    expect(h.fetches).toHaveLength(0);
  });

  it('a still that is already saved is not fetched or saved again', async () => {
    const { h, deps } = run({
      packs: [pack({ still_path: `${OWNER}/${DAY}/${POST}.png`, video_path: `${OWNER}/${DAY}/${POST}.mp4`, status: 'ready' })],
    });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0]).toEqual({ postId: POST, still: 'already saved', video: 'already saved' });
    expect(h.fetches).toHaveLength(0);
    expect(h.uploads).toHaveLength(0);
  });
});

describe('a video is a real MP4 made from the picture, saved under the owner', () => {
  it('the video is saved to the video bucket and attached, and nothing else changes', async () => {
    const { h, deps } = run();
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].video).toBe('saved');
    const video = h.uploads.find((item) => item.bucket === VIDEO_BUCKET);
    expect(video).toMatchObject({ path: `${OWNER}/${DAY}/${POST}.mp4`, type: 'video/mp4' });
    expect(video?.path).not.toMatch(/https?:|\/\//);
    expect(h.attaches).toContainEqual({ owner: OWNER, day: DAY, postId: POST, stillPath: null, videoPath: `${OWNER}/${DAY}/${POST}.mp4` });
  });

  it('no caption text means no video is made, and nothing is uploaded', async () => {
    const { h, deps } = run({ packs: [pack({ caption: '   ' })] });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].video).toBe(NO_CAPTION_NOTE);
    expect(h.renders).toBe(0);
    expect(h.uploads.find((item) => item.bucket === VIDEO_BUCKET)).toBeUndefined();
  });

  it('without FFmpeg the pack stays blocked, and the note says so', async () => {
    const { h, deps } = run({ ffmpegReady: false });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].video).toBe(NO_FFMPEG_NOTE);
    expect(h.renders).toBe(0);
    expect(h.attaches.find((item) => item.videoPath)).toBeUndefined();
  });

  it('a render that fails attaches nothing and uploads nothing', async () => {
    const { h, deps } = run({ renderVideo: async () => ({ ok: false }) });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].video).toBe(VIDEO_FAILED_NOTE);
    expect(h.uploads.find((item) => item.bucket === VIDEO_BUCKET)).toBeUndefined();
    expect(h.attaches.find((item) => item.videoPath)).toBeUndefined();
  });

  it('a file that is not an MP4 is never uploaded', async () => {
    const { h, deps } = run({
      renderVideo: async ({ outputPath }) => {
        await writeFile(outputPath, 'this is not a video at all');
        return { ok: true };
      },
    });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].video).toBe(VIDEO_NOT_VALID_NOTE);
    expect(h.uploads.find((item) => item.bucket === VIDEO_BUCKET)).toBeUndefined();
  });

  it('a video that cannot be uploaded is not attached', async () => {
    const { h, deps } = run({ uploadOk: false });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].video).toBe(STORE_FAILED_NOTE);
    expect(h.attaches.find((item) => item.videoPath)).toBeUndefined();
  });

  it('a pack the owner already marked posted is left alone', async () => {
    const { h, deps } = run({ packs: [pack({ status: 'ready', posted_at: '2026-10-10T12:00:00Z' })] });
    const report = await saveDayMedia(DAY, deps);
    expect(report).toEqual([]);
    expect(h.fetches).toHaveLength(0);
  });

  it('a pack that already has its still saves only the video', async () => {
    const { h, deps } = run({ packs: [pack({ still_path: `${OWNER}/${DAY}/${POST}.png` })] });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0]).toEqual({ postId: POST, still: 'already saved', video: 'saved' });
    expect(h.uploads.map((item) => item.bucket)).toEqual([VIDEO_BUCKET]);
  });
});

describe('the path and file rules', () => {
  it('a storage path is owner, day and article, with a known extension, and nothing else', () => {
    expect(storagePathFor({ owner: OWNER, day: DAY, postId: POST, extension: 'mp4' })).toBe(`${OWNER}/${DAY}/${POST}.mp4`);
    expect(storagePathFor({ owner: 'not-a-uuid', day: DAY, postId: POST, extension: 'mp4' })).toBeNull();
    expect(storagePathFor({ owner: OWNER, day: '10/10/2026', postId: POST, extension: 'mp4' })).toBeNull();
    expect(storagePathFor({ owner: OWNER, day: DAY, postId: '../etc', extension: 'mp4' })).toBeNull();
    expect(storagePathFor({ owner: OWNER, day: DAY, postId: POST, extension: 'gif' })).toBeNull();
  });

  it('a still needs a picture type and some bytes', () => {
    expect(checkStill('image/png', 10)).toEqual({ ok: true, extension: 'png' });
    expect(checkStill('image/jpeg; charset=binary', 10)).toEqual({ ok: true, extension: 'jpg' });
    expect(checkStill('text/html', 10)).toEqual({ ok: false, reason: 'not_an_image' });
    expect(checkStill('image/png', 0)).toEqual({ ok: false, reason: 'empty' });
  });

  it('a video needs an MP4 header, some bytes, and a size under the limit', () => {
    expect(checkVideo(TINY)).toEqual({ ok: true });
    expect(checkVideo(new Uint8Array(0))).toEqual({ ok: false, reason: 'empty' });
    expect(checkVideo(new TextEncoder().encode('not a video file'))).toEqual({ ok: false, reason: 'not_mp4' });
    expect(checkVideo({ byteLength: VIDEO_MAX_BYTES + 1 } as unknown as Uint8Array)).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe.skipIf(!HAS_FFMPEG)('a real render from the fixture (needs LIXXON_FFMPEG)', () => {
  it('the renderer makes a vertical MP4 with no audio from the fixture picture', async () => {
    const outputPath = join(workDir, 'real-render.mp4');
    const rendered = await renderPackVideo({
      imagePath: join(FIXTURES, 'cover.png'),
      chunks: ['Start with one step tonight.'],
      outputPath,
      ffmpeg: FFMPEG,
    });
    expect(rendered.ok).toBe(true);
    const probe = await probeMp4(FFMPEG, outputPath);
    expect(probe).toMatchObject({ width: 1080, height: 1920, hasAudio: false });
    expect((await stat(outputPath)).size).toBeGreaterThan(0);
  });

  it('the saver uploads the real render, and the upload passes the MP4 check', async () => {
    const { h, deps } = run({ renderReal: true });
    const report = await saveDayMedia(DAY, deps);
    expect(report[0].video).toBe('saved');
    const video = h.uploads.find((item) => item.bucket === VIDEO_BUCKET);
    expect(checkVideo(video!.bytes)).toEqual({ ok: true });
    expect(await readFile(join(FIXTURES, 'cover.png'))).toBeTruthy();
  });
});
