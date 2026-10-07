import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAutomationHealth } from '../../api/automation/health';
import { AUTOMATION_HEALTH_KEYS } from '../lib/automationHealth';

const PRIVATE_SENTINEL = 'FAKE-VAULT-SECRET-MUST-NEVER-RETURN';
const ACCESS_TOKEN = 'signed-in-owner-access-token';

function fixtureSnapshot() {
  const evidenceByKey: Record<string, Record<string, unknown>> = {
    database: { automation_schema_present: true, latest_migration_version: null },
    vault: { vault_available: true, configured_credentials: 0 },
    github_actions: { credential_configured: false, credential_test_status: 'not_tested', credential_tested_at: null, last_job_at: null, dispatch_permission_verified: false },
    daily_schedule: { feature_enabled: false, job_registered: false, registered_job_count: 0, job_active: null, last_run_status: null, last_run_at: null, last_run_fresh: false, freshness_window_hours: 26 },
    ai_providers: { configured_providers: 0, recent_successful_tests: 0, invalid_tests: 0, freshness_window_hours: 24 },
    ai_quota: { quota_samples_last_24h: 0, quota_measured: false, all_recent_samples_positive: false, measurement_window_hours: 24 },
    distribution: { feature_enabled: false, configured_provider_tokens: 0, provider_readback_verified: false },
    video: { feature_enabled: false, stock_api_key_configured: false, last_render_status: null, last_render_at: null, toolchain_verified: false },
    push: { feature_enabled: false, vapid_values_configured: 0, delivery_verified: false, last_test_status: null, last_test_at: null },
    commerce: { vault_credentials_configured: 0, flutterwave_secret_configured: false, flutterwave_test_status: 'not_tested', flutterwave_tested_at: null, webhook_hash_configured: false, webhook_test_status: 'not_tested', webhook_signature_verified: false, legacy_checkout_infrastructure_verified: false },
    incidents: { failed_or_blocked_last_24h: 0, last_incident_at: null, telemetry_seen: false, last_telemetry_at: null },
    automation_safety: { master_enabled: false, daily_pipeline_enabled: false, distribution_enabled: false, video_enabled: false, push_enabled: false },
  };
  return {
    checked_at: '2026-10-05T08:00:00.000Z',
    decrypted_secret: PRIVATE_SENTINEL,
    checks: AUTOMATION_HEALTH_KEYS.map(key => ({
      key,
      status: key === 'database' || key === 'vault' || key === 'automation_safety' ? 'healthy' : 'not_configured',
      observed_at: '2026-10-05T08:00:00.000Z',
      evidence: { ...evidenceByKey[key], ignored_extra_secret: PRIVATE_SENTINEL },
      detail: PRIVATE_SENTINEL,
    })),
  };
}

function request(authorization?: string) {
  return new Request('https://site.example/api/automation/health', {
    method: 'GET',
    headers: authorization ? { Authorization: authorization } : {},
  });
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'public-anon-key');
});

afterEach(() => vi.unstubAllEnvs());

describe('automation health API boundary', () => {
  it('requires a bearer session before contacting Supabase', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleAutomationHealth(request(), fetcher);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in with an authorized admin account.' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('forwards only a read-only RPC request and whitelists the returned DTO', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(fixtureSnapshot()), { status: 200 }));
    const response = await handleAutomationHealth(request(`Bearer ${ACCESS_TOKEN}`), fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://project.supabase.co/rest/v1/rpc/automation_health_snapshot');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
    expect(init?.redirect).toBe('error');
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect((init?.headers as Record<string, string>).apikey).toBe('public-anon-key');

    const body = await response.text();
    expect(body).not.toContain(PRIVATE_SENTINEL);
    const safe = JSON.parse(body) as { checks: Array<{ key: string; detail: string }> };
    expect(safe.checks).toHaveLength(12);
    expect(safe.checks.find(check => check.key === 'ai_providers')?.detail).toBe('No AI provider keys are stored.');
  });

  it('returns safe 401/403 errors and never relays provider or database error text', async () => {
    const unauthorized = vi.fn<typeof fetch>(async () => new Response(PRIVATE_SENTINEL, { status: 401 }));
    const unauthorizedResponse = await handleAutomationHealth(request(`Bearer ${ACCESS_TOKEN}`), unauthorized);
    expect(unauthorizedResponse.status).toBe(401);
    expect(await unauthorizedResponse.text()).not.toContain(PRIVATE_SENTINEL);

    const forbidden = vi.fn<typeof fetch>(async () => new Response(PRIVATE_SENTINEL, { status: 403 }));
    const forbiddenResponse = await handleAutomationHealth(request(`Bearer ${ACCESS_TOKEN}`), forbidden);
    expect(forbiddenResponse.status).toBe(403);
    expect(await forbiddenResponse.text()).not.toContain(PRIVATE_SENTINEL);
  });

  it('fails safely on timeout and upstream failure', async () => {
    const hanging: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error(PRIVATE_SENTINEL)));
    });
    const timeout = await handleAutomationHealth(request(`Bearer ${ACCESS_TOKEN}`), hanging, 5);
    expect(timeout.status).toBe(504);
    expect(await timeout.text()).not.toContain(PRIVATE_SENTINEL);

    const unavailable = await handleAutomationHealth(
      request(`Bearer ${ACCESS_TOKEN}`),
      async () => new Response(PRIVATE_SENTINEL, { status: 503 }),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain(PRIVATE_SENTINEL);
  });

  it('refuses to use a service-role key as the public PostgREST key', async () => {
    vi.stubEnv('SUPABASE_ANON_KEY', 'sb_secret_should-never-be-used');
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleAutomationHealth(request(`Bearer ${ACCESS_TOKEN}`), fetcher);
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
