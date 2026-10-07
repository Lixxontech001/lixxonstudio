export const AUTOMATION_HEALTH_STATUSES = ['healthy', 'warning', 'blocked', 'not_configured'] as const;
export type AutomationHealthStatus = (typeof AUTOMATION_HEALTH_STATUSES)[number];

export const AUTOMATION_HEALTH_KEYS = [
  'database', 'vault', 'github_actions', 'daily_schedule', 'ai_providers', 'ai_quota',
  'distribution', 'video', 'push', 'commerce', 'incidents', 'automation_safety',
] as const;
export type AutomationHealthKey = (typeof AUTOMATION_HEALTH_KEYS)[number];
export type SafeHealthEvidence = Record<string, string | number | boolean | null>;

export interface AutomationHealthCheck {
  key: AutomationHealthKey;
  label: string;
  category: string;
  status: AutomationHealthStatus;
  detail: string;
  remediation: string | null;
  actionHref: string | null;
  actionLabel: string | null;
  evidence: SafeHealthEvidence;
  observedAt: string;
}

export interface AutomationHealthSnapshot {
  checkedAt: string;
  checks: AutomationHealthCheck[];
}

const CATALOG: Record<AutomationHealthKey, { label: string; category: string; actionHref: string | null; actionLabel: string | null }> = {
  database: { label: 'Database & migrations', category: 'Core', actionHref: null, actionLabel: null },
  vault: { label: 'Supabase Vault', category: 'Core', actionHref: '/admin/automation/keys', actionLabel: 'Open Keys' },
  github_actions: { label: 'GitHub Actions', category: 'Orchestration', actionHref: '/admin/automation/keys', actionLabel: 'Review credentials' },
  daily_schedule: { label: 'Daily Lagos schedule', category: 'Orchestration', actionHref: null, actionLabel: null },
  ai_providers: { label: 'AI provider checks', category: 'AI', actionHref: '/admin/automation/keys', actionLabel: 'Review AI keys' },
  ai_quota: { label: 'AI usage & quota', category: 'AI', actionHref: null, actionLabel: null },
  distribution: { label: 'Distribution channels', category: 'Channels', actionHref: '/admin/automation/keys', actionLabel: 'Review channel keys' },
  video: { label: 'Video toolchain', category: 'Media', actionHref: '/admin/automation/keys', actionLabel: 'Review video key' },
  push: { label: 'Web Push readiness', category: 'Notifications', actionHref: '/admin/automation/keys', actionLabel: 'Review push keys' },
  commerce: { label: 'Commerce & webhook', category: 'Commerce', actionHref: '/admin/automation/keys', actionLabel: 'Review commerce keys' },
  incidents: { label: 'Recent automation incidents', category: 'Operations', actionHref: null, actionLabel: null },
  automation_safety: { label: 'Automation kill switches', category: 'Safety', actionHref: null, actionLabel: null },
};

const TEST_STATUSES = new Set(['not_tested', 'ok', 'local_ok', 'invalid', 'rate_limited', 'unavailable', 'not_configured']);
const RUN_STATUSES = new Set(['succeeded', 'failed', 'running']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validTime(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function safeCount(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function safeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseEvidence(key: AutomationHealthKey, input: unknown): SafeHealthEvidence | null {
  if (!isRecord(input)) return null;
  const evidence: SafeHealthEvidence = {};
  const boolFields: Record<AutomationHealthKey, string[]> = {
    database: ['automation_schema_present'],
    vault: ['vault_available'],
    github_actions: ['credential_configured', 'dispatch_permission_verified'],
    daily_schedule: ['feature_enabled', 'job_registered', 'last_run_fresh'],
    ai_providers: [],
    ai_quota: ['quota_measured', 'all_recent_samples_positive'],
    distribution: ['feature_enabled', 'provider_readback_verified'],
    video: ['feature_enabled', 'stock_api_key_configured', 'toolchain_verified'],
    push: ['feature_enabled', 'delivery_verified'],
    commerce: ['flutterwave_secret_configured', 'webhook_hash_configured', 'webhook_signature_verified', 'legacy_checkout_infrastructure_verified'],
    incidents: ['telemetry_seen'],
    automation_safety: ['master_enabled', 'daily_pipeline_enabled', 'distribution_enabled', 'video_enabled', 'push_enabled'],
  };
  const countFields: Record<AutomationHealthKey, [string, number][]> = {
    database: [],
    vault: [['configured_credentials', 1000]],
    github_actions: [],
    daily_schedule: [['registered_job_count', 10], ['freshness_window_hours', 168]],
    ai_providers: [['configured_providers', 3], ['recent_successful_tests', 3], ['invalid_tests', 3], ['freshness_window_hours', 168]],
    ai_quota: [['quota_samples_last_24h', 100000], ['measurement_window_hours', 168]],
    distribution: [['configured_provider_tokens', 20]],
    video: [],
    push: [['vapid_values_configured', 3]],
    commerce: [['vault_credentials_configured', 2]],
    incidents: [['failed_or_blocked_last_24h', 100000]],
    automation_safety: [],
  };
  const timeFields: Record<AutomationHealthKey, string[]> = {
    database: [], vault: [],
    github_actions: ['credential_tested_at', 'last_job_at'],
    daily_schedule: ['last_run_at'],
    ai_providers: [], ai_quota: [], distribution: [],
    video: ['last_render_at'], push: ['last_test_at'],
    commerce: ['flutterwave_tested_at'],
    incidents: ['last_incident_at', 'last_telemetry_at'], automation_safety: [],
  };
  const statusFields: Record<AutomationHealthKey, [string, Set<string>][] > = {
    database: [], vault: [],
    github_actions: [['credential_test_status', TEST_STATUSES]],
    daily_schedule: [['last_run_status', RUN_STATUSES]],
    ai_providers: [], ai_quota: [], distribution: [],
    video: [['last_render_status', RUN_STATUSES]],
    push: [['last_test_status', new Set(['sent', 'failed'])]],
    commerce: [['flutterwave_test_status', TEST_STATUSES], ['webhook_test_status', TEST_STATUSES]],
    incidents: [], automation_safety: [],
  };

  for (const field of boolFields[key]) {
    const value = safeBoolean(input[field]);
    if (value === null) return null;
    evidence[field] = value;
  }
  for (const [field, max] of countFields[key]) {
    const value = safeCount(input[field], max);
    if (value === null) return null;
    evidence[field] = value;
  }
  for (const field of timeFields[key]) {
    const value = input[field] === null ? null : validTime(input[field]);
    if (input[field] !== null && value === null) return null;
    evidence[field] = value;
  }
  for (const [field, allowed] of statusFields[key]) {
    const raw = input[field];
    if (raw === null) {
      evidence[field] = null;
    } else if (typeof raw === 'string' && allowed.has(raw)) {
      evidence[field] = raw;
    } else {
      return null;
    }
  }
  if (key === 'database') {
    const raw = input.latest_migration_version;
    if (raw !== null && (typeof raw !== 'string' || !/^\d{14}$/.test(raw))) return null;
    evidence.latest_migration_version = raw as string | null;
  }
  if (key === 'daily_schedule') {
    const raw = input.job_active;
    if (raw !== null && typeof raw !== 'boolean') return null;
    evidence.job_active = raw as boolean | null;
  }
  return evidence;
}

function detailFor(key: AutomationHealthKey, status: AutomationHealthStatus, evidence: SafeHealthEvidence): string {
  switch (key) {
    case 'database':
      return status === 'healthy'
        ? `Authenticated database probe succeeded; automation schema is present${evidence.latest_migration_version ? ` (latest recorded migration ${evidence.latest_migration_version}).` : '.'}`
        : 'Required automation schema objects are missing.';
    case 'vault':
      return evidence.vault_available
        ? `Vault objects are available; ${evidence.configured_credentials} credential${evidence.configured_credentials === 1 ? '' : 's'} configured. Values are not read by this check.`
        : 'Vault availability could not be confirmed.';
    case 'github_actions':
      return !evidence.credential_configured
        ? 'No GitHub Actions credential is stored.'
        : `Credential test: ${evidence.credential_test_status}. Read-only workflow access does not verify dispatch permission; last recorded job: ${evidence.last_job_at || 'none'}.`;
    case 'daily_schedule':
      if (evidence.registered_job_count === 0) return 'The daily automation schedule is not registered.';
      if (Number(evidence.registered_job_count) > 1) return `Found ${evidence.registered_job_count} schedules with the same name; exactly one is expected.`;
      return `Schedule ${evidence.job_active ? 'is active' : 'is inactive'}; last run ${evidence.last_run_status || 'not recorded'}${evidence.last_run_at ? ` at ${evidence.last_run_at}` : ''}; successful run within ${evidence.freshness_window_hours} hours: ${evidence.last_run_fresh ? 'yes' : 'no'}.`;
    case 'ai_providers':
      return evidence.configured_providers === 0
        ? 'No AI provider keys are stored.'
        : `${evidence.recent_successful_tests} of ${evidence.configured_providers} configured providers passed a read-only check in the last ${evidence.freshness_window_hours} hours; invalid tests: ${evidence.invalid_tests}.`;
    case 'ai_quota':
      if (!evidence.quota_measured) return 'Provider quota usage is not measured yet; no quota claim is made.';
      if (!evidence.all_recent_samples_positive) return 'A recent provider quota measurement reports no remaining capacity; stop AI jobs until quota resets.';
      return `${evidence.quota_samples_last_24h} safe quota measurements in the last ${evidence.measurement_window_hours} hours report remaining capacity; provider units are not inferred.`;
    case 'distribution':
      return evidence.feature_enabled
        ? `Distribution is enabled with ${evidence.configured_provider_tokens} provider tokens, but no channel readback is verified.`
        : 'Distribution is off; channel connectivity is not yet configured.';
    case 'video':
      if (!evidence.feature_enabled && !evidence.stock_api_key_configured) {
        return 'Video rendering is deliberately disabled: no Coverr stock key is configured in Vault, and hosted FFmpeg, approved asset attribution and Android playback have not been verified. Keep video upload off; the manual Daily Kit remains available.';
      }
      if (!evidence.feature_enabled) {
        return `Video rendering is deliberately disabled. Coverr key is present, but no enabled owner-approved render has completed; hosted FFmpeg verified: ${evidence.toolchain_verified ? 'yes' : 'no'}, Android playback: not verified.`;
      }
      return `Last render: ${evidence.last_render_status || 'not recorded'}; FFmpeg toolchain verified: ${evidence.toolchain_verified ? 'yes' : 'no'}; Android playback: not verified.`;
    case 'push':
      if (evidence.delivery_verified) {
        return `A confirmed test notification was delivered to an owner device${evidence.last_test_at ? ` at ${evidence.last_test_at}` : ''}; ${evidence.vapid_values_configured} of 3 VAPID values are stored.`;
      }
      if (evidence.last_test_status === 'failed') {
        return `The last test notification failed${evidence.last_test_at ? ` at ${evidence.last_test_at}` : ''}; ${evidence.vapid_values_configured} of 3 VAPID values are stored. Owner alerts still fall back to email and Telegram.`;
      }
      return evidence.feature_enabled
        ? `${evidence.vapid_values_configured} of 3 VAPID values are stored; no confirmed test delivery is recorded yet.`
        : 'Web Push is off; no delivery check has been run.';
    case 'commerce':
      return evidence.vault_credentials_configured === 0
        ? 'No automation commerce credentials are stored. Existing checkout credentials remain infrastructure-managed.'
        : `Flutterwave read-only test: ${evidence.flutterwave_test_status}; webhook format check: ${evidence.webhook_test_status}. A signature-flow test and legacy checkout verification have not run.`;
    case 'incidents':
      return evidence.telemetry_seen
        ? `${evidence.failed_or_blocked_last_24h} failed or blocked automation event${evidence.failed_or_blocked_last_24h === 1 ? '' : 's'} recorded in the last 24 hours; latest telemetry at ${evidence.last_telemetry_at}.`
        : 'No automation telemetry was recorded in the last 24 hours; absence of events is not proof that jobs work.';
    case 'automation_safety':
      return evidence.master_enabled
        ? 'The master automation switch is on. Confirm all quotas, approvals and provider tests before enabling work.'
        : 'The master automation switch is off; automation remains fail-closed.';
  }
}

function remediationFor(key: AutomationHealthKey, status: AutomationHealthStatus): string | null {
  if (status === 'healthy' || status === 'not_configured') return null;
  switch (key) {
    case 'database': return 'Apply the reviewed Supabase migrations, then refresh this check.';
    case 'vault': return 'Confirm Supabase Vault is enabled; do not paste values into logs or environment output.';
    case 'github_actions': return 'Review the key in the Keys page and configure a run-bound workflow proof before dispatch is enabled.';
    case 'daily_schedule': return status === 'blocked' ? 'Repair the missing, inactive or duplicated schedule; keep dispatch paused.' : 'Review the latest scheduled run and its freshness; keep dispatch paused until a recent successful run is recorded.';
    case 'ai_providers': return status === 'blocked' ? 'Replace the rejected provider key in the Keys page; never enable a paid fallback.' : 'Test a stored provider key and configure usage caps before enabling AI work.';
    case 'ai_quota': return 'Add a measured provider-usage adapter and a hard free-tier cap before enabling AI jobs.';
    case 'distribution': return 'Keep distribution paused until every channel has a successful readback and explicit owner approval.';
    case 'video': return 'Keep rendering paused until the hosted runner and FFmpeg checks are verified.';
    case 'push': return 'Keep push off until all VAPID values are present and a test delivery/unsubscribe flow passes.';
    case 'commerce': return 'Verify webhook signatures and the existing checkout path in a sandbox before migration.';
    case 'incidents': return 'Inspect redacted run metadata, pause affected work, and resolve failures before retrying.';
    case 'automation_safety': return 'Turn automation off while reviewing permissions, quotas and approvals.';
  }
}

/** Whitelist the database DTO; unknown columns and free-form provider data never reach the UI. */
export function parseAutomationHealthSnapshot(value: unknown): AutomationHealthSnapshot | null {
  if (!isRecord(value)) return null;
  const checkedAt = validTime(value.checked_at);
  if (!checkedAt || !Array.isArray(value.checks) || value.checks.length !== AUTOMATION_HEALTH_KEYS.length) return null;
  const checks: AutomationHealthCheck[] = [];
  const seen = new Set<string>();
  for (const row of value.checks) {
    if (!isRecord(row) || typeof row.key !== 'string' || !AUTOMATION_HEALTH_KEYS.includes(row.key as AutomationHealthKey)) return null;
    const key = row.key as AutomationHealthKey;
    if (seen.has(key) || typeof row.status !== 'string' || !AUTOMATION_HEALTH_STATUSES.includes(row.status as AutomationHealthStatus)) return null;
    const observedAt = validTime(row.observed_at);
    const evidence = parseEvidence(key, row.evidence);
    if (!observedAt || !evidence) return null;
    seen.add(key);
    const catalog = CATALOG[key];
    const status = row.status as AutomationHealthStatus;
    checks.push({
      key,
      label: catalog.label,
      category: catalog.category,
      status,
      detail: detailFor(key, status, evidence),
      remediation: remediationFor(key, status),
      actionHref: catalog.actionHref,
      actionLabel: catalog.actionLabel,
      evidence,
      observedAt,
    });
  }
  if (seen.size !== AUTOMATION_HEALTH_KEYS.length) return null;
  checks.sort((a, b) => AUTOMATION_HEALTH_KEYS.indexOf(a.key) - AUTOMATION_HEALTH_KEYS.indexOf(b.key));
  return { checkedAt, checks };
}
