#!/usr/bin/env node
// The daily pack's video renderer. Makes one vertical MP4 (1080 x 1920, with a voice track, no watermark) from one
// local image and up to three short caption lines, burned in with an ASS subtitle file through FFmpeg. The voice comes
// from scripts/pack-voice.mjs (Gemini first, then a local espeak). With no voice, nothing is made: no silent MP4.
// It never writes into the repository or the site, never fetches a URL, and never invents a public address.
// The renderer only makes the file. Saving it, and any public address for it, is a later step.
// Usage: node scripts/pack-video.mjs --image <local png or jpg> --chunks '["line one","line two"]' --output <temp .mp4> [--ffmpeg <path>]

import { spawn, spawnSync } from 'node:child_process';
import { narrate, wavSeconds } from './pack-voice.mjs';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACK_VIDEO = Object.freeze({ width: 1080, height: 1920, fps: 30, seconds: 10, maxChunks: 3, maxChunkChars: 60 });
/**
 * The three values of the saved Video look that the pack video reads (see src/lib/videoLook.ts). A value that is
 * missing or outside its range keeps the built-in default here, so a pack is never made from a bad look.
 * Limits match the database check on the saved look (duration 8 to 60, caption size 24 to 72, 0xRRGGBB).
 */
export const PACK_LOOK_DEFAULT = Object.freeze({ durationSeconds: PACK_VIDEO.seconds, captionFontSize: 64, captionColor: '0xFFFFFF' });
export const PACK_LOOK_LIMITS = Object.freeze({ durationSeconds: [8, 60], captionFontSize: [24, 72] });
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_NAME = 'DejaVu Sans';
const RENDER_TIMEOUT_MS = 120_000;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
// A voice longer than this cannot fit the video even at the fastest allowed tempo, so the video is refused.
export const MAX_VOICE_SECONDS = 12;
/** Reasons that mean the video has no usable sound. The saver reports these as "video has no sound yet". */
export const NO_SOUND_REASONS = Object.freeze(['no_voice', 'voice_too_long', 'no_audio']);

export function ffmpegCommand(value) {
  return value || process.env.LIXXON_FFMPEG || 'ffmpeg';
}

function isInside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Picks the look's values that are in range; anything else keeps the default. Pure. */
export function resolvePackLook(look) {
  const whole = (value, [min, max], fallback) => (Number.isInteger(value) && value >= min && value <= max ? value : fallback);
  const colour = typeof look?.captionColor === 'string' && /^0x[0-9A-Fa-f]{6}$/.test(look.captionColor)
    ? `0x${look.captionColor.slice(2).toUpperCase()}`
    : PACK_LOOK_DEFAULT.captionColor;
  return {
    durationSeconds: whole(look?.durationSeconds, PACK_LOOK_LIMITS.durationSeconds, PACK_LOOK_DEFAULT.durationSeconds),
    captionFontSize: whole(look?.captionFontSize, PACK_LOOK_LIMITS.captionFontSize, PACK_LOOK_DEFAULT.captionFontSize),
    captionColor: colour,
  };
}

/** A look colour written 0xRRGGBB becomes the subtitle colour &H00BBGGRR (ASS stores blue first). Pure. */
export function assColour(hex) {
  const rgb = /^0x([0-9A-Fa-f]{6})$/.test(hex) ? hex.slice(2).toUpperCase() : PACK_LOOK_DEFAULT.captionColor.slice(2);
  return `&H00${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`;
}

/** Text that is safe inside an ASS subtitle line: no braces, no backslashes, line breaks as \N. */
export function escapeAss(text) {
  return String(text)
    .replace(/\\/g, '')
    .replace(/[{}]/g, '')
    .replace(/\r?\n/g, '\\N')
    .trim();
}

function assTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(Math.floor(secs))}.${String(Math.round((secs % 1) * 100)).padStart(2, '0')}`;
}

/** The ASS file: one caption on screen at a time, shared evenly across the video. Pure text. */
export function buildAssText(chunks, { width = PACK_VIDEO.width, height = PACK_VIDEO.height, seconds = PACK_VIDEO.seconds, fontSize = PACK_LOOK_DEFAULT.captionFontSize, colour = PACK_LOOK_DEFAULT.captionColor } = {}) {
  const slot = seconds / chunks.length;
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${FONT_NAME},${fontSize},${assColour(colour)},&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,260,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = chunks.map(
    (chunk, index) => `Dialogue: 0,${assTime(index * slot)},${assTime((index + 1) * slot)},Caption,,0,0,0,,${escapeAss(chunk)}`,
  );
  return [...header, ...lines, ''].join('\n');
}

/** Escapes a path for the FFmpeg subtitles filter (colons, quotes and backslashes). */
function filterPath(path) {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** The speed-up that fits a voice into the video's length: never slower, never past MAX_VOICE_SECONDS. */
export function voiceTempo(voiceSeconds, seconds = PACK_VIDEO.seconds) {
  if (!(voiceSeconds > seconds)) return 1;
  return Math.min(voiceSeconds / seconds, MAX_VOICE_SECONDS / seconds);
}

/**
 * Whether an MP4 has an audio track. Reads the handler type of each hdlr box: 'soun' is an audio track. Pure bytes.
 */
export function mp4HasAudioTrack(bytes) {
  if (!bytes || bytes.byteLength < 12) return false;
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = b.indexOf('hdlr', 0, 'latin1');
  while (at >= 0) {
    if (at + 16 <= b.length && b.toString('latin1', at + 12, at + 16) === 'soun') return true;
    at = b.indexOf('hdlr', at + 4, 'latin1');
  }
  return false;
}

/**
 * The FFmpeg arguments: scale and crop to 1080 x 1920, burn the subtitles, H.264, the voice track as AAC (padded or
 * sped up to exactly the video's length), faststart. A voice track is required: there is no silent output.
 */
export function buildFfmpegArgs({ imagePath, assPath, outputPath, voicePath, voiceSeconds, seconds = PACK_VIDEO.seconds, width = PACK_VIDEO.width, height = PACK_VIDEO.height, fps = PACK_VIDEO.fps }) {
  if (typeof voicePath !== 'string' || !voicePath) throw new Error('A voice track is required. No silent video is made.');
  const tempo = voiceTempo(voiceSeconds ?? seconds, seconds);
  const audioFilter = [tempo > 1 ? `atempo=${tempo.toFixed(4)}` : null, 'apad'].filter(Boolean).join(',');
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    'setsar=1',
    'format=yuv420p',
    `subtitles='${filterPath(assPath)}'`,
  ].join(',');
  return [
    '-hide_banner', '-nostdin', '-y',
    '-loop', '1', '-framerate', String(fps), '-i', imagePath,
    '-i', voicePath,
    '-t', String(seconds),
    '-vf', filter,
    '-af', audioFilter,
    '-map', '0:v:0', '-map', '1:a:0',
    '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '1',
    '-movflags', '+faststart',
    '-f', 'mp4', outputPath,
  ];
}

/** Reads width, height, length and audio from FFmpeg's own report. Null when the file cannot be read. */
export function parseProbe(report) {
  const video = /Video:.*?\b(\d{3,5})x(\d{3,5})\b/.exec(report);
  const duration = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(report);
  if (!video || !duration) return null;
  const seconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  return { width: Number(video[1]), height: Number(video[2]), seconds: Math.round(seconds * 100) / 100, hasAudio: /Audio:/.test(report) };
}

function run(command, args, { cwd, timeoutMs }) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveRun({ code: -1, stderr: String(error.message), timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stderr, timedOut: child.killed });
    });
  });
}

/** Reads the video's size and length with FFmpeg. Never throws. */
export async function probeMp4(ffmpeg, path) {
  const result = await run(ffmpegCommand(ffmpeg), ['-hide_banner', '-i', path], { cwd: tmpdir(), timeoutMs: 30_000 });
  return parseProbe(result.stderr);
}

/** Checks before any work: one local image, one temp MP4 outside the repository, 1 to 3 short chunks. */
export function refusalFor({ imagePath, chunks, outputPath }) {
  if (typeof imagePath !== 'string' || !isAbsolute(imagePath)) return 'image_not_local';
  if (/^[a-z]+:\/\//i.test(imagePath) || !IMAGE_EXTENSIONS.includes(extname(imagePath).toLowerCase())) return 'image_not_local';
  if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > PACK_VIDEO.maxChunks) return 'chunks_out_of_range';
  if (chunks.some((chunk) => typeof chunk !== 'string' || !chunk.trim() || chunk.replace(/\n/g, ' ').length > PACK_VIDEO.maxChunkChars)) return 'chunk_too_long';
  if (typeof outputPath !== 'string' || !isAbsolute(outputPath) || extname(outputPath).toLowerCase() !== '.mp4') return 'output_not_mp4';
  if (isInside(REPO_ROOT, outputPath)) return 'output_in_repository';
  return null;
}

/**
 * Makes the MP4 with its voice track. The voice is narration (from pack-voice.mjs, using voiceOptions) unless a
 * narration is passed in. Returns the file's size and probe on success. On any failure, a plain reason and nothing
 * left behind. A video with no voice, a voice too long to fit, or no audio in the result is never kept.
 */
export async function renderPackVideo({ imagePath, chunks, outputPath, ffmpeg, narration, voiceOptions = {}, look }) {
  const packLook = resolvePackLook(look);
  const refused = refusalFor({ imagePath, chunks, outputPath });
  if (refused) return { ok: false, reason: refused };
  try {
    await stat(imagePath);
  } catch {
    return { ok: false, reason: 'image_missing' };
  }
  const exists = await stat(outputPath).then(() => true, () => false);
  if (exists) return { ok: false, reason: 'output_exists' };

  const workDir = await mkdtemp(join(tmpdir(), 'pack-video-'));
  try {
    const voice = narration ?? (await narrate({ chunks, outPath: join(workDir, 'voice.wav'), ...voiceOptions }));
    if (!voice || !voice.ok || !voice.path) return { ok: false, reason: 'no_voice' };
    const voiceSeconds = voice.seconds ?? wavSeconds(new Uint8Array(await readFile(voice.path)));
    if (!(voiceSeconds > 0)) return { ok: false, reason: 'no_voice' };
    if (voiceSeconds > MAX_VOICE_SECONDS) return { ok: false, reason: 'voice_too_long' };

    const assPath = join(workDir, 'captions.ass');
    await writeFile(assPath, buildAssText(chunks, { seconds: packLook.durationSeconds, fontSize: packLook.captionFontSize, colour: packLook.captionColor }), { encoding: 'utf8', mode: 0o600 });
    await mkdir(dirname(outputPath), { recursive: true });
    const args = buildFfmpegArgs({ imagePath, assPath, outputPath, voicePath: voice.path, voiceSeconds, seconds: packLook.durationSeconds });
    const result = await run(ffmpegCommand(ffmpeg), args, { cwd: workDir, timeoutMs: RENDER_TIMEOUT_MS });
    if (result.timedOut) {
      await rm(outputPath, { force: true });
      return { ok: false, reason: 'render_timeout' };
    }
    if (result.code !== 0) {
      await rm(outputPath, { force: true });
      return { ok: false, reason: 'render_failed', detail: result.stderr.split('\n').slice(-3).join(' ').trim() };
    }
    const info = await stat(outputPath).catch(() => null);
    if (!info || info.size === 0) return { ok: false, reason: 'render_failed', detail: 'No file was written.' };
    if (info.size > MAX_VIDEO_BYTES) {
      await rm(outputPath, { force: true });
      return { ok: false, reason: 'too_large' };
    }
    const probe = await probeMp4(ffmpeg, outputPath);
    if (!probe) {
      await rm(outputPath, { force: true });
      return { ok: false, reason: 'probe_failed' };
    }
    if (!probe.hasAudio) {
      await rm(outputPath, { force: true });
      return { ok: false, reason: 'no_audio' };
    }
    return { ok: true, path: outputPath, bytes: info.size, probe, voice: voice.voice };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  let chunks;
  try {
    chunks = JSON.parse(argValue(args, '--chunks') ?? '[]');
  } catch {
    chunks = null;
  }
  const result = await renderPackVideo({
    imagePath: argValue(args, '--image'),
    chunks,
    outputPath: argValue(args, '--output'),
    ffmpeg: argValue(args, '--ffmpeg'),
    voiceOptions: { geminiKey: process.env.LIXXON_GEMINI_KEY ?? null, espeak: argValue(args, '--espeak') ?? (process.env.LIXXON_ESPEAK || undefined) },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}

/** Whether the FFmpeg command can be run at all. Used by tests to skip the real render when it cannot. */
export function ffmpegAvailable(ffmpeg) {
  const result = spawnSync(ffmpegCommand(ffmpeg), ['-version'], { stdio: 'ignore' });
  return result.status === 0;
}

