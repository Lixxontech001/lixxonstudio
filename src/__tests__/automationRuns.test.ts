import { describe, expect, it } from 'vitest';
import {
  automationLagosTime,
  parseAutomationArticlePreview,
  parseAutomationRunMonitor,
} from '../lib/automationRuns';

const runId = '8b7c9a31-1f82-4e92-9c74-fb8de10a63f7';
const postId = 'b9d3e3d3-3fa2-4d89-b606-a08ef4ef4321';
const createdAt = '2026-10-05T07:00:00.000Z';

function monitorFixture() {
  return {
    runs: [{
      id: runId,
      post_id: postId,
      title: 'Owner title only',
      slug: 'owner-title-only',
      post_status: 'scheduled',
      status: 'failed',
      phase: 'dispatch',
      dispatch_status: 'failed',
      dispatch_retries: 2,
      workflow_attempt: null,
      safe_error_code: 'GITHUB_TOKEN_MISSING',
      created_at: createdAt,
      scheduled_at_utc: '2026-10-06T07:00:00.000Z',
      started_at: null,
      finished_at: createdAt,
      duration_ms: null,
      workflow_url: null,
      final_urls: [],
      steps: [{
        key: 'preflight', status: 'succeeded', attempt_count: 1, safe_error_code: null,
        started_at: createdAt, finished_at: createdAt, duration_ms: 80,
        result: { metadata_complete: true, source_sha256: 'never-display-this', content: 'never display this prose' },
      }],
      kit: null,
      logs: [{
        id: 11, event_code: 'ACTIONS.DISPATCH', status: 'failed', created_at: createdAt,
        step: 'dispatch', error_code: 'GITHUB_TOKEN_MISSING', http_status: null,
        retry: null, elapsed_ms: null, channel: null,
        provider_response: 'NEVER DISPLAY PROVIDER BODY',
      }],
      content: 'NEVER RETURN ARTICLE BODY',
    }],
    flags: { 'automation.enabled': false, 'automation.daily_pipeline': false, unrecognized: true },
    notifications: { email_configured: false, telegram_configured: false, raw_key: 'DO NOT RETURN' },
    usage: {
      provider_calls: 0, paid_calls: 0, quota_remaining: null,
      quota_status: 'not_applicable', note: 'No paid calls are made by this runner.',
      provider_secret: 'DO NOT RETURN',
    },
  };
}

function previewFixture() {
  return {
    preview_only: true,
    post_id: postId,
    title: 'Owner title only',
    slug: 'owner-title-only',
    status: 'scheduled',
    scheduled_at_utc: '2026-10-06T07:00:00.000Z',
    owner_approval_present: true,
    metadata_complete: true,
    image_https: true,
    image_attribution_review_required: false,
    article_links_safe: true,
    source_present: true,
    claim_review_required: false,
    disclaimer_required: false,
    disclaimer_present: false,
    human_review_required: false,
    side_effects: { provider_calls: 0, emails: 0, payments: 0, publishes: 0, writes: 0 },
    content: 'NEVER RETURN ARTICLE BODY',
  };
}

describe('automation run-monitor contracts', () => {
  it('whitelists run metadata and discards source content, hashes, keys and provider output', () => {
    const parsed = parseAutomationRunMonitor(monitorFixture());
    expect(parsed).not.toBeNull();
    expect(parsed?.runs[0]).toMatchObject({
      id: runId,
      title: 'Owner title only',
      status: 'failed',
      safeErrorCode: 'GITHUB_TOKEN_MISSING',
      steps: [{ key: 'preflight', result: { metadata_complete: true } }],
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('NEVER RETURN');
    expect(serialized).not.toContain('never-display-this');
    expect(serialized).not.toContain('NEVER DISPLAY PROVIDER BODY');
    expect(serialized).not.toContain('DO NOT RETURN');
  });

  it('rejects an unsafe external workflow link or nonzero provider/paid usage', () => {
    const unsafeUrl = monitorFixture();
    (unsafeUrl.runs[0] as { workflow_url: string | null }).workflow_url = 'https://attacker.example/steal';
    expect(parseAutomationRunMonitor(unsafeUrl)).toBeNull();

    const paidUsage = monitorFixture();
    (paidUsage.usage as { paid_calls: number }).paid_calls = 1;
    expect(parseAutomationRunMonitor(paidUsage)).toBeNull();
  });

  it('returns an explicit side-effect-free article preview without article prose', () => {
    const parsed = parseAutomationArticlePreview(previewFixture());
    expect(parsed).toMatchObject({ previewOnly: true, postId, metadataComplete: true, sourcePresent: true });
    expect(JSON.stringify(parsed)).not.toContain('NEVER RETURN ARTICLE BODY');

    const unsafe = previewFixture();
    (unsafe.side_effects as { writes: number }).writes = 1;
    expect(parseAutomationArticlePreview(unsafe)).toBeNull();
  });

  it('formats scheduled timestamps explicitly in the Lagos timezone', () => {
    expect(automationLagosTime('2026-10-06T07:00:00.000Z')).toMatch(/8:00/);
    expect(automationLagosTime(null)).toBe('Not scheduled');
  });
});
