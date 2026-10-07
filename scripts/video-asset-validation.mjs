#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname } from 'node:path';

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_CAPTION_BYTES = 32 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const HASH_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_TEST_NAMESPACE = 'automation-video-test';
const VIDEO_TEST_FIXTURE_ID = 'lixxon-video-fixture-3.2-v1';

function normalizedExcerpt(value) {
  // Allow caption line wrapping/whitespace only; punctuation, casing and wording stay owner-exact.
  return String(value).normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function validHttps(value, allowedHost) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === allowedHost || url.hostname.endsWith(`.${allowedHost}`))
      && !url.username && !url.password;
  } catch { return false; }
}

function parseTimestamp(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})$/.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds, millis] = match;
  if (Number(minutes) > 59 || Number(seconds) > 59) return null;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;
}

function parseCaptions(captions, durationSeconds, approvedExcerpt) {
  if (typeof captions !== 'string' || Buffer.byteLength(captions, 'utf8') > MAX_CAPTION_BYTES
      || !/^WEBVTT(?:\r?\n|$)/.test(captions)) throw new Error('Captions must be a bounded WebVTT sidecar.');
  const cues = [];
  for (const block of captions.replace(/\r/g, '').split(/\n{2,}/).slice(1)) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = /^([^ ]+)\s+-->\s+([^ ]+)(?:\s+.*)?$/.exec(lines[timingIndex]);
    if (!timing) throw new Error('A caption cue has an invalid time range.');
    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    if (start === null || end === null || end <= start || end > durationSeconds || start < (cues.at(-1)?.end ?? 0)) {
      throw new Error('Caption cues must be ordered and fit within the video duration.');
    }
    const text = lines.slice(timingIndex + 1).join(' ').trim();
    if (!text || /<\/?(?:script|style|iframe|img|audio|video)\b/i.test(text)) {
      throw new Error('Caption text is empty or contains unsupported markup.');
    }
    cues.push({ start, end, text });
  }
  if (cues.length === 0) throw new Error('At least one timed caption cue is required.');
  const spoken = normalizedExcerpt(cues.map(cue => cue.text).join(' '));
  if (!spoken || spoken !== normalizedExcerpt(approvedExcerpt)) {
    throw new Error('Caption text must match the exact owner-approved excerpt.');
  }
  return cues.length;
}

function validateAttribution(attribution) {
  if (!attribution || typeof attribution !== 'object' || Array.isArray(attribution)
      || !['brand_gradient', 'brand_asset', 'coverr_stock'].includes(attribution.background)) {
    throw new Error('A recognized branded background source is required.');
  }
  if (attribution.background === 'brand_gradient' || attribution.background === 'brand_asset') {
    if (attribution.stock_asset !== null) throw new Error('Stock metadata must be absent when no stock footage is used.');
    return;
  }
  const asset = attribution.stock_asset;
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)
      || asset.provider !== 'Coverr' || typeof asset.asset_id !== 'string' || asset.asset_id.length < 1 || asset.asset_id.length > 120
      || !validHttps(asset.source_url, 'coverr.co') || !validHttps(asset.license_url, 'coverr.co')
      || typeof asset.creator !== 'string' || asset.creator.trim().length < 1 || asset.creator.length > 120
      || typeof asset.license_name !== 'string' || asset.license_name.trim().length < 3 || asset.license_name.length > 120
      || typeof asset.attribution_text !== 'string' || asset.attribution_text.trim().length < 5 || asset.attribution_text.length > 500
      || asset.license_confirmed !== true || asset.owner_approved !== true) {
    throw new Error('Coverr stock must have confirmed license, source, creator attribution, and owner approval.');
  }
}

/** Validate an immutable, non-publishable fixture with no owner approval or provider state. */
export function validateTestVideoFixture(fixture) {
  const allowedKeys = new Set([
    'fixture_id', 'mode', 'namespace', 'article_id', 'status', 'title', 'article_body',
    'test_excerpt', 'hero_image', 'alt_text', 'expected_duration_seconds',
    'publish_eligible', 'approval_eligible',
  ]);
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)
      || Object.keys(fixture).some(key => !allowedKeys.has(key))
      || fixture.fixture_id !== VIDEO_TEST_FIXTURE_ID || fixture.mode !== 'test'
      || fixture.namespace !== VIDEO_TEST_NAMESPACE || fixture.article_id !== 'test-article-do-not-publish-3-2'
      || fixture.status !== 'fixture_only' || fixture.publish_eligible !== false || fixture.approval_eligible !== false
      || typeof fixture.title !== 'string' || !fixture.title.startsWith('TEST ONLY') || fixture.title.length > 160
      || typeof fixture.article_body !== 'string' || !fixture.article_body.startsWith('TEST ONLY.') || fixture.article_body.length > 10_000
      || typeof fixture.test_excerpt !== 'string' || fixture.test_excerpt.trim().length < 1
      || fixture.test_excerpt.length > 3_000 || !fixture.article_body.includes(fixture.test_excerpt)
      || typeof fixture.hero_image !== 'string' || !fixture.hero_image.startsWith('public/')
      || fixture.hero_image.includes('..') || fixture.hero_image.length > 240
      || typeof fixture.alt_text !== 'string' || !fixture.alt_text.startsWith('TEST ONLY:') || fixture.alt_text.length > 500
      || !Number.isInteger(fixture.expected_duration_seconds)
      || fixture.expected_duration_seconds < 8 || fixture.expected_duration_seconds > 60) {
    throw new Error('The test fixture must be namespaced, immutable, and ineligible for approval or publishing.');
  }
  return fixture;
}

/** Validate a real owner-approved asset or an isolated, never-publishable test fixture. */
export function validateVideoAssetContract({
  mode = 'production', fixture, bodyChecksumBefore, bodyChecksumAfter,
  probe, captions, altText, approval, attribution, videoBytes, expectedDurationSeconds,
}) {
  let approvedExcerpt;
  let immutableBefore;
  let immutableAfter;
  let testOnly = false;

  if (mode === 'test') {
    validateTestVideoFixture(fixture);
    if (approval !== undefined || altText !== fixture.alt_text
        || !HASH_RE.test(String(bodyChecksumBefore)) || bodyChecksumBefore !== bodyChecksumAfter) {
      throw new Error('Test video requires fixture-only metadata, unchanged article-body checksum and no owner approval.');
    }
    approvedExcerpt = fixture.test_excerpt;
    immutableBefore = bodyChecksumBefore;
    immutableAfter = bodyChecksumAfter;
    testOnly = true;
  } else if (mode === 'production') {
    if (fixture !== undefined || bodyChecksumBefore !== undefined || bodyChecksumAfter !== undefined
        || !approval || typeof approval !== 'object' || Array.isArray(approval)
        || Object.keys(approval).some(key => ![
          'article_id', 'video_approved', 'owner_approved_at', 'distribution_payload_sha256',
          'approved_excerpt', 'article_body_sha256_before', 'article_body_sha256_after',
        ].includes(key))
        || !UUID_RE.test(String(approval.article_id)) || approval.video_approved !== true
        || typeof approval.owner_approved_at !== 'string' || !Number.isFinite(Date.parse(approval.owner_approved_at))
        || !HASH_RE.test(String(approval.distribution_payload_sha256))
        || typeof approval.approved_excerpt !== 'string' || approval.approved_excerpt.trim().length < 1
        || approval.approved_excerpt.length > 3000
        || !HASH_RE.test(String(approval.article_body_sha256_before))
        || approval.article_body_sha256_before !== approval.article_body_sha256_after) {
      throw new Error('A current owner-approved excerpt and unchanged article-body checksum are required.');
    }
    approvedExcerpt = approval.approved_excerpt;
    immutableBefore = approval.article_body_sha256_before;
    immutableAfter = approval.article_body_sha256_after;
  } else {
    throw new Error('Video validation mode must be production or test.');
  }

  if (!probe || typeof probe !== 'object' || !Array.isArray(probe.streams) || !probe.format || typeof probe.format !== 'object') {
    throw new Error('FFprobe metadata is missing.');
  }
  if (!Number.isInteger(videoBytes) || videoBytes < 1 || videoBytes > MAX_VIDEO_BYTES) {
    throw new Error('Video size is outside the 1–100 MB safety limit.');
  }
  if (typeof altText !== 'string' || altText.trim().length < 8 || altText.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(altText)) {
    throw new Error('Accessible video alt text must be present and bounded.');
  }
  validateAttribution(attribution);

  const videoStreams = probe.streams.filter(stream => stream && stream.codec_type === 'video');
  const audioStreams = probe.streams.filter(stream => stream && stream.codec_type === 'audio');
  const subtitleStreams = probe.streams.filter(stream => stream && stream.codec_type === 'subtitle');
  const video = videoStreams[0];
  const subtitle = subtitleStreams[0];
  const duration = Number(probe.format.duration);
  const formatNames = String(probe.format.format_name || '').split(',');
  // A video template may set its own duration (V22), so the expected duration is an
  // explicit, bounded input to the contract rather than an implicit fixture value.
  if (expectedDurationSeconds !== undefined
      && (!Number.isInteger(expectedDurationSeconds) || expectedDurationSeconds < 8 || expectedDurationSeconds > 60)) {
    throw new Error('An expected duration must be an integer from 8 to 60 seconds.');
  }
  const expectedDuration = mode === 'test'
    ? (expectedDurationSeconds ?? fixture.expected_duration_seconds)
    : null;
  if (videoStreams.length !== 1 || audioStreams.length !== 0 || subtitleStreams.length !== 1
      || video?.codec_name !== 'h264' || video.width !== 1080 || video.height !== 1920 || video.pix_fmt !== 'yuv420p'
      || subtitle?.codec_name !== 'mov_text' || !formatNames.includes('mp4')
      || !Number.isFinite(duration) || duration < 8 || duration > 60
      || (expectedDuration !== null && Math.abs(duration - expectedDuration) > 0.25)) {
    throw new Error('Video must be muted H.264 MP4, 1080×1920, yuv420p, with embedded captions and the expected 8–60 second duration.');
  }
  const captionCount = parseCaptions(captions, duration, approvedExcerpt);
  return {
    durationSeconds: Math.round(duration * 1000) / 1000,
    expectedDurationSeconds: expectedDuration,
    width: video.width,
    height: video.height,
    codec: video.codec_name,
    subtitleCodec: subtitle.codec_name,
    captionTrackPresent: true,
    soundMode: 'silent_no_audio_stream',
    altTextVerified: true,
    captionCount,
    articleBodyImmutable: immutableBefore === immutableAfter,
    articleBodySha256Before: immutableBefore,
    articleBodySha256After: immutableAfter,
    testOnly,
    approvalEligible: !testOnly,
    publishEligible: false,
    stockAttributionVerified: attribution.background !== 'coverr_stock' || attribution.stock_asset.license_confirmed === true,
  };
}

function runTool(command, args, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const stdout = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Media validation timed out.')); }, timeoutMs);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 128 * 1024) { child.kill('SIGKILL'); reject(new Error('Media probe output exceeded its limit.')); return; }
      stdout.push(chunk);
    });
    child.on('error', () => { clearTimeout(timer); reject(new Error(`${command} is not installed.`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${command} could not validate or decode the asset.`));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

async function readBounded(path, maxBytes) {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) throw new Error('A validation sidecar is missing or too large.');
  return readFile(path, 'utf8');
}

export async function validateVideoFiles({
  mode = 'production', videoPath, captionsPath, altTextPath, approvalPath, attributionPath,
  fixture, bodyChecksumBefore, bodyChecksumAfter, expectedDurationSeconds,
  ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe',
}) {
  if (extname(videoPath).toLowerCase() !== '.mp4') throw new Error('Only an MP4 asset can be validated.');
  const videoInfo = await stat(videoPath);
  if (!videoInfo.isFile() || videoInfo.size < 1 || videoInfo.size > MAX_VIDEO_BYTES) throw new Error('Video size is outside the 1–100 MB safety limit.');
  const [captions, altText, probeText] = await Promise.all([
    readBounded(captionsPath, MAX_CAPTION_BYTES),
    readBounded(altTextPath, 2_000),
    runTool(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,pix_fmt', '-of', 'json', videoPath]),
  ]);
  let approval; let attribution;
  if (mode === 'production') {
    if (!approvalPath || !attributionPath) throw new Error('Owner approval and attribution sidecars are required.');
    try {
      approval = JSON.parse(await readBounded(approvalPath, MAX_METADATA_BYTES));
      attribution = JSON.parse(await readBounded(attributionPath, MAX_METADATA_BYTES));
    } catch { throw new Error('Video metadata sidecars are invalid.'); }
  } else if (mode !== 'test' || !fixture) {
    throw new Error('Test validation requires the namespaced fixture; other modes are unavailable.');
  }
  let probe;
  try { probe = JSON.parse(probeText); }
  catch { throw new Error('FFprobe metadata is invalid.'); }
  const result = validateVideoAssetContract({
    mode, fixture, bodyChecksumBefore, bodyChecksumAfter, expectedDurationSeconds,
    probe, captions, altText: altText.trim(), approval,
    attribution: mode === 'test' ? { background: 'brand_asset', stock_asset: null } : attribution,
    videoBytes: videoInfo.size,
  });
  await runTool(ffmpegPath, ['-hide_banner', '-v', 'error', '-i', videoPath, '-f', 'null', '-']);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1]) throw new Error('Use --video, --captions, --alt-text, --approval, and --attribution paths.');
    values.set(args[i], args[i + 1]);
  }
  const required = ['--video', '--captions', '--alt-text', '--approval', '--attribution'];
  if (required.some(key => !values.has(key)) || values.size !== required.length) throw new Error('All five video validation sidecars are required.');
  const result = await validateVideoFiles({
    videoPath: values.get('--video'), captionsPath: values.get('--captions'), altTextPath: values.get('--alt-text'),
    approvalPath: values.get('--approval'), attributionPath: values.get('--attribution'),
  });
  process.stdout.write(`${JSON.stringify({ valid: true, ...result })}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => {
    process.stderr.write(`Video asset validation failed safely: ${error instanceof Error ? error.message : 'invalid input'}\n`);
    process.exitCode = 1;
  });
}
