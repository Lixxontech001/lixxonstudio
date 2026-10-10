export const AUTOMATION_RUN_STATUS_VALUES = [
  'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'paused', 'cancelled',
] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUS_VALUES)[number];

export const AUTOMATION_STEP_STATUS_VALUES = [
  'queued', 'running', 'succeeded', 'failed', 'skipped', 'awaiting_approval',
] as const;
export type AutomationStepStatus = (typeof AUTOMATION_STEP_STATUS_VALUES)[number];

export const AUTOMATION_DISPATCH_STATUS_VALUES = [
  'pending', 'dispatching', 'dispatched', 'failed', 'not_required',
] as const;
export type AutomationDispatchStatus = (typeof AUTOMATION_DISPATCH_STATUS_VALUES)[number];

export const AUTOMATION_SAFE_ERROR_CODES = [
  'AUTOMATION_PAUSED', 'OWNER_CANCELLED', 'PREFLIGHT_INVALID',
  'GITHUB_TOKEN_MISSING', 'GITHUB_AUTH', 'GITHUB_FORBIDDEN', 'GITHUB_RATE_LIMITED',
  'GITHUB_UNAVAILABLE', 'GITHUB_UNEXPECTED', 'GITHUB_NETWORK_ERROR',
  'APPROVAL_REVOKED', 'POST_MISSING', 'SOURCE_HASH_FAILED', 'SOURCE_EMPTY', 'SOURCE_CHANGED',
  'METADATA_INVALID', 'UNSAFE_LINKS', 'RUNNER_STEP_FAILED', 'RUNNER_DATABASE_UNAVAILABLE',
  'VIDEO_RENDERER_NOT_READY', 'PRIOR_STAGE_FAILED', 'CLAIMS_REVIEW_REQUIRED', 'VIDEO_DISABLED',
] as const;
export type AutomationSafeErrorCode = (typeof AUTOMATION_SAFE_ERROR_CODES)[number];

const STEP_KEYS = [
  'preflight', 'source_snapshot', 'metadata_links', 'channel_kit',
  'asset_render', 'owner_review', 'publish_dispatch',
] as const;
const STEP_RESULT_BOOLEAN_KEYS = [
  'metadata_complete', 'owner_approval_present', 'source_present', 'image_url_https',
  'canonical_path_safe', 'article_links_safe', 'human_review_required', 'kit_ready', 'video_enabled',
] as const;

export interface AutomationRunStep {
  key: (typeof STEP_KEYS)[number];
  status: AutomationStepStatus;
  attemptCount: number;
  safeErrorCode: AutomationSafeErrorCode | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  result: Partial<Record<(typeof STEP_RESULT_BOOLEAN_KEYS)[number], boolean>>;
}

export interface AutomationRunLog {
  id: number;
  eventCode: string;
  status: 'started' | 'succeeded' | 'failed' | 'paused' | 'blocked' | 'retried' | 'cancelled';
  createdAt: string;
  step: string | null;
  errorCode: AutomationSafeErrorCode | null;
  httpStatus: number | null;
  retry: boolean | null;
  elapsedMs: number | null;
  channel: string | null;
}

export interface AutomationRunKit {
  ready: true;
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'revoked';
  canonicalPath: string;
  title: string;
  ownerExcerpt: string | null;
  imageAlt: string | null;
}

export interface AutomationRun {
  id: string;
  postId: string;
  title: string;
  slug: string | null;
  postStatus: string;
  status: AutomationRunStatus;
  phase: string;
  dispatchStatus: AutomationDispatchStatus;
  dispatchRetries: number;
  workflowAttempt: number | null;
  safeErrorCode: AutomationSafeErrorCode | null;
  createdAt: string;
  scheduledAtUtc: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  workflowUrl: string | null;
  finalUrls: string[];
  steps: AutomationRunStep[];
  kit: AutomationRunKit | null;
  logs: AutomationRunLog[];
}

export interface AutomationRunMonitor {
  runs: AutomationRun[];
  flags: { 'automation.enabled': boolean; 'automation.daily_pipeline': boolean };
  notifications: { emailConfigured: boolean; telegramConfigured: boolean };
  usage: {
    providerCalls: 0;
    paidCalls: 0;
    quotaRemaining: number | null;
    quotaStatus: 'not_applicable' | 'available' | 'low' | 'exhausted' | 'unknown';
    note: string;
  };
}

export interface AutomationArticlePreview {
  previewOnly: true;
  postId: string;
  title: string;
  slug: string | null;
  status: string;
  scheduledAtUtc: string | null;
  ownerApprovalPresent: boolean;
  metadataComplete: boolean;
  imageHttps: boolean;
  imageAttributionReviewRequired: boolean;
  articleLinksSafe: boolean;
  sourcePresent: boolean;
  claimReviewRequired: boolean;
  disclaimerRequired: boolean;
  disclaimerPresent: boolean;
  humanReviewRequired: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function nullableTime(value: unknown): value is string | null {
  return value === null || isTime(value);
}

function safeCode(value: unknown): AutomationSafeErrorCode | null {
  return typeof value === 'string' && (AUTOMATION_SAFE_ERROR_CODES as readonly string[]).includes(value)
    ? value as AutomationSafeErrorCode
    : null;
}

function isDuration(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 86_400_000);
}

function parseStepResult(value: unknown): AutomationRunStep['result'] {
  if (!isRecord(value)) return {};
  const result: AutomationRunStep['result'] = {};
  for (const key of STEP_RESULT_BOOLEAN_KEYS) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  return result;
}

function parseStep(value: unknown): AutomationRunStep | null {
  if (!isRecord(value) || typeof value.key !== 'string' || !(STEP_KEYS as readonly string[]).includes(value.key)) return null;
  if (typeof value.status !== 'string' || !(AUTOMATION_STEP_STATUS_VALUES as readonly string[]).includes(value.status)) return null;
  if (!Number.isInteger(value.attempt_count) || (value.attempt_count as number) < 0 || (value.attempt_count as number) > 100) return null;
  if (!nullableTime(value.started_at) || !nullableTime(value.finished_at) || !isDuration(value.duration_ms)) return null;
  return {
    key: value.key as AutomationRunStep['key'],
    status: value.status as AutomationStepStatus,
    attemptCount: value.attempt_count as number,
    safeErrorCode: safeCode(value.safe_error_code),
    startedAt: value.started_at,
    finishedAt: value.finished_at,
    durationMs: value.duration_ms,
    result: parseStepResult(value.result),
  };
}

function parseKit(value: unknown): AutomationRunKit | null {
  if (value === null) return null;
  if (!isRecord(value) || value.ready !== true
      || !['pending', 'approved', 'rejected', 'revoked'].includes(String(value.review_status))
      || typeof value.canonical_path !== 'string' || !/^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.canonical_path)
      || typeof value.title !== 'string' || value.title.length > 250
      || (value.owner_excerpt !== null && (typeof value.owner_excerpt !== 'string' || value.owner_excerpt.length > 1000))
      || (value.image_alt !== null && (typeof value.image_alt !== 'string' || value.image_alt.length > 500))) return null;
  return {
    ready: true,
    reviewStatus: value.review_status as AutomationRunKit['reviewStatus'],
    canonicalPath: value.canonical_path,
    title: value.title,
    ownerExcerpt: value.owner_excerpt,
    imageAlt: value.image_alt,
  };
}

function parseLog(value: unknown): AutomationRunLog | null {
  if (!isRecord(value) || !Number.isInteger(value.id) || (value.id as number) < 1
      || typeof value.event_code !== 'string' || !/^[A-Z][A-Z0-9_.:-]{1,63}$/.test(value.event_code)
      || !['started', 'succeeded', 'failed', 'paused', 'blocked', 'retried', 'cancelled'].includes(String(value.status))
      || !isTime(value.created_at)) return null;
  const httpStatus = value.http_status;
  const elapsedMs = value.elapsed_ms;
  if (httpStatus !== undefined && httpStatus !== null && (!Number.isInteger(httpStatus) || (httpStatus as number) < 100 || (httpStatus as number) > 599)) return null;
  if (elapsedMs !== undefined && elapsedMs !== null && (!Number.isInteger(elapsedMs) || (elapsedMs as number) < 0 || (elapsedMs as number) > 86_400_000)) return null;
  if (value.retry !== undefined && value.retry !== null && typeof value.retry !== 'boolean') return null;
  return {
    id: value.id as number,
    eventCode: value.event_code,
    status: value.status as AutomationRunLog['status'],
    createdAt: value.created_at,
    step: typeof value.step === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value.step) ? value.step : null,
    errorCode: safeCode(value.error_code),
    httpStatus: typeof httpStatus === 'number' ? httpStatus : null,
    retry: typeof value.retry === 'boolean' ? value.retry : null,
    elapsedMs: typeof elapsedMs === 'number' ? elapsedMs : null,
    channel: typeof value.channel === 'string' && /^[a-z0-9_-]{1,32}$/.test(value.channel) ? value.channel : null,
  };
}

function parseRun(value: unknown): AutomationRun | null {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.post_id)
      || typeof value.title !== 'string' || value.title.length > 250
      || (value.slug !== null && (typeof value.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)))
      || typeof value.post_status !== 'string'
      || typeof value.status !== 'string' || !(AUTOMATION_RUN_STATUS_VALUES as readonly string[]).includes(value.status)
      || typeof value.phase !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.phase)
      || typeof value.dispatch_status !== 'string' || !(AUTOMATION_DISPATCH_STATUS_VALUES as readonly string[]).includes(value.dispatch_status)
      || !Number.isInteger(value.dispatch_retries) || (value.dispatch_retries as number) < 0 || (value.dispatch_retries as number) > 100
      || (value.workflow_attempt !== null && (!Number.isInteger(value.workflow_attempt) || (value.workflow_attempt as number) < 1 || (value.workflow_attempt as number) > 100))
      || !isTime(value.created_at) || !nullableTime(value.scheduled_at_utc)
      || !nullableTime(value.started_at) || !nullableTime(value.finished_at) || !isDuration(value.duration_ms)
      || !Array.isArray(value.steps) || value.steps.length > 7 || !Array.isArray(value.logs) || value.logs.length > 20
      || !Array.isArray(value.final_urls) || value.final_urls.length > 5) return null;

  const steps = value.steps.map(parseStep);
  const logs = value.logs.map(parseLog);
  const kit = parseKit(value.kit);
  if (steps.some(step => step === null) || logs.some(log => log === null) || (value.kit !== null && kit === null)) return null;
  const workflowUrl = value.workflow_url;
  if (workflowUrl !== null && (typeof workflowUrl !== 'string' || !/^https:\/\/github\.com\/Lixxontech001\/lixxonstudio\/actions\/runs\/[1-9][0-9]{0,19}$/.test(workflowUrl))) return null;
  const finalUrls: string[] = [];
  for (const url of value.final_urls) {
    if (typeof url !== 'string' || !/^https:\/\/lixxonstudio\.com\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url)) return null;
    finalUrls.push(url);
  }
  return {
    id: value.id,
    postId: value.post_id,
    title: value.title,
    slug: value.slug,
    postStatus: value.post_status,
    status: value.status as AutomationRunStatus,
    phase: value.phase,
    dispatchStatus: value.dispatch_status as AutomationDispatchStatus,
    dispatchRetries: value.dispatch_retries as number,
    workflowAttempt: typeof value.workflow_attempt === 'number' ? value.workflow_attempt : null,
    safeErrorCode: safeCode(value.safe_error_code),
    createdAt: value.created_at,
    scheduledAtUtc: value.scheduled_at_utc,
    startedAt: value.started_at,
    finishedAt: value.finished_at,
    durationMs: value.duration_ms,
    workflowUrl,
    finalUrls,
    steps: steps as AutomationRunStep[],
    kit,
    logs: logs as AutomationRunLog[],
  };
}

export function parseAutomationRunMonitor(value: unknown): AutomationRunMonitor | null {
  if (!isRecord(value) || !Array.isArray(value.runs) || value.runs.length > 100
      || !isRecord(value.flags) || typeof value.flags['automation.enabled'] !== 'boolean'
      || typeof value.flags['automation.daily_pipeline'] !== 'boolean'
      || !isRecord(value.notifications) || typeof value.notifications.email_configured !== 'boolean'
      || typeof value.notifications.telegram_configured !== 'boolean' || !isRecord(value.usage)
      || value.usage.provider_calls !== 0 || value.usage.paid_calls !== 0
      || !(value.usage.quota_remaining === null || (typeof value.usage.quota_remaining === 'number' && value.usage.quota_remaining >= 0))
      || !['not_applicable', 'available', 'low', 'exhausted', 'unknown'].includes(String(value.usage.quota_status))
      || typeof value.usage.note !== 'string' || value.usage.note.length > 240) return null;
  const runs = value.runs.map(parseRun);
  if (runs.some(run => run === null)) return null;
  return {
    runs: runs as AutomationRun[],
    flags: {
      'automation.enabled': value.flags['automation.enabled'],
      'automation.daily_pipeline': value.flags['automation.daily_pipeline'],
    },
    notifications: {
      emailConfigured: value.notifications.email_configured,
      telegramConfigured: value.notifications.telegram_configured,
    },
    usage: {
      providerCalls: 0,
      paidCalls: 0,
      quotaRemaining: value.usage.quota_remaining,
      quotaStatus: value.usage.quota_status as AutomationRunMonitor['usage']['quotaStatus'],
      note: value.usage.note,
    },
  };
}

export function parseAutomationArticlePreview(value: unknown): AutomationArticlePreview | null {
  if (!isRecord(value)) return null;
  const sideEffects = value.side_effects;
  if (value.preview_only !== true || !isUuid(value.post_id)
      || typeof value.title !== 'string' || value.title.length > 250
      || (value.slug !== null && (typeof value.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)))
      || typeof value.status !== 'string' || !nullableTime(value.scheduled_at_utc)
      || typeof value.owner_approval_present !== 'boolean' || typeof value.metadata_complete !== 'boolean'
      || typeof value.image_https !== 'boolean' || typeof value.image_attribution_review_required !== 'boolean'
      || typeof value.article_links_safe !== 'boolean' || typeof value.source_present !== 'boolean'
      || typeof value.claim_review_required !== 'boolean' || typeof value.disclaimer_required !== 'boolean'
      || typeof value.disclaimer_present !== 'boolean' || typeof value.human_review_required !== 'boolean'
      || !isRecord(sideEffects)
      || ['provider_calls', 'emails', 'payments', 'publishes', 'writes'].some(key => sideEffects[key] !== 0)) return null;
  return {
    previewOnly: true,
    postId: value.post_id,
    title: value.title,
    slug: value.slug,
    status: value.status,
    scheduledAtUtc: value.scheduled_at_utc,
    ownerApprovalPresent: value.owner_approval_present,
    metadataComplete: value.metadata_complete,
    imageHttps: value.image_https,
    imageAttributionReviewRequired: value.image_attribution_review_required,
    articleLinksSafe: value.article_links_safe,
    sourcePresent: value.source_present,
    claimReviewRequired: value.claim_review_required,
    disclaimerRequired: value.disclaimer_required,
    disclaimerPresent: value.disclaimer_present,
    humanReviewRequired: value.human_review_required,
  };
}

export function automationLagosTime(value: string | null): string {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
  }).format(date);
}
