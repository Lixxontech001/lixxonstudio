import { describe, expect, it } from 'vitest';
import {
  DISTRIBUTION_CHANNEL_KEYS,
  distributionShareUrl,
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
