// @vitest-environment node
// Phase G slice 1: the pack video reads the active saved Video look (three values). Fixtures only: a local picture,
// a fake narration, a fake storage and a fake fetch. The real FFmpeg render runs only when LIXXON_FFMPEG points to a
// working FFmpeg. Nothing here calls a voice service, a door, or production.
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PACK_LOOK_DEFAULT, assColour, buildAssText, buildFfmpegArgs, ffmpegAvailable, probeMp4, renderPackVideo, resolvePackLook,
} from '../../scripts/pack-video.mjs';
import { VIDEO_FAILED_NOTE, loadActiveLook, saveDayMedia } from '../../scripts/save-pack-media.mjs';
import { fakeNarration } from './support/wav';

const FIXTURES = join(process.cwd(), 'src/__tests__/fixtures/pack-media');
const COVER = new Uint8Array(readFileSync(join(FIXTURES, 'cover.png')));
const FFMPEG = process.env.LIXXON_FFMPEG || '';
const HAS_FFMPEG = Boolean(FFMPEG) && ffmpegAvailable(FFMPEG);
const CHUNKS = ['Dry skin feels tight by midday.', 'A calm routine keeps the steps in order.'];
const LOOK = { durationSeconds: 20, captionFontSize: 48, captionColor: '0x00FF7F' };

let work = '';
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'pack-look-test-'));
});
afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe('pack video look: the three values, with safe defaults', () => {
  it('no look, or a look with nothing usable, keeps the built-in pack look', () => {
    expect(resolvePackLook(null)).toEqual({ durationSeconds: 10, captionFontSize: 64, captionColor: '0xFFFFFF' });
    expect(resolvePackLook(undefined)).toEqual(resolvePackLook({}));
    expect(PACK_LOOK_DEFAULT).toEqual({ durationSeconds: 10, captionFontSize: 64, captionColor: '0xFFFFFF' });
  });

  it('a value outside its range, or of the wrong type, keeps its default and the others still apply', () => {
    expect(resolvePackLook({ durationSeconds: 7, captionFontSize: 48, captionColor: '0x00FF7F' })).toEqual({
      durationSeconds: 10, captionFontSize: 48, captionColor: '0x00FF7F',
    });
    expect(resolvePackLook({ durationSeconds: '20', captionFontSize: 999, captionColor: 'blue' })).toEqual({
      durationSeconds: 10, captionFontSize: 64, captionColor: '0xFFFFFF',
    });
    expect(resolvePackLook({ durationSeconds: 60.5, captionFontSize: 24, captionColor: '0xabcdef' })).toEqual({
      durationSeconds: 10, captionFontSize: 24, captionColor: '0xABCDEF',
    });
  });

  it('the limits match the database check: duration 8 to 60, caption size 24 to 72', () => {
    expect(resolvePackLook({ durationSeconds: 8, captionFontSize: 72 }).durationSeconds).toBe(8);
    expect(resolvePackLook({ durationSeconds: 60, captionFontSize: 24 }).captionFontSize).toBe(24);
    expect(resolvePackLook({ durationSeconds: 61 }).durationSeconds).toBe(10);
  });

  it('a colour is written in ASS order: 0xRRGGBB becomes &H00BBGGRR', () => {
    expect(assColour('0xFDFBF7')).toBe('&H00F7FBFD');
    expect(assColour('0xFFFFFF')).toBe('&H00FFFFFF');
    expect(assColour('0x112233')).toBe('&H00332211');
    expect(assColour('not a colour')).toBe('&H00FFFFFF');
  });

  it('the subtitle style carries the saved caption size and colour', () => {
    const ass = buildAssText(CHUNKS, { seconds: 20, fontSize: 48, colour: '0x00FF7F' });
    expect(ass).toContain(',48,&H007FFF00,');
    expect(buildAssText(CHUNKS)).toContain(',64,&H00FFFFFF,');
  });

  it('the FFmpeg arguments cut to the saved length, and keep the voice track (no silent output)', () => {
    const args = buildFfmpegArgs({ imagePath: '/x.png', assPath: '/x.ass', outputPath: '/x.mp4', voicePath: '/v.wav', voiceSeconds: 4, seconds: 20 });
    expect(args[args.indexOf('-t') + 1]).toBe('20');
    expect(args).toContain('1:a:0');
    expect(args).not.toContain('-an');
    expect(() => buildFfmpegArgs({ imagePath: '/x.png', assPath: '/x.ass', outputPath: '/x.mp4', voicePath: '', seconds: 20 })).toThrow(/voice track/);
  });

  it('a silent pack is still refused when the look is set: no voice means no file', async () => {
    const output = join(work, 'no-voice.mp4');
    const result = await renderPackVideo({
      imagePath: join(FIXTURES, 'cover.png'),
      chunks: CHUNKS,
      outputPath: output,
      look: LOOK,
      narration: { ok: false, reason: 'no_voice' },
    });
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, reason: 'no_voice' });
  });
});

describe('save-pack-media: the active look reaches the render', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const POST = 'aaaaaaaa-0000-4000-8000-000000000001';
  const DAY = '2026-10-10';

  function harness(look: unknown) {
    const seen: Array<{ look: unknown }> = [];
    return {
      seen,
      deps: {
        siteOrigin: 'https://lixxonstudio.example',
        workDir: work,
        fetchImpl: async () => new Response(COVER, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(COVER.byteLength) } }),
        ffmpegReady: () => true,
        narrate: async (input: { outPath: string }) => fakeNarration(input.outPath),
        renderVideo: async (input: { look?: unknown }) => {
          seen.push({ look: input.look });
          return { ok: false, reason: 'render_failed' };
        },
        loadLook: async () => look,
        async loadPacks() {
          return [{ owner_id: OWNER, post_id: POST, channel: 'instagram', caption: 'Start with one step tonight.', pin_description: null, status: 'ready', posted_at: null, still_path: 'kept.png', video_path: null }];
        },
        async loadArticle() {
          return { id: POST, cover_image: 'https://lixxonstudio.example/images/cover.png' };
        },
        async upload() {
          return true;
        },
        async attach() {
          return true;
        },
      },
    };
  }

  it('the saved look is passed to the video render', async () => {
    const h = harness(LOOK);
    const report = await saveDayMedia(DAY, h.deps);
    expect(report[0].video).toBe(VIDEO_FAILED_NOTE);
    expect(h.seen).toEqual([{ look: LOOK }]);
  });

  it('with no saved look, the render is given no look and keeps the built-in one', async () => {
    const h = harness(null);
    await saveDayMedia(DAY, h.deps);
    expect(h.seen).toEqual([{ look: null }]);
  });

  it('loadActiveLook reads the active row in the three values, and returns null on any failure', async () => {
    const reads: Array<[string, unknown]> = [];
    const sb = {
      from(table: string) {
        reads.push(['table', table]);
        return {
          select(columns: string) {
            reads.push(['select', columns]);
            return {
              eq(column: string, value: unknown) {
                reads.push(['eq', `${column}=${String(value)}`]);
                return { maybeSingle: async () => ({ data: { duration_seconds: 20, caption_font_size: 48, caption_color: '0x00FF7F' }, error: null }) };
              },
            };
          },
        };
      },
    };
    await expect(loadActiveLook(sb)).resolves.toEqual(LOOK);
    expect(reads).toContainEqual(['table', 'video_templates']);
    expect(reads).toContainEqual(['eq', 'is_active=true']);

    const broken = { from: () => { throw new Error('down'); } };
    await expect(loadActiveLook(broken)).resolves.toBeNull();
    const none = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    await expect(loadActiveLook(none)).resolves.toBeNull();
  });
});

describe.skipIf(!HAS_FFMPEG)('pack video look: a real MP4 uses the saved length', () => {
  it('a 20 second look makes a 20 second MP4 with a voice track, still 1080 x 1920', async () => {
    const output = join(work, 'look-20s.mp4');
    const result = await renderPackVideo({
      imagePath: join(FIXTURES, 'cover.png'),
      chunks: CHUNKS,
      outputPath: output,
      ffmpeg: FFMPEG,
      look: LOOK,
      narration: fakeNarration(join(work, 'look-voice.wav'), 4),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.probe?.seconds).toBe(20);
    expect(result.probe?.width).toBe(1080);
    expect(result.probe?.height).toBe(1920);
    expect(result.probe?.hasAudio).toBe(true);
    const again = await probeMp4(FFMPEG, output);
    expect(again?.seconds).toBe(20);
    expect(again?.hasAudio).toBe(true);
  }, 120_000);
});
