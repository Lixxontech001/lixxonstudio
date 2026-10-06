import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import testArticle from '../../scripts/fixtures/video-test-article.json';
import { renderTestVideo, buildFfmpegArguments, buildVideoFilterGraph } from '../../scripts/render-video-test.mjs';
import { validateTestVideoFixture, validateVideoAssetContract } from '../../scripts/video-asset-validation.mjs';

const EXCERPT = 'A calm, owner-approved excerpt about simple skincare habits.';
const HASH = 'a'.repeat(64);
const POST_ID = '86000000-0000-4000-8000-000000000001';

function fixture() {
  return {
    probe: {
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p' },
        { codec_type: 'subtitle', codec_name: 'mov_text' },
      ],
      format: { duration: '12.5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    },
    captions: `WEBVTT\n\n00:00:00.000 --> 00:00:12.000\n${EXCERPT}\n`,
    altText: 'Vertical skincare explainer with calm cream-and-bronze title cards.',
    approval: {
      article_id: POST_ID,
      video_approved: true,
      owner_approved_at: '2026-10-06T12:00:00.000Z',
      distribution_payload_sha256: HASH,
      approved_excerpt: EXCERPT,
      article_body_sha256_before: HASH,
      article_body_sha256_after: HASH,
    },
    attribution: { background: 'brand_gradient', stock_asset: null },
    videoBytes: 512_000,
  };
}

describe('video asset contract validator', () => {
  it('accepts only an owner-approved excerpt with a muted vertical H.264 MP4 and immutable body checksum', () => {
    const result = validateVideoAssetContract(fixture());
    expect(result).toEqual({
      durationSeconds: 12.5,
      expectedDurationSeconds: null,
      width: 1080,
      height: 1920,
      codec: 'h264',
      subtitleCodec: 'mov_text',
      captionTrackPresent: true,
      soundMode: 'silent_no_audio_stream',
      altTextVerified: true,
      captionCount: 1,
      articleBodyImmutable: true,
      articleBodySha256Before: HASH,
      articleBodySha256After: HASH,
      testOnly: false,
      approvalEligible: true,
      publishEligible: false,
      stockAttributionVerified: true,
    });
  });

  it('accepts only a checksum-stable test fixture that can never be approved or published', () => {
    expect(validateTestVideoFixture(testArticle)).toBe(testArticle);
    const bodyHash = createHash('sha256').update(testArticle.article_body, 'utf8').digest('hex');
    const media = fixture();
    media.probe.format.duration = '12';
    media.captions = `WEBVTT\n\n00:00:02.000 --> 00:00:10.000\n${testArticle.test_excerpt}\n`;
    media.altText = testArticle.alt_text;
    const result = validateVideoAssetContract({
      ...media,
      mode: 'test',
      fixture: testArticle,
      bodyChecksumBefore: bodyHash,
      bodyChecksumAfter: bodyHash,
      approval: undefined,
      attribution: { background: 'brand_asset', stock_asset: null },
    });
    expect(result).toMatchObject({
      testOnly: true, approvalEligible: false, publishEligible: false,
      expectedDurationSeconds: 12, durationSeconds: 12, articleBodyImmutable: true,
    });
    expect(() => validateVideoAssetContract({
      ...media, mode: 'test', fixture: testArticle, bodyChecksumBefore: bodyHash,
      bodyChecksumAfter: 'b'.repeat(64), approval: undefined,
      attribution: { background: 'brand_asset', stock_asset: null },
    })).toThrow('unchanged article-body checksum');
    expect(() => validateTestVideoFixture({ ...testArticle, approval_eligible: true }))
      .toThrow('ineligible for approval or publishing');
  });

  it('builds an actual portrait render graph with slow zoom, exact captions, mov_text and explicit silence', () => {
    const filterGraph = buildVideoFilterGraph({
      titlePath: '/tmp/automation-video-test/title.txt',
      captionTextPath: '/tmp/automation-video-test/captions.txt',
      watermarkPath: '/tmp/automation-video-test/watermark.txt',
      endCardPath: '/tmp/automation-video-test/end.txt',
      serifFont: '/tmp/automation-video-test/serif.ttf',
      sansFont: '/tmp/automation-video-test/sans.ttf',
    });
    const args = buildFfmpegArguments({
      heroPath: '/repo/public/hero.webp',
      captionsPath: '/tmp/automation-video-test/captions.vtt',
      outputPath: '/tmp/automation-video-test/video.mp4',
      filterGraph,
      durationSeconds: 12,
    });
    expect(filterGraph).toContain('zoompan=');
    expect(filterGraph).toContain('sin(on/90)');
    expect(filterGraph).toContain('cos(on/110)');
    expect(filterGraph).toContain('drawtext=');
    expect(filterGraph).toContain('textfile=');
    expect(args).toContain('libx264');
    expect(args).toContain('mov_text');
    expect(args).toContain('1:s:0');
    expect(args).toContain('-an');
    expect(args.at(-1)).toBe('/tmp/automation-video-test/video.mp4');
  });

  it('executes the CLI when invoked by a relative script path', () => {
    const result = spawnSync(process.execPath, [
      'scripts/render-video-test.mjs',
      '--mode', 'test',
      '--fixture', 'scripts/fixtures/video-test-article.json',
      '--output', join(tmpdir(), 'lixxon-cli-invalid-test', 'lixxon-test.mp4'),
    ], { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Test video output must be an MP4 inside an automation-video-test temporary namespace');
  });

  it('runs the callable renderer and existing file validator with a non-eligible test fixture', async () => {
    const root = join(tmpdir(), 'automation-video-test', `vitest-${process.pid}-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const fakeFfmpeg = join(root, 'ffmpeg-test-bin');
    const fakeFfprobe = join(root, 'ffprobe-test-bin');
    const serifFont = join(root, 'serif.ttf');
    const sansFont = join(root, 'sans.ttf');
    const probe = {
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p' },
        { codec_type: 'subtitle', codec_name: 'mov_text' },
      ],
      format: { duration: '12', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    };
    await writeFile(fakeFfmpeg, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);if(args.includes('libx264'))fs.writeFileSync(args.at(-1),'fake-mp4-test-data');\n`);
    await writeFile(fakeFfprobe, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(probe))});\n`);
    await Promise.all([chmod(fakeFfmpeg, 0o700), chmod(fakeFfprobe, 0o700), writeFile(serifFont, 'fixture font'), writeFile(sansFont, 'fixture font')]);
    try {
      const result = await renderTestVideo({
        outputPath: join(root, 'lixxon-test.mp4'),
        ffmpeg: fakeFfmpeg,
        ffprobe: fakeFfprobe,
        serifFont,
        sansFont,
      });
      expect(result).toMatchObject({
        valid: true, namespace: 'automation-video-test', testOnly: true,
        approvalEligible: false, publishEligible: false, codec: 'h264',
        width: 1080, height: 1920, subtitleCodec: 'mov_text', captionTrackPresent: true,
        audioTrack: 'none; intentionally silent', altTextPresent: true,
        articleBodyImmutable: true, expectedDurationSeconds: 12,
      });
      expect(result.fileBytes).toBeGreaterThan(0);
      expect(result.videoSha256).toMatch(/^[a-f0-9]{64}$/);
      const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8'));
      expect(evidence.publishEligible).toBe(false);
      expect(evidence.articleBodySha256Before).toBe(evidence.articleBodySha256After);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows caption layout whitespace only, not punctuation or case edits', () => {
    const wrapped = fixture();
    wrapped.captions = `WEBVTT\n\n00:00:00.000 --> 00:00:12.000\nA calm, owner-approved excerpt about simple\nskincare habits.\n`;
    expect(validateVideoAssetContract(wrapped).captionCount).toBe(1);
    expect(() => validateVideoAssetContract({ ...fixture(), captions:
      `WEBVTT\n\n00:00:00.000 --> 00:00:12.000\nA calm owner-approved excerpt about simple skincare habits.\n`,
    })).toThrow('exact owner-approved excerpt');
    expect(() => validateVideoAssetContract({ ...fixture(), captions:
      `WEBVTT\n\n00:00:00.000 --> 00:00:12.000\na calm, owner-approved excerpt about simple skincare habits.\n`,
    })).toThrow('exact owner-approved excerpt');
  });

  it('rejects unapproved, altered, body-bearing, or uncaptained source material', () => {
    expect(() => validateVideoAssetContract({ ...fixture(), approval: { ...fixture().approval, video_approved: false } }))
      .toThrow('owner-approved excerpt');
    expect(() => validateVideoAssetContract({ ...fixture(), approval: { ...fixture().approval, article_body_sha256_after: 'b'.repeat(64) } }))
      .toThrow('unchanged article-body checksum');
    expect(() => validateVideoAssetContract({ ...fixture(), approval: { ...fixture().approval, content: 'Never accept article body.' } }))
      .toThrow('owner-approved excerpt');
    expect(() => validateVideoAssetContract({ ...fixture(), captions: 'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nRewritten caption.\n' }))
      .toThrow('exact owner-approved excerpt');
    expect(() => validateVideoAssetContract({ ...fixture(), altText: '' })).toThrow('alt text');
  });

  it('rejects audio, missing caption track, wrong dimensions, excessive duration and malformed MP4 metadata', () => {
    const noSubtitles = fixture();
    noSubtitles.probe.streams = noSubtitles.probe.streams.filter(stream => stream.codec_type !== 'subtitle');
    expect(() => validateVideoAssetContract(noSubtitles)).toThrow('embedded captions');
    expect(() => validateVideoAssetContract({ ...fixture(), probe: {
      ...fixture().probe, streams: [...fixture().probe.streams, { codec_type: 'audio', codec_name: 'aac' }],
    } })).toThrow('muted H.264 MP4');
    expect(() => validateVideoAssetContract({ ...fixture(), probe: {
      ...fixture().probe, streams: [{ ...fixture().probe.streams[0], width: 720 }],
    } })).toThrow('muted H.264 MP4');
    expect(() => validateVideoAssetContract({ ...fixture(), probe: {
      ...fixture().probe, format: { ...fixture().probe.format, duration: '61' },
    } })).toThrow('muted H.264 MP4');
  });

  it('requires owner-confirmed Coverr licensing and attribution whenever stock is used', () => {
    const input = fixture();
    input.attribution = {
      background: 'coverr_stock',
      stock_asset: {
        provider: 'Coverr', asset_id: 'stock-asset-1', source_url: 'https://coverr.co/video/stock-asset-1',
        license_url: 'https://coverr.co/license', license_name: 'Coverr Free License',
        creator: 'Verified creator', attribution_text: 'Stock footage by Verified creator via Coverr.',
        license_confirmed: true, owner_approved: true,
      },
    };
    expect(validateVideoAssetContract(input).stockAttributionVerified).toBe(true);
    input.attribution.stock_asset.license_confirmed = false;
    expect(() => validateVideoAssetContract(input)).toThrow('confirmed license');
  });
});
