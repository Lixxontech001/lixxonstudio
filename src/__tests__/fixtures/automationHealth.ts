import { AUTOMATION_HEALTH_KEYS, parseAutomationHealthSnapshot } from '../../lib/automationHealth';

export const HEALTH_TEST_SECRET = 'FAKE-VAULT-SECRET-MUST-NEVER-RETURN';

export function automationHealthFixture() {
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
  const rawSnapshot = {
    checked_at: '2026-10-05T08:00:00.000Z',
    decrypted_secret: HEALTH_TEST_SECRET,
    checks: AUTOMATION_HEALTH_KEYS.map(key => ({
      key,
      status: key === 'database' || key === 'vault' || key === 'automation_safety' ? 'healthy' : 'not_configured',
      observed_at: '2026-10-05T08:00:00.000Z',
      evidence: { ...evidenceByKey[key], ignored_extra_secret: HEALTH_TEST_SECRET },
      detail: HEALTH_TEST_SECRET,
    })),
  };
  const safe = parseAutomationHealthSnapshot(rawSnapshot);
  if (!safe) throw new Error('Invalid automation health fixture');
  return {
    ...safe,
    decrypted_secret: HEALTH_TEST_SECRET,
    checks: safe.checks.map(check => ({
      ...check,
      ignored_extra_secret: HEALTH_TEST_SECRET,
      evidence: { ...check.evidence, ignored_extra_secret: HEALTH_TEST_SECRET },
    })),
  };
}
