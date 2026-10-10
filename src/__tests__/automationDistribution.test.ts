import { describe, expect, it } from 'vitest';
import {
  DISTRIBUTION_CHANNEL_KEYS,
  DISTRIBUTION_DEEP_LINKS,
  KIT_SLOT_KEYS,
  channelNeedsVideo,
  distributionKitSteps,
  distributionShareUrl,
  parseDailyKitState,
  parseDistributionArticles,
  parseDistributionSnapshot,
} from '../lib/automationDistribution';

const POST_ID = '85000000-0000-4000-8000-000000000001';
const SLUG = 'owner-written-article';

function snapshotFixture() {
  return {
    post_id: POST_ID,
    title: 'Owner title',
    slug: SLUG,
    status: 'published',
    scheduled_at_utc: null,
    excerpt: 'Owner-authored excerpt only.',
    cover_image: null,
    cover_image_alt: '',
    flags: { 'automation.enabled': false, 'automation.distribution': false },
    channels: DISTRIBUTION_CHANNEL_KEYS.map(channel => ({
      channel_key: channel,
      label: channel,
      state: 'manual_kit',
      state_reason: 'No provider readback is recorded.',
      approval_required: true,
      auto_publish_enabled: false,
      daily_free_quota: channel === 'telegram' ? 10 : null,
      quota_remaining: channel === 'telegram' ? 10 : null,
      last_readback_status: 'not_tested',
      last_readback_at: null,
      circuit_state: 'closed',
      failure_streak: 0,
      last_failure_class: null,
      retry_after: null,
      usage_today: {
        usage_day: '2026-10-06', readback_attempts: 0, delivery_attempts: 0,
        delivery_successes: 0, delivery_failures: 0, owner_test_email_attempts: 0,
      },
      draft: null,
    })),
    metrics: [{
      channel_key: 'telegram', metric_key: 'clicks', value: 17,
      measurement_kind: 'measured', collection_basis: 'provider_aggregate',
      period_start: '2026-10-05', period_end: '2026-10-05', sample_count: 1, variant_id: null,
    }],
  };
}

describe('Daily Distribution Kit parsing and share links', () => {
  it('accepts only the exact two known boolean feature flags and 13 safe channels', () => {
    const input = snapshotFixture();
    expect(parseDistributionSnapshot(input)?.flags).toEqual({
      'automation.enabled': false,
      'automation.distribution': false,
    });
    expect(parseDistributionSnapshot({ ...input, flags: undefined })).toBeNull();
    expect(parseDistributionSnapshot({ ...input, flags: { 'automation.enabled': false } })).toBeNull();
    expect(parseDistributionSnapshot({ ...input, channels: input.channels.slice(1) })).toBeNull();
    expect(parseDistributionSnapshot({ ...input, channels: input.channels.map((channel, index) => index === 0
      ? { ...channel, auto_publish_enabled: true } : channel) })).toBeNull();
  });

  it('parses only eligible scheduled/published articles and rejects prose-bearing channel keys', () => {
    expect(parseDistributionArticles({ articles: [{
      id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published', scheduled_at_utc: null,
    }] })).toEqual([{
      id: POST_ID, title: 'Owner title', slug: SLUG, status: 'published', scheduledAtUtc: null,
    }]);
    expect(parseDistributionArticles({ articles: [{
      id: POST_ID, title: 'Owner title', slug: SLUG, status: 'draft', scheduled_at_utc: null,
    }] })).toBeNull();
  });

  it('builds platform links from the approved UTM URL and escapes all query data', () => {
    const payload = {
      title: 'Question & answer', subject: 'Subject', caption: 'Read <this> safely',
      hashtags: ['#skincare'], cta: 'Read the article',
      link: `https://lixxonstudio.com/blog/${SLUG}?utm_source=telegram&utm_medium=organic_social&utm_campaign=${SLUG}`,
      imageUrl: null, imageAlt: '',
    };
    expect(distributionShareUrl('telegram', payload)).toContain(encodeURIComponent(payload.link));
    expect(distributionShareUrl('telegram', payload)).toContain(encodeURIComponent(payload.caption));
    expect(distributionShareUrl('facebook', payload)).toContain('sharer.php');
    expect(distributionShareUrl('site_widget', payload)).toBe(payload.link);
    expect(distributionShareUrl('newsletter', payload)).toBe('/admin/newsletter');
  });
});

describe('daily kit completeness helpers', () => {
  it('gives every channel a numbered list of three to five steps that matches its format', () => {
    for (const channel of DISTRIBUTION_CHANNEL_KEYS) {
      const steps = distributionKitSteps(channel, false);
      expect(steps.length).toBeGreaterThanOrEqual(3);
      expect(steps.length).toBeLessThanOrEqual(5);
      expect(steps.join(' ')).toContain('Mark this channel as posted');
      if (channelNeedsVideo(channel)) {
        expect(steps.join(' ')).toContain('vertical video');
      } else if (['pinterest', 'threads', 'linkedin', 'x', 'tumblr'].includes(channel)) {
        // The image-first social channels, as opposed to the text/chat channels
        // (telegram), the subscriber admin and the on-site widget.
        expect(steps.join(' ')).toContain('image');
      }
    }
    expect(distributionKitSteps('youtube_shorts', true).join(' ')).toContain('Download the attached vertical video');
    expect(distributionKitSteps('newsletter', false).join(' ')).toContain('email subject');
    expect(distributionKitSteps('site_widget', false).join(' ')).toContain('widget snippet');
  });

  it('offers an app deep link for the platforms with an app and none for on-site channels', () => {
    for (const channel of DISTRIBUTION_CHANNEL_KEYS) {
      const link = DISTRIBUTION_DEEP_LINKS[channel];
      if (channel === 'newsletter' || channel === 'site_widget') {
        expect(link).toBeNull();
      } else {
        expect(link).toMatch(/^[a-z][a-z0-9+.-]*:\/\//);
        expect(link).not.toContain('http');
        expect(link).not.toContain('?');
      }
    }
    expect(channelNeedsVideo('tiktok')).toBe(true);
    expect(channelNeedsVideo('site_widget')).toBe(false);
    expect(KIT_SLOT_KEYS).toEqual(['morning', 'midday', 'evening']);
  });

  it('parses only a well-formed kit state and refuses anything else', () => {
    const valid = {
      post_id: POST_ID, lagos_day: '2026-10-06', is_today: true,
      video_url: 'https://cdn.lixxonstudio.com/clip.mp4',
      marks: [{ channel_key: 'instagram', slot: 'evening', note: 'Posted by hand.', marked_at: '2026-10-06T18:04:00.000Z', lagos_day: '2026-10-06', kind: 'manual' }],
    };
    const parsed = parseDailyKitState(valid);
    expect(parsed?.videoUrl).toBe('https://cdn.lixxonstudio.com/clip.mp4');
    expect(parsed?.marks).toHaveLength(1);
    expect(parsed?.marks[0].slot).toBe('evening');

    expect(parseDailyKitState(null)).toBeNull();
    expect(parseDailyKitState({ ...valid, post_id: 'not-a-uuid' })).toBeNull();
    expect(parseDailyKitState({ ...valid, is_today: 'yes' })).toBeNull();
    expect(parseDailyKitState({ ...valid, marks: [{ ...valid.marks[0], slot: 'midnight' }] })).toBeNull();
    expect(parseDailyKitState({ ...valid, marks: [{ ...valid.marks[0], channel_key: 'myspace' }] })).toBeNull();
    expect(parseDailyKitState({ ...valid, video_url: 'http://cdn.lixxonstudio.com/clip.mp4' })?.videoUrl).toBeNull();
  });
});
