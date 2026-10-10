// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  access: null as unknown,
}));
vi.mock('../lib/supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ adminAccess: mocks.access }) }));

import AutomationRuns from '../admin/pages/AutomationRuns';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const RUN_ID = '8b7c9a31-1f82-4e92-9c74-fb8de10a63f7';
const POST_ID = 'b9d3e3d3-3fa2-4d89-b606-a08ef4ef4321';
let host: HTMLDivElement;
let root: Root;

function makeMonitor(status: 'failed' | 'queued') {
  return {
    runs: [{
      id: RUN_ID, post_id: POST_ID, title: 'Owner article title', slug: 'owner-article-title',
      post_status: 'scheduled', status, phase: status === 'failed' ? 'dispatch' : 'preflight',
      dispatch_status: status === 'failed' ? 'failed' : 'pending', dispatch_retries: 2,
      workflow_attempt: null, safe_error_code: status === 'failed' ? 'RUNNER_STEP_FAILED' : null,
      created_at: '2026-10-05T07:00:00.000Z', scheduled_at_utc: '2026-10-06T07:00:00.000Z',
      started_at: null, finished_at: status === 'failed' ? '2026-10-05T07:01:00.000Z' : null,
      duration_ms: null, workflow_url: null, final_urls: [], steps: [], kit: null, logs: [],
    }],
    flags: { 'automation.enabled': false, 'automation.daily_pipeline': false },
    notifications: { email_configured: true, telegram_configured: false },
    usage: { provider_calls: 0, paid_calls: 0, quota_remaining: null, quota_status: 'not_applicable', note: 'No paid calls.' },
  };
}

function previewFixture() {
  return {
    preview_only: true, post_id: POST_ID, title: 'Owner article title', slug: 'owner-article-title',
    status: 'scheduled', scheduled_at_utc: '2026-10-06T07:00:00.000Z', owner_approval_present: true,
    metadata_complete: true, image_https: true, image_attribution_review_required: false,
    article_links_safe: true, source_present: true, claim_review_required: false,
    disclaimer_required: false, disclaimer_present: false, human_review_required: false,
    side_effects: { provider_calls: 0, emails: 0, payments: 0, publishes: 0, writes: 0 },
  };
}

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  return host;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  mocks.rpc.mockReset();
  mocks.access = {
    status: 'active', is_owner: true, is_founder: false, role: 'owner',
    permissions: ['automation.check', 'automation.manage'],
  };
  window.confirm = vi.fn(() => true);
});

describe('Automation Runs page', () => {
  it('previews saved metadata and retries only a safe failure for the next scheduled tick', async () => {
    let runStatus: 'failed' | 'queued' = 'failed';
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'automation_run_monitor') return { data: makeMonitor(runStatus), error: null };
      if (name === 'automation_preview_article') {
        expect(args).toEqual({ p_post_id: POST_ID });
        return { data: previewFixture(), error: null };
      }
      if (name === 'automation_control_run') {
        expect(args).toEqual({ p_run_id: RUN_ID, p_action: 'retry' });
        runStatus = 'queued';
        return { data: { ok: true, status: 'queued', dispatch_after: 'next_daily_tick' }, error: null };
      }
      if (name === 'automation_set_feature_flag') return { data: true, error: null };
      return { data: null, error: { code: 'PGRST202' } };
    });

    const el = mount();
    await act(async () => { root.render(<AutomationRuns />); await Promise.resolve(); });
    await settle();
    expect(el.textContent).toContain('08:00 on your studio clock');
    expect(el.textContent).not.toMatch(/Africa\/Lagos|Lagos|WAT|Nigeria/);
    expect(el.textContent).toContain('A step failed');

    const previewButton = Array.from(el.querySelectorAll('button')).find(button => button.textContent?.includes('Read-only preview'));
    expect(previewButton).toBeDefined();
    await act(async () => { previewButton!.click(); await Promise.resolve(); });
    await settle();
    expect(el.textContent).toContain('Read-only preflight preview');
    expect(el.textContent).toContain('No calls to services, emails, payments, publishing or article changes were made.');

    const retryButton = Array.from(el.querySelectorAll('button')).find(button => button.textContent?.includes('Retry next tick'));
    expect(retryButton).toBeDefined();
    await act(async () => { retryButton!.click(); await Promise.resolve(); });
    await settle();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('next 08:00 daily run'));
    expect(el.textContent).toContain('Run retry recorded: queued.');
    expect(el.textContent).toContain('picked up by the next 08:00 daily run');
    expect(el.textContent).not.toContain('Retry next tick');
    expect(mocks.rpc).toHaveBeenCalledWith('automation_control_run', { p_run_id: RUN_ID, p_action: 'retry' });

    await act(async () => { root.unmount(); });
  });

  it('keeps schedule and run controls unavailable to a non-owner even when they can view runs', async () => {
    mocks.access = {
      status: 'active', is_owner: false, is_founder: false, role: 'analyst',
      permissions: ['automation.check', 'automation.manage'],
    };
    mocks.rpc.mockImplementation(async (name: string) => name === 'automation_run_monitor'
      ? { data: makeMonitor('failed'), error: null }
      : { data: null, error: null });

    const el = mount();
    await act(async () => { root.render(<AutomationRuns />); await Promise.resolve(); });
    await settle();

    expect(el.textContent).toContain('Read-only view. Only an active owner or founder');
    expect(Array.from(el.querySelectorAll('button')).some(button => button.textContent?.includes('Retry next tick'))).toBe(false);
    expect(el.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(el.querySelector('[role="switch"]')?.hasAttribute('disabled')).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalledWith('automation_set_feature_flag', expect.anything());

    await act(async () => { root.unmount(); });
  });
});
