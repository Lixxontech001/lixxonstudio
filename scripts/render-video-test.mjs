#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFile, access, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateTestVideoFixture, validateVideoFiles } from './video-asset-validation.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FIXTURE = resolve(REPO_ROOT, 'scripts/fixtures/video-test-article.json');
const PUBLIC_ROOT = resolve(REPO_ROOT, 'public');
const MAX_HERO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 5 * 60 * 1000;
const FONT_SERIF = process.env.LIXXON_VIDEO_SERIF_FONT || '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf';
const FONT_SANS = process.env.LIXXON_VIDEO_SANS_FONT || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

function isWithin(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function hashFile(path) {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function wrapTextWithoutRewriting(text, maxCharacters = 34) {
  const normalized = String(text).normalize('NFC').replace(/\s+/gu, ' ').trim();
  const words = normalized.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (word.length > maxCharacters) throw new Error('A caption word exceeds the safe line width.');
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxCharacters && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  if (lines.length > 6) throw new Error('The exact excerpt does not fit the bounded test caption layout.');
  return lines.join('\n');
}

function ffmpegPath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || !/^[A-Za-z0-9_./-]+$/.test(value)) {
    throw new Error('FFmpeg filter paths must be absolute safe paths.');
  }
  return value;
}

export function buildVideoFilterGraph({ titlePath, captionTextPath, watermarkPath, endCardPath, serifFont, sansFont }) {
  const title = ffmpegPath(titlePath);
  const captionText = ffmpegPath(captionTextPath);
  const watermark = ffmpegPath(watermarkPath);
  const endCard = ffmpegPath(endCardPath);
  const serif = ffmpegPath(serifFont);
  const sans = ffmpegPath(sansFont);
  const drawText = (font, textFile, extra) =>
    `drawtext=fontfile=${font}:textfile=${textFile}:expansion=none:${extra}`;

  return [
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    "zoompan=z='min(zoom+0.00035,1.08)':x='(iw-iw/zoom)/2+(iw-iw/zoom)*0.12*sin(on/90)':y='(ih-ih/zoom)/2+(ih-ih/zoom)*0.08*cos(on/110)':d=1:s=1080x1920:fps=30",
    "drawbox=x=24:y=28:w=585:h=68:color=0x1A1A1A@0.88:t=fill",
    drawText(sans, watermark, 'fontcolor=0xFDFBF7:fontsize=29:x=44:y=45'),
    "drawbox=x=0:y=0:w=iw:h=330:color=0x1A1A1A@0.84:t=fill:enable='lt(t,2)'",
    drawText(serif, title, "fontcolor=0xFDFBF7:fontsize=50:line_spacing=10:x=(w-text_w)/2:y=104:enable='lt(t,2)'"),
    "drawbox=x=54:y=1120:w=972:h=500:color=0x1A1A1A@0.88:t=fill:enable='gte(t,2)*lt(t,10)'",
    drawText(sans, captionText, "fontcolor=0xFFFFFF:fontsize=40:line_spacing=16:x=(w-text_w)/2:y=(h-text_h)/2:enable='gte(t,2)*lt(t,10)'"),
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x1A1A1A@0.97:t=fill:enable='gte(t,10)'",
    drawText(serif, endCard, "fontcolor=0xF2EDE7:fontsize=58:line_spacing=22:x=(w-text_w)/2:y=(h-text_h)/2"),
    'format=yuv420p[vout]',
  ].join(',');
}

export function buildFfmpegArguments({ heroPath, captionsPath, outputPath, filterGraph, durationSeconds }) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 8 || durationSeconds > 60) {
    throw new Error('Render duration must be an integer from 8 to 60 seconds.');
  }
  return [
    '-hide_banner', '-loglevel', 'error', '-n',
    '-loop', '1', '-framerate', '30', '-i', heroPath,
    '-f', 'webvtt', '-i', captionsPath,
    '-filter_complex', filterGraph,
    '-map', '[vout]', '-map', '1:s:0',
    '-t', String(durationSeconds), '-r', '30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p',
    '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
    '-map_metadata', '-1',
    '-metadata', 'title=TEST ONLY - NOT FOR POSTING',
    '-metadata', 'comment=automation-video-test; approval_eligible=false; publish_eligible=false',
    '-movflags', '+faststart', '-an', '-f', 'mp4', outputPath,
  ];
}

function runTool(command, args, timeoutMs = RENDER_TIMEOUT_MS) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('FFmpeg test render timed out safely.'));
    }, timeoutMs);
    child.on('error', () => finish(new Error(`${basename(command)} could not be started.`)));
    child.on('close', code => code === 0
      ? finish()
      : finish(new Error(`${basename(command)} exited unsuccessfully; no test asset was accepted.`)));
  });
}

async function ensureNonexistent(path) {
  try {
    await stat(path);
    throw new Error('The test renderer refuses to overwrite an existing artifact.');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}

async function resolveFixtureHero(fixture) {
  const candidate = resolve(REPO_ROOT, fixture.hero_image);
  if (!isWithin(PUBLIC_ROOT, candidate)) throw new Error('The test hero image must remain inside the repository public asset root.');
  const actual = await realpath(candidate);
  if (!isWithin(PUBLIC_ROOT, actual)) throw new Error('The test hero image resolves outside the public asset root.');
  const info = await stat(actual);
  if (!info.isFile() || info.size < 1 || info.size > MAX_HERO_BYTES
      || !['.jpg', '.jpeg', '.png', '.webp'].includes(extname(actual).toLowerCase())) {
    throw new Error('The fixture hero image is missing or outside the supported image limits.');
  }
  return actual;
}

async function resolveOutputPath(outputPath) {
  if (typeof outputPath !== 'string' || !outputPath.trim()) throw new Error('A test artifact output path is required.');
  const absolute = resolve(outputPath);
  const tempRoots = [process.env.RUNNER_TEMP, tmpdir()].filter(Boolean).map(value => resolve(value));
  if (isWithin(REPO_ROOT, absolute) || !tempRoots.some(root => isWithin(root, absolute))
      || !absolute.includes(`${sep}automation-video-test${sep}`)
      || extname(absolute).toLowerCase() !== '.mp4') {
    throw new Error('Test video output must be an MP4 inside an automation-video-test temporary namespace, never the site or repository.');
  }
  return absolute;
}

function vttTimestamp(seconds) {
  const millis = Math.round(seconds * 1000);
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const rest = millis % 60_000;
  const secs = Math.floor(rest / 1000);
  const ms = rest % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export async function renderTestVideo({
  fixturePath = DEFAULT_FIXTURE,
  outputPath,
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  serifFont = FONT_SERIF,
  sansFont = FONT_SANS,
} = {}) {
  const resolvedFixturePath = resolve(fixturePath);
  if (resolvedFixturePath !== DEFAULT_FIXTURE) throw new Error('Only the checked-in, non-publishable video test fixture is accepted.');
  const fixtureRealPath = await realpath(resolvedFixturePath);
  const fixtureText = await readFile(fixtureRealPath, 'utf8');
  let fixture;
  try { fixture = JSON.parse(fixtureText); }
  catch { throw new Error('The checked-in test article fixture is invalid JSON.'); }
  validateTestVideoFixture(fixture);

  const target = await resolveOutputPath(outputPath);
  await ensureNonexistent(target);
  const outputDirectory = dirname(target);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const [serifExists, sansExists] = await Promise.all([
    access(serifFont).then(() => true, () => false),
    access(sansFont).then(() => true, () => false),
  ]);
  if (!serifExists || !sansExists) throw new Error('The runner is missing the required serif/sans font fallback.');

  const heroPath = await resolveFixtureHero(fixture);
  const captionTextPath = target.replace(/\.mp4$/i, '.captions.txt');
  const captionsPath = target.replace(/\.mp4$/i, '.vtt');
  const titlePath = target.replace(/\.mp4$/i, '.title.txt');
  const watermarkPath = target.replace(/\.mp4$/i, '.watermark.txt');
  const endCardPath = target.replace(/\.mp4$/i, '.end-card.txt');
  const evidencePath = target.replace(/\.mp4$/i, '.evidence.json');
  const expectedDuration = fixture.expected_duration_seconds;
  const captionStart = Math.min(2, expectedDuration / 4);
  const captionEnd = expectedDuration - Math.min(2, expectedDuration / 6);
  const captions = `WEBVTT\n\n${vttTimestamp(captionStart)} --> ${vttTimestamp(captionEnd)}\n${fixture.test_excerpt}\n`;
  const sidecars = [captionTextPath, captionsPath, titlePath, watermarkPath, endCardPath, evidencePath];
  for (const sidecar of sidecars) await ensureNonexistent(sidecar);

  const articleBodyChecksumBefore = sha256(fixture.article_body);
  await Promise.all([
    writeFile(captionTextPath, wrapTextWithoutRewriting(fixture.test_excerpt), { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
    writeFile(captionsPath, captions, { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
    writeFile(titlePath, fixture.title, { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
    writeFile(watermarkPath, 'TEST ONLY — NOT FOR POSTING', { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
    writeFile(endCardPath, 'Lixxon Studio\nTEST ONLY · NOT FOR POSTING', { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
  ]);

  const filterGraph = buildVideoFilterGraph({ titlePath, captionTextPath, watermarkPath, endCardPath, serifFont, sansFont });
  const args = buildFfmpegArguments({
    heroPath, captionsPath, outputPath: target, filterGraph, durationSeconds: expectedDuration,
  });
  await runTool(ffmpeg, args);

  const fixtureAfterText = await readFile(fixtureRealPath, 'utf8');
  let fixtureAfter;
  try { fixtureAfter = JSON.parse(fixtureAfterText); }
  catch { throw new Error('The test fixture changed into an invalid state during render.'); }
  const articleBodyChecksumAfter = sha256(fixtureAfter.article_body);
  if (articleBodyChecksumBefore !== articleBodyChecksumAfter) throw new Error('The fixture article-body checksum changed during render.');

  const validation = await validateVideoFiles({
    mode: 'test', videoPath: target, captionsPath, altTextPath: await writeAltText(target, fixture.alt_text),
    fixture, bodyChecksumBefore: articleBodyChecksumBefore, bodyChecksumAfter: articleBodyChecksumAfter,
    ffmpegPath: ffmpeg, ffprobePath: ffprobe,
  });
  const info = await stat(target);
  if (!info.isFile() || info.size > MAX_VIDEO_BYTES) throw new Error('Rendered test video exceeded the 100 MB artifact limit.');
  const summary = {
    valid: true,
    fixtureId: fixture.fixture_id,
    namespace: fixture.namespace,
    testOnly: validation.testOnly,
    approvalEligible: validation.approvalEligible,
    publishEligible: validation.publishEligible,
    source: 'repository brand hero image; no Coverr key or network request used',
    codec: validation.codec,
    width: validation.width,
    height: validation.height,
    durationSeconds: validation.durationSeconds,
    expectedDurationSeconds: validation.expectedDurationSeconds,
    subtitleCodec: validation.subtitleCodec,
    captionTrackPresent: validation.captionTrackPresent,
    captionCount: validation.captionCount,
    audioTrack: 'none; intentionally silent',
    altTextPresent: validation.altTextVerified,
    fileBytes: info.size,
    maxFileBytes: MAX_VIDEO_BYTES,
    videoSha256: await hashFile(target),
    articleBodySha256Before: articleBodyChecksumBefore,
    articleBodySha256After: articleBodyChecksumAfter,
    articleBodyImmutable: validation.articleBodyImmutable,
  };
  await writeFile(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  process.stdout.write(`[video-test] Rendered and validated in ${fixture.namespace}; no provider, DB, approval or publish endpoint was used.\n`);
  process.stdout.write(`[video-test] ${JSON.stringify(summary)}\n`);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await appendFile(summaryPath, [
      '## Ephemeral video renderer test — not for posting', '',
      `- Namespace: \`${fixture.namespace}\``,
      `- Result: **${summary.valid ? 'PASS' : 'FAIL'}**`,
      `- Video: ${summary.codec}, ${summary.width}×${summary.height}, ${summary.durationSeconds}s; subtitle ${summary.subtitleCodec}; silent with alt text`,
      `- File: ${summary.fileBytes} bytes; SHA-256 \`${summary.videoSha256}\``,
      `- Fixture article body unchanged: \`${summary.articleBodyImmutable}\``,
      '- `approvalEligible=false`; `publishEligible=false`; no production API or channel queue was called.', '',
    ].join('\n'));
  }
  return { ...summary, outputPath: target, evidencePath };
}

async function writeAltText(target, altText) {
  const path = target.replace(/\.mp4$/i, '.alt.txt');
  await ensureNonexistent(path);
  await writeFile(path, altText, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return path;
}

function parseCli(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || values.has(key)) throw new Error('Use --mode test --fixture <checked-in fixture> --output <runner temp MP4>.');
    values.set(key, value);
  }
  if (values.get('--mode') !== 'test' || !values.get('--fixture') || !values.get('--output') || values.size !== 3) {
    throw new Error('Only --mode test with the checked-in fixture and a temporary output MP4 is supported.');
  }
  return { mode: values.get('--mode'), fixturePath: values.get('--fixture'), outputPath: values.get('--output') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await renderTestVideo(parseCli(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`Video test render failed safely: ${error instanceof Error ? error.message : 'invalid input'}\n`);
    process.exitCode = 1;
  }
}
