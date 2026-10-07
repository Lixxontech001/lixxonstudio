export const AUTOMATION_KEY_CATEGORIES = [
  'ai',
  'actions',
  'commerce',
  'email',
  'social',
  'video',
  'push',
] as const;

export type AutomationKeyCategory = (typeof AUTOMATION_KEY_CATEGORIES)[number];
export type AutomationCredentialType = 'secret' | 'identifier' | 'public_key';
export type AutomationKeyTestStatus =
  | 'not_tested'
  | 'ok'
  | 'local_ok'
  | 'invalid'
  | 'rate_limited'
  | 'unavailable'
  | 'not_configured';

export interface AutomationKeyEntry {
  name: string;
  label: string;
  category: AutomationKeyCategory;
  credential_type: AutomationCredentialType;
  purpose: string;
  required: boolean;
  configured: boolean;
  last_test_status: AutomationKeyTestStatus;
  last_tested_at: string | null;
}

export interface AutomationKeyTestResult {
  name: string;
  status: AutomationKeyTestStatus;
  message: string;
}

const CATEGORY_SET = new Set<string>(AUTOMATION_KEY_CATEGORIES);
const CREDENTIAL_TYPES = new Set<AutomationCredentialType>(['secret', 'identifier', 'public_key']);
const TEST_STATUSES = new Set<AutomationKeyTestStatus>([
  'not_tested', 'ok', 'local_ok', 'invalid', 'rate_limited', 'unavailable', 'not_configured',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeStatus(value: unknown): AutomationKeyTestStatus {
  return typeof value === 'string' && TEST_STATUSES.has(value as AutomationKeyTestStatus)
    ? value as AutomationKeyTestStatus
    : 'not_tested';
}

/**
 * Whitelist the metadata fields used by the UI. Even if a future response grows
 * extra properties, no value/Vault identifier is copied into component state.
 */
export function parseAutomationKeyList(value: unknown): AutomationKeyEntry[] | null {
  if (!Array.isArray(value)) return null;
  const result: AutomationKeyEntry[] = [];
  for (const row of value) {
    if (!isRecord(row)) return null;
    if (
      typeof row.name !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(row.name) ||
      typeof row.label !== 'string' || typeof row.purpose !== 'string' ||
      typeof row.category !== 'string' || !CATEGORY_SET.has(row.category) ||
      typeof row.credential_type !== 'string' || !CREDENTIAL_TYPES.has(row.credential_type as AutomationCredentialType) ||
      typeof row.configured !== 'boolean' || typeof row.required !== 'boolean'
    ) return null;
    const lastTestedAt = typeof row.last_tested_at === 'string' && Number.isFinite(Date.parse(row.last_tested_at))
      ? row.last_tested_at
      : null;
    result.push({
      name: row.name,
      label: row.label.slice(0, 120),
      category: row.category as AutomationKeyCategory,
      credential_type: row.credential_type as AutomationCredentialType,
      purpose: row.purpose.slice(0, 240),
      required: row.required,
      configured: row.configured,
      last_test_status: safeStatus(row.last_test_status),
      last_tested_at: lastTestedAt,
    });
  }
  return result;
}

export function safeAutomationKeyTestResult(value: unknown): AutomationKeyTestResult | null {
  if (!isRecord(value) || typeof value.name !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(value.name)) return null;
  const status = safeStatus(value.status);
  if (status === 'not_tested') return null;
  const messageByStatus: Record<Exclude<AutomationKeyTestStatus, 'not_tested'>, string> = {
    ok: 'A read-only provider request succeeded. Write or publishing permissions were not tested.',
    local_ok: 'A local format check passed. Provider connectivity is not verified.',
    invalid: 'The provider rejected this credential or a required scope.',
    rate_limited: 'The provider rate-limited this test. Wait before trying again.',
    unavailable: 'The provider or Vault service is temporarily unavailable.',
    not_configured: 'This credential is not configured.',
  };
  return { name: value.name, status, message: messageByStatus[status] };
}

export function automationTestStatusLabel(status: AutomationKeyTestStatus): string {
  switch (status) {
    case 'ok': return 'Read-only check passed';
    case 'local_ok': return 'Local check passed';
    case 'invalid': return 'Rejected';
    case 'rate_limited': return 'Rate limited';
    case 'unavailable': return 'Unavailable';
    case 'not_configured': return 'Not configured';
    case 'not_tested': return 'Not tested';
  }
}

export function automationStatusClass(status: AutomationKeyTestStatus): string {
  switch (status) {
    case 'ok': return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'local_ok': return 'border-sky-200 bg-sky-50 text-sky-800';
    case 'invalid': return 'border-red-200 bg-red-50 text-red-800';
    case 'rate_limited':
    case 'unavailable': return 'border-amber-200 bg-amber-50 text-amber-900';
    case 'not_configured':
    case 'not_tested': return 'border-gray-200 bg-gray-50 text-gray-600';
  }
}

export const AUTOMATION_FLAGS_DEFAULT_OFF = [
  'automation.enabled',
  'automation.daily_pipeline',
  'automation.distribution',
  'automation.video',
  'automation.agents',
  'automation.push',
] as const;
