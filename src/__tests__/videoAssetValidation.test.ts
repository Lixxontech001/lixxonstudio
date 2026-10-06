import { describe, expect, it } from 'vitest';
import { validateVideoAssetContract } from '../../scripts/video-asset-validation.mjs';

const EXCERPT = 'A calm, owner-approved excerpt about simple skincare habits.';
const HASH = 'a'.repeat(64);
const POST_ID = '86000000-0000-4000-8000-000000000001';

function fixture() {
  return {
    probe: {
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p' }],
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
      width: 1080,
      height: 1920,
      codec: 'h264',
      soundMode: 'muted',
      captionCount: 1,
      articleBodyImmutable: true,
      stockAttributionVerified: true,
    });
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

  it('rejects audio, wrong dimensions, excessive duration and malformed MP4 metadata', () => {
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
