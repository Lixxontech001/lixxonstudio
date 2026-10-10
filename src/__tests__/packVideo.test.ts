// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_VOICE_SECONDS,
  PACK_VIDEO,
  buildAssText,
  buildFfmpegArgs,
  escapeAss,
  ffmpegAvailable,
  mp4HasAudioTrack,
  parseProbe,
  refusalFor,
  renderPackVideo,
  probeMp4,
  voiceTempo,
} from '../../scripts/pack-video.mjs';
import { fakeNarration, wavBytes } from './support/wav';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FFMPEG = process.env.LIXXON_FFMPEG || 'ffmpeg';
const HAS_FFMPEG = ffmpegAvailable(FFMPEG);

describe('pack video: the vertical frame and the burned-in captions', () => {
  it('the frame is 1080 x 1920, ten seconds, thirty frames a second', () => {
    expect(PACK_VIDEO).toMatchObject({ width: 1080, height: 1920, seconds: 10, fps: 30 });
  });

  it('the caption file sets the vertical size and one event per chunk', () => {
    const ass = buildAssText(['First line', 'Second line']);
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass.match(/^Dialogue:/gm)?.length).toBe(2);
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:05.00,Caption,,0,0,0,,First line');
  });

  it('line breaks in a chunk become ASS line breaks, and braces and backslashes are removed', () => {
    expect(escapeAss('Line one\nLine two')).toBe('Line one\\NLine two');
    expect(escapeAss('{\\b1}bold{\\b0}')).toBe('b1boldb0');
  });

  it('the FFmpeg arguments scale and crop to 1080 x 1920, burn the captions, and carry a voice track', () => {
    const args = buildFfmpegArgs({ imagePath: '/tmp/a.png', assPath: '/tmp/x/captions.ass', outputPath: '/tmp/out.mp4', voicePath: '/tmp/x/voice.wav', voiceSeconds: 4 });
    const filter = args[args.indexOf('-vf') + 1];
    expect(filter).toContain('scale=1080:1920:force_original_aspect_ratio=increase');
    expect(filter).toContain('crop=1080:1920');
    expect(filter).toContain("subtitles='/tmp/x/captions.ass'");
    expect(args).not.toContain('-an');
    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
    expect(args).toContain('0:v:0');
    expect(args).toContain('1:a:0');
    expect(args).toContain('libx264');
    expect(args).toContain('+faststart');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });

  it('no watermark, no test banner and no country name appear in the arguments or the captions', () => {
    const args = buildFfmpegArgs({ imagePath: '/tmp/a.png', assPath: '/tmp/c.ass', outputPath: '/tmp/o.mp4', voicePath: '/tmp/v.wav' });
    const ass = buildAssText(['Calm routine for dry skin.']);
    for (const text of [args.join(' '), ass]) {
      expect(text).not.toMatch(/TEST ONLY|NOT FOR POSTING|watermark|drawtext/i);
      expect(text).not.toMatch(/nigeria|lagos|naira|\bWAT\b/i);
    }
  });

  it('a probe report is read for size, length and audio', () => {
    const report = '  Duration: 00:00:10.00, start: 0.000000, bitrate: 900 kb/s\n    Stream #0:0: Video: h264, yuv420p, 1080x1920, 30 fps\n';
    expect(parseProbe(report)).toEqual({ width: 1080, height: 1920, seconds: 10, hasAudio: false });
    expect(parseProbe('nothing useful')).toBeNull();
  });
});

describe('pack video: refusals happen before anything is made', () => {
  const good = { imagePath: '/tmp/a.png', chunks: ['Calm routine.'], outputPath: join(tmpdir(), 'pack-test.mp4') };

  it('a remote image address is refused, because the renderer only reads local files', () => {
    expect(refusalFor({ ...good, imagePath: 'https://example.com/cover.jpg' })).toBe('image_not_local');
  });

  it('a non-picture file is refused', () => {
    expect(refusalFor({ ...good, imagePath: '/tmp/a.gif' })).toBe('image_not_local');
  });

  it('more than three chunks, or an over-long chunk, is refused', () => {
    expect(refusalFor({ ...good, chunks: ['a', 'b', 'c', 'd'] })).toBe('chunks_out_of_range');
    expect(refusalFor({ ...good, chunks: [] })).toBe('chunks_out_of_range');
    expect(refusalFor({ ...good, chunks: ['x'.repeat(61)] })).toBe('chunk_too_long');
  });  it('there is no silent FFmpeg command: a voice track is required', () => {
    expect(() => buildFfmpegArgs({ imagePath: '/tmp/a.png', assPath: '/tmp/c.ass', outputPath: '/tmp/o.mp4' })).toThrow(/voice track is required/);
  });

  it('a voice that is short is padded, and one that runs long is sped up, never past the limit', () => {
    expect(voiceTempo(4)).toBe(1);
    expect(voiceTempo(PACK_VIDEO.seconds)).toBe(1);
    expect(voiceTempo(11)).toBeCloseTo(1.1, 4);
    expect(voiceTempo(MAX_VOICE_SECONDS)).toBeCloseTo(1.2, 4);
    const args = buildFfmpegArgs({ imagePath: '/tmp/a.png', assPath: '/tmp/c.ass', outputPath: '/tmp/o.mp4', voicePath: '/tmp/v.wav', voiceSeconds: 11 });
    expect(args[args.indexOf('-af') + 1]).toBe('atempo=1.1000,apad');
  });

  it('an MP4 with a sound track is told apart from a silent one, by its handler box', () => {
    const voiced = new Uint8Array(readFileSync(join(REPO_ROOT, 'src/__tests__/fixtures/pack-media/tiny-voiced.mp4')));
    const silent = new Uint8Array(readFileSync(join(REPO_ROOT, 'src/__tests__/fixtures/pack-media/tiny.mp4')));
    expect(mp4HasAudioTrack(voiced)).toBe(true);
    expect(mp4HasAudioTrack(silent)).toBe(false);
    expect(mp4HasAudioTrack(new Uint8Array(0))).toBe(false);
  });

  it('with no voice from any source, nothing is rendered: no file, and the reason is no_voice', async () => {
    const work = join(tmpdir(), `pack-voice-none-${Date.now()}`);
    mkdirSync(work, { recursive: true });
    const picture = join(work, 'picture.png');
    writeFileSync(picture, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    const output = join(work, 'none.mp4');
    const result = await renderPackVideo({
      imagePath: picture,
      chunks: ['Calm.'],
      outputPath: output,
      voiceOptions: { geminiKey: null, espeak: null },
    });
    expect(result).toEqual({ ok: false, reason: 'no_voice' });
    expect(existsSync(output)).toBe(false);
    rmSync(work, { recursive: true, force: true });
  });

  it('a voice longer than the limit is refused before any render', async () => {
    const work = join(tmpdir(), `pack-voice-long-${Date.now()}`);
    mkdirSync(work, { recursive: true });
    const picture = join(work, 'picture.png');
    writeFileSync(picture, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    const long = join(work, 'long.wav');
    writeFileSync(long, wavBytes(MAX_VOICE_SECONDS + 1));
    const output = join(work, 'long.mp4');
    const result = await renderPackVideo({
      imagePath: picture,
      chunks: ['Calm.'],
      outputPath: output,
      narration: { ok: true, voice: 'espeak', path: long, seconds: MAX_VOICE_SECONDS + 1 },
    });
    expect(result).toEqual({ ok: false, reason: 'voice_too_long' });
    expect(existsSync(output)).toBe(false);
    rmSync(work, { recursive: true, force: true });
  });

  it('an output that is not an MP4 is refused', () => {
    expect(refusalFor({ ...good, outputPath: join(tmpdir(), 'pack-test.mov') })).toBe('output_not_mp4');
  });

  it('an output inside the repository or the site is refused', () => {
    expect(refusalFor({ ...good, outputPath: join(REPO_ROOT, 'public', 'pack.mp4') })).toBe('output_in_repository');
  });

  it('a render with a refused input returns the reason and writes nothing', async () => {
    const result = await renderPackVideo({ ...good, imagePath: 'https://example.com/a.jpg' });
    expect(result).toEqual({ ok: false, reason: 'image_not_local' });
  });

  it('a missing image is reported as missing, and nothing is written', async () => {
    const output = join(tmpdir(), `pack-missing-${Date.now()}.mp4`);
    const result = await renderPackVideo({ imagePath: join(tmpdir(), 'no-such-image.png'), chunks: ['Calm.'], outputPath: output });
    expect(result).toEqual({ ok: false, reason: 'image_missing' });
    expect(existsSync(output)).toBe(false);
  });
});

describe.skipIf(!HAS_FFMPEG)('pack video: a real MP4 is made from a real picture', () => {
  const work = join(tmpdir(), `pack-video-proof-${Date.now()}`);
  const picture = join(work, 'picture.png');
  const output = join(work, 'pack-proof.mp4');

  it('makes a 1080 x 1920, ten second MP4 with the captions burned in and a voice track', async () => {
    rmSync(work, { recursive: true, force: true });
    spawnSync('mkdir', ['-p', work]);
    const made = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=800x1000:rate=1', '-frames:v', '1', picture]);
    expect(made.status).toBe(0);

    const result = await renderPackVideo({
      imagePath: picture,
      chunks: ['Dry skin feels tight by midday.', 'A calm routine keeps the steps in order.'],
      outputPath: output,
      ffmpeg: FFMPEG,
      narration: fakeNarration(join(work, 'voice.wav'), 4),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.probe).toEqual({ width: 1080, height: 1920, seconds: 10, hasAudio: true });
    expect(result.bytes).toBeGreaterThan(1000);
    expect(existsSync(output)).toBe(true);
    const again = await probeMp4(FFMPEG, output);
    expect(again?.width).toBe(1080);
    expect(again?.height).toBe(1920);
  }, 90_000);

  it('a second render to the same path is refused, so no file is overwritten', async () => {
    const result = await renderPackVideo({ imagePath: picture, chunks: ['Calm.'], outputPath: output, ffmpeg: FFMPEG, narration: fakeNarration(join(work, 'again.wav'), 2) });
    expect(result).toEqual({ ok: false, reason: 'output_exists' });
  });

  it('removes the test files afterwards', () => {
    rmSync(work, { recursive: true, force: true });
    expect(existsSync(work)).toBe(false);
  });
});
