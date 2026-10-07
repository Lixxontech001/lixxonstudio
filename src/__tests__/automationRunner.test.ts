import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  sha256: vi.fn(),
  verifyGitHubActionsOidc: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../lib/automationPipeline.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/automationPipeline.ts')>();
  return { ...actual, verifyGitHubActionsOidc: mocks.verifyGitHubActionsOidc };
});

vi.mock('../../supabase/functions/_shared/http.ts', () => ({
  serviceClient: mocks.serviceClient,
  sha256: mocks.sha256,
}));

import { handleAutomationRunner } from '../../supabase/functions/automation-runner/handler.ts';

const runId = '82000000-0000-4000-8000-000000000001';
const postId = '82000000-0000-4000-8000-000000000002';
const ownerArticle = 'Owner-authored article prose stays in the existing posts.content field.';
const postUpdatedAt = '2026-10-06T10:00:00.000Z';

function makePostQuery(post: Record<string, unknown>) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    neq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: post, error: null })),
    limit: vi.fn(async () => ({ data: [], error: null })),
  };
  return query;
}

function setupClient(overrides: { snapshot?: string; completeStatus?: string; completeErrorCode?: string } = {}) {
  const post = {
    id: postId,
    status: 'scheduled',
    title: 'Owner-written title',
    slug: 'owner-written-title',
    excerpt: 'Owner-written excerpt.',
    category_id: 'category-id',
    tags: ['editorial'],
    cover_image: 'https://jaatgiqigsmjodqgaocl.supabase.co/storage/v1/object/public/blog/cover.jpg',
    cover_image_alt: 'Owner-written image description',
    seo_title: 'Owner-written SEO title',
    seo_description: 'Owner-written SEO description.',
    scheduled_at: '2026-10-07T07:00:00.000Z',
    updated_at: postUpdatedAt,
    content: ownerArticle,
  };
  const articleQuery = makePostQuery(post);
  const slugQuery = makePostQuery(post);
  mocks.from.mockReset()
    .mockReturnValueOnce(articleQuery)
    .mockReturnValueOnce(slugQuery);
  mocks.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === 'automation_redeem_run_capability') {
      return { data: { run_id: runId, post_id: postId }, error: null };
    }
    if (name === 'automation_record_source_snapshot') {
      return { data: overrides.snapshot || 'recorded', error: null };
    }
    if (name === 'automation_complete_pipeline_run') {
      return {
        data: {
          run_id: runId,
          status: overrides.completeStatus || 'awaiting_approval',
          source_checksum_recorded: true,
          kit_ready: true,
          human_review_required: false,
          video_enabled: false,
          safe_error_code: overrides.completeErrorCode || null,
        },
        error: null,
      };
    }
    return { data: false, error: null };
  });
  mocks.sha256.mockReset().mockImplementation(async (input: string) => input === ownerArticle ? 'e'.repeat(64) : 'f'.repeat(64));
  mocks.serviceClient.mockReset().mockReturnValue({ from: mocks.from, rpc: mocks.rpc });
  return { articleQuery, post };
}

function executeRequest(capability = 'a'.repeat(64)) {
  return new Request('https://example.test/functions/v1/automation-runner', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${capability}`,
    },
    body: JSON.stringify({ action: 'execute', run_id: runId }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('automation runner edge handler', () => {
  it('anchors a safe source snapshot and returns only redacted stage metadata', async () => {
    const { articleQuery } = setupClient();
    const response = await handleAutomationRunner(executeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      run_id: runId,
      status: 'awaiting_approval',
      source_checksum_recorded: true,
      kit_ready: true,
      human_review_required: false,
      review_flags: {
        image_attribution_review_required: false,
        claim_review_required: false,
        disclaimer_required: false,
        disclaimer_present: false,
      },
    });
    expect(articleQuery.select).toHaveBeenCalledWith(
      'id,status,title,slug,excerpt,category_id,tags,cover_image,cover_image_alt,seo_title,seo_description,scheduled_at,updated_at,content',
    );
    expect(mocks.rpc).toHaveBeenCalledWith('automation_redeem_run_capability', {
      p_run_id: runId,
      p_token_hash: 'f'.repeat(64),
    });
    expect(mocks.rpc).toHaveBeenCalledWith('automation_record_source_snapshot', {
      p_run_id: runId,
      p_source_sha256: 'e'.repeat(64),
      p_post_updated_at: postUpdatedAt,
    });
    const completion = mocks.rpc.mock.calls.find(([name]) => name === 'automation_complete_pipeline_run');
    expect(completion?.[1]).toMatchObject({
      p_run_id: runId,
      p_source_sha256: 'e'.repeat(64),
      p_post_updated_at: postUpdatedAt,
      p_metadata_complete: true,
      p_image_url_https: true,
      p_canonical_path_safe: true,
      p_article_links_safe: true,
      p_source_present: true,
      p_human_review_required: false,
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(ownerArticle);
    expect(JSON.stringify(payload)).not.toContain(ownerArticle);
  });

  it('fails closed when the article changed after the edge read', async () => {
    setupClient({ snapshot: 'source_changed' });
    const response = await handleAutomationRunner(executeRequest());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: 'The article changed before its source snapshot could be anchored.' });
    expect(mocks.rpc).toHaveBeenCalledWith('automation_fail_pipeline_run', {
      p_run_id: runId,
      p_safe_error_code: 'SOURCE_CHANGED',
    });
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'automation_complete_pipeline_run')).toBe(false);
  });

  it('claims a private failure alert after a terminal safe pipeline failure is recorded', async () => {
    setupClient({ completeStatus: 'failed', completeErrorCode: 'METADATA_INVALID' });
    const response = await handleAutomationRunner(executeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ status: 'failed', safe_error_code: 'METADATA_INVALID' });
    expect(mocks.rpc).toHaveBeenCalledWith('automation_claim_failure_alerts', { p_limit: 2 });
    expect(JSON.stringify(payload)).not.toContain(ownerArticle);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(ownerArticle);
  });

  it('refuses malformed bodies and unsupported methods before creating a service client', async () => {
    const wrongMethod = new Request('https://example.test/runner', { method: 'GET' });
    const unsupported = new Request('https://example.test/runner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'a'.repeat(64)}` },
      body: JSON.stringify({ action: 'execute', run_id: runId, content: ownerArticle }),
    });

    expect((await handleAutomationRunner(wrongMethod)).status).toBe(405);
    expect((await handleAutomationRunner(unsupported)).status).toBe(400);
    expect(mocks.serviceClient).not.toHaveBeenCalled();
  });
});
