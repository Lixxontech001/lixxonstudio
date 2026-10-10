import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import {
  AUTOMATION_SAFE_ERROR_CODES,
  automationLagosTime,
  parseAutomationArticlePreview,
  parseAutomationRunMonitor,
  type AutomationArticlePreview,
  type AutomationRun,
  type AutomationRunMonitor,
  type AutomationRunStatus,
} from '../../lib/automationRuns';

const RETRYABLE_CODES = new Set([
  'GITHUB_TOKEN_MISSING', 'GITHUB_AUTH', 'GITHUB_FORBIDDEN', 'GITHUB_RATE_LIMITED',
  'GITHUB_UNAVAILABLE', 'GITHUB_UNEXPECTED', 'GITHUB_NETWORK_ERROR',
  'RUNNER_STEP_FAILED', 'RUNNER_DATABASE_UNAVAILABLE', 'VIDEO_RENDERER_NOT_READY',
]);
const STATUS_LABELS: Record<AutomationRunStatus, string> = {
  queued: 'Queued', running: 'Running', awaiting_approval: 'Awaiting owner review',
  completed: 'Completed', failed: 'Failed safely', paused: 'Paused', cancelled: 'Cancelled',
};
const STATUS_CLASSES: Record<AutomationRunStatus, string> = {
  queued: 'border-sky-200 bg-sky-50 text-sky-900',
  running: 'border-blue-200 bg-blue-50 text-blue-900',
  awaiting_approval: 'border-amber-200 bg-amber-50 text-amber-950',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  failed: 'border-red-200 bg-red-50 text-red-900',
  paused: 'border-gray-300 bg-gray-100 text-gray-800',
  cancelled: 'border-gray-300 bg-gray-50 text-gray-600',
};
const STEP_LABELS: Record<string, string> = {
  preflight: 'Quick check', source_snapshot: 'Source check', metadata_links: 'Metadata and links',
  channel_kit: 'Owner sharing kit', asset_render: 'Optional video rendering',
  owner_review: 'Owner review', publish_dispatch: 'Publishing step',
};
const STEP_STATUS_LABELS: Record<string, string> = {
  queued: 'Queued', running: 'Running', succeeded: 'Passed', failed: 'Failed',
  skipped: 'Skipped', awaiting_approval: 'Needs review',
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function apiFailureMessage(): string {
  return 'The operation could not be completed. Nothing was shown.';
}

function displayTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) + ' (studio clock)';
}

function scheduledTimeLabel(value: string | null): string {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  const utc = date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
  return `${automationLagosTime(value)} studio clock · ${utc} UTC`;
}

function durationLabel(duration: number | null): string {
  if (duration === null) return '—';
  if (duration < 1000) return `${duration} ms`;
  const seconds = Math.round(duration / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Plain English for the safe error codes the runner can report. */
const PLAIN_ERROR_LABELS: Record<string, string> = {
  AUTOMATION_PAUSED: 'Automation was paused', OWNER_CANCELLED: 'Cancelled by owner', PREFLIGHT_INVALID: 'Quick check failed',
  GITHUB_TOKEN_MISSING: 'GitHub key missing', GITHUB_AUTH: 'GitHub refused the key', GITHUB_FORBIDDEN: 'GitHub refused the request',
  GITHUB_RATE_LIMITED: 'GitHub asked us to wait', GITHUB_UNAVAILABLE: 'GitHub is unavailable', GITHUB_UNEXPECTED: 'Unexpected reply from GitHub',
  GITHUB_NETWORK_ERROR: 'Could not reach GitHub', APPROVAL_REVOKED: 'Approval was withdrawn', POST_MISSING: 'Article not found',
  SOURCE_HASH_FAILED: 'Source check failed', SOURCE_EMPTY: 'Source was empty', SOURCE_CHANGED: 'Source changed',
  METADATA_INVALID: 'Details need fixing', UNSAFE_LINKS: 'Unsafe links found', RUNNER_STEP_FAILED: 'A step failed',
  RUNNER_DATABASE_UNAVAILABLE: 'Database unavailable', VIDEO_RENDERER_NOT_READY: 'Video tool not ready',
  PRIOR_STAGE_FAILED: 'An earlier step failed', CLAIMS_REVIEW_REQUIRED: 'Claims need review', VIDEO_DISABLED: 'Video is off',
};

function safeCodeLabel(code: string | null): string | null {
  return code && (AUTOMATION_SAFE_ERROR_CODES as readonly string[]).includes(code) ? (PLAIN_ERROR_LABELS[code] || null) : null;
}

function controlConfirmation(action: 'pause' | 'resume' | 'retry' | 'cancel', title: string): string {
  switch (action) {
    case 'pause': return `Pause the automation run for “${title}”? Any remaining work will stop before publishing. Resume will queue it for the next 08:00 daily run.`;
    case 'resume': return `Resume “${title}” safely? It will be queued for the next 08:00 daily run. This does not publish the article.`;
    case 'retry': return `Retry the safe infrastructure failure for “${title}”? It will be queued for the next 08:00 daily run and will still require owner review.`;
    case 'cancel': return `Cancel “${title}” permanently? The run and its pending kit will be revoked. To try again, schedule a new run.`;
  }
}

function PreviewChecks({ preview }: { preview: AutomationArticlePreview }) {
  const rows = [
    ['Owner schedule approval recorded', preview.ownerApprovalPresent],
    ['Required article metadata complete', preview.metadataComplete],
    ['Cover image uses HTTPS', preview.imageHttps],
    ['Article links pass safe-link checks', preview.articleLinksSafe],
    ['Owner-authored source prose exists', preview.sourcePresent],
    ['No risky claim pattern detected', !preview.claimReviewRequired],
    ['Attribution review not required', !preview.imageAttributionReviewRequired],
    ['Required disclaimer present', !preview.disclaimerRequired || preview.disclaimerPresent],
  ] as const;
  return (
    <section className="mt-4 rounded-sm border border-sky-200 bg-sky-50 p-4" aria-label="Side-effect-free article preflight preview">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-sky-950">Read-only preflight preview</h4>
          <p className="mt-1 text-sm text-sky-900">{preview.title} · {preview.status} · {scheduledTimeLabel(preview.scheduledAtUtc)}</p>
          <p className="mt-1 text-xs leading-5 text-sky-900">No calls to services, emails, payments, publishing or article changes were made. Article text was not shown.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {rows.map(([label, passed]) => (
              <li key={label} className="flex items-start gap-2 text-xs leading-5 text-sky-950">
                {passed ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />}
                <span>{label}: <strong>{passed ? 'Pass' : 'Owner review needed'}</strong></span>
              </li>
            ))}
          </ul>
          {preview.humanReviewRequired && <p className="mt-3 text-xs font-medium text-amber-900">Human review is required. These flags do not write or generate legal, medical, or attribution text.</p>}
        </div>
      </div>
    </section>
  );
}

export default function AutomationRuns() {
  const { adminAccess } = useAuth();
  const canManage = adminAccess?.status === 'active' && (adminAccess.is_owner || adminAccess.is_founder);
  const [monitor, setMonitor] = useState<AutomationRunMonitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyFlag, setBusyFlag] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<{ runId: string; action: string } | null>(null);
  const [previewRunId, setPreviewRunId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AutomationArticlePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('automation_run_monitor', { p_limit: 50 });
      if (rpcError) {
        setMonitor(null);
        setError(rpcError.code === '42501'
          ? 'Your admin session does not have the database-verified automation monitor permission.'
          : apiFailureMessage());
        return;
      }
      const safe = parseAutomationRunMonitor(data);
      if (!safe) {
        setMonitor(null);
        setError('The run list returned an incomplete or unrecognized result.');
        return;
      }
      setMonitor(safe);
    } catch {
      setMonitor(null);
      setError(apiFailureMessage());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const summary = useMemo(() => {
    const runs = monitor?.runs || [];
    return {
      active: runs.filter(run => ['queued', 'running', 'awaiting_approval'].includes(run.status)).length,
      failed: runs.filter(run => run.status === 'failed').length,
      needsReview: runs.filter(run => run.status === 'awaiting_approval').length,
    };
  }, [monitor]);

  const toggleFlag = async (flag: 'automation.enabled' | 'automation.daily_pipeline', enabled: boolean) => {
    if (!canManage || busyFlag) return;
    const label = flag === 'automation.enabled' ? 'master automation switch' : '08:00 daily schedule';
    const verb = enabled ? 'enable' : 'disable';
    if (!window.confirm(`Are you sure you want to ${verb} the ${label}? This change is audited. ${enabled ? 'The master switch and daily schedule must both be on before a run can start.' : 'No article prose will be changed.'}`)) return;
    setBusyFlag(flag);
    setNotice(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('automation_set_feature_flag', {
        p_flag_key: flag,
        p_enabled: enabled,
      });
      if (rpcError || data !== true) throw new Error('flag update failed');
      setNotice(`${label[0].toUpperCase()}${label.slice(1)} ${enabled ? 'enabled' : 'disabled'} and audit-logged.`);
      await refresh();
    } catch {
      setError(apiFailureMessage());
    } finally {
      setBusyFlag(null);
    }
  };

  const runControl = async (run: AutomationRun, action: 'pause' | 'resume' | 'retry' | 'cancel') => {
    if (!canManage || busyAction) return;
    if (!window.confirm(controlConfirmation(action, run.title))) return;
    setBusyAction({ runId: run.id, action });
    setNotice(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('automation_control_run', {
        p_run_id: run.id,
        p_action: action,
      });
      if (rpcError || !record(data) || data.ok !== true) throw new Error('run control failed');
      const status = typeof data.status === 'string' ? data.status : 'updated';
      const dispatchNote = status === 'queued' ? ' It will be picked up by the next 08:00 daily run.' : '';
      setNotice(`Run ${action} recorded: ${status}.${dispatchNote}`);
      await refresh();
    } catch {
      setError(apiFailureMessage());
    } finally {
      setBusyAction(null);
    }
  };

  const showPreview = async (run: AutomationRun) => {
    setPreviewRunId(run.id);
    setPreview(null);
    setPreviewError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('automation_preview_article', { p_post_id: run.postId });
      if (rpcError) throw new Error('preview unavailable');
      const safe = parseAutomationArticlePreview(data);
      if (!safe) throw new Error('preview schema invalid');
      setPreview(safe);
    } catch {
      setPreviewError('The preview is unavailable for now. Nothing was changed.');
    }
  };

  const switchRow = (
    flag: 'automation.enabled' | 'automation.daily_pipeline',
    title: string,
    description: string,
  ) => {
    const enabled = monitor?.flags[flag] === true;
    return (
      <div className="flex items-start justify-between gap-4 rounded-sm border border-gray-200 bg-white p-4">
        <div className="min-w-0">
          <h3 className="font-medium text-charcoal">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-gray-600">{description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${title}: ${enabled ? 'on' : 'off'}`}
          disabled={!canManage || loading || busyFlag !== null}
          onClick={() => void toggleFlag(flag, !enabled)}
          className={`relative inline-flex min-h-11 w-20 shrink-0 items-center justify-between rounded-full border px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-60 ${enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-gray-300 bg-gray-100 text-gray-700'}`}
        >
          <span aria-hidden="true" className="text-[10px] font-semibold">{enabled ? 'On' : 'Off'}</span>
          <span aria-hidden="true" className={`h-7 w-7 rounded-full bg-white shadow-sm ${busyFlag === flag ? 'animate-pulse' : ''}`} />
        </button>
      </div>
    );
  };

  const renderControls = (run: AutomationRun) => {
    if (!canManage || ['completed', 'cancelled'].includes(run.status)) return null;
    const working = busyAction?.runId === run.id;
    const controlButton = (
      action: 'pause' | 'resume' | 'retry' | 'cancel',
      label: string,
      tone: string,
    ) => (
      <button
        key={action}
        type="button"
        disabled={busyAction !== null || !canManage}
        onClick={() => void runControl(run, action)}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
      >
        {working && busyAction?.action === action && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
        {label}
      </button>
    );
    return (
      <div className="flex flex-wrap gap-2" aria-label={`Owner controls for ${run.title}`}>
        {['queued', 'running', 'awaiting_approval'].includes(run.status)
          && controlButton('pause', 'Pause', 'border-gray-300 bg-white text-charcoal hover:border-bronze')}
        {run.status === 'paused' && controlButton('resume', 'Resume next tick', 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-bronze')}
        {run.status === 'failed' && run.safeErrorCode && RETRYABLE_CODES.has(run.safeErrorCode)
          && controlButton('retry', 'Retry next tick', 'border-sky-200 bg-sky-50 text-sky-900 hover:border-bronze')}
        {controlButton('cancel', 'Cancel run', 'border-red-200 bg-white text-red-800 hover:border-bronze')}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-bronze">
            <ShieldCheck size={18} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">Automation operations</span>
          </div>
          <h1 className="font-serif text-3xl text-charcoal">Run Monitor &amp; Controls</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Daily schedule: <strong>08:00 on your studio clock</strong>. View safe run steps, owner review flags,
            retry state and zero-cost usage. Article prose is never returned or changed by automation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={loading || refreshing}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-4 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
          Refresh runs
        </button>
      </header>

      <section className="grid gap-3 md:grid-cols-2" aria-label="Owner-controlled automation schedule">
        {switchRow('automation.enabled', 'Main off switch', 'When off, runs pause before they finish their work. Owner-only control; every change is recorded.')}
        {switchRow('automation.daily_pipeline', '08:00 daily schedule', 'Lets the scheduled article check and the owner-review prep run. Both this schedule and the main switch must be on.')}
      </section>

      {!canManage && <p className="rounded-sm border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">Read-only view. Only an active owner or founder can change the switches or control a run.</p>}
      {notice && <p role="status" aria-live="polite" className="rounded-sm border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {error && <div role="alert" className="flex items-start gap-2 rounded-sm border border-red-200 bg-red-50 p-3 text-sm text-red-900"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</div>}

      {loading ? (
        <div role="status" aria-live="polite" className="rounded-sm border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
          <Loader2 size={18} className="mx-auto mb-2 animate-spin" aria-hidden="true" />Loading safe run metadata…
        </div>
      ) : monitor && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Run and notification summary">
            <div className="rounded-sm border border-gray-200 bg-white p-3"><p className="text-xs uppercase tracking-wide text-gray-500">Recent runs</p><p className="mt-1 text-2xl font-semibold text-charcoal">{monitor.runs.length}</p></div>
            <div className="rounded-sm border border-sky-200 bg-sky-50 p-3"><p className="text-xs uppercase tracking-wide text-sky-700">Active</p><p className="mt-1 text-2xl font-semibold text-sky-950">{summary.active}</p></div>
            <div className="rounded-sm border border-amber-200 bg-amber-50 p-3"><p className="text-xs uppercase tracking-wide text-amber-800">Owner review</p><p className="mt-1 text-2xl font-semibold text-amber-950">{summary.needsReview}</p></div>
            <div className={`rounded-sm border p-3 ${summary.failed ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}><p className="text-xs uppercase tracking-wide">Failed safely</p><p className="mt-1 text-2xl font-semibold">{summary.failed}</p></div>
          </section>

          <section className="grid gap-3 lg:grid-cols-2" aria-label="Usage and failure-alert readiness">
            <div className="rounded-sm border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2"><h2 className="font-semibold text-charcoal">Usage &amp; quotas</h2></div>
              <p className="mt-2 text-sm text-gray-700">Calls to services: <strong>{monitor.usage.providerCalls}</strong> · Paid calls: <strong>{monitor.usage.paidCalls}</strong> · Quota: <strong>Not applicable</strong></p>
              <p className="mt-1 text-xs leading-5 text-gray-600">{monitor.usage.note} AI and video stay off until a free route is confirmed; no spending is started here.</p>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2"><AlertTriangle size={17} className="text-bronze" aria-hidden="true" /><h2 className="font-semibold text-charcoal">Failure-alert delivery</h2></div>
              <p className="mt-2 text-sm text-gray-700">Email via Resend: <strong>{monitor.notifications.emailConfigured ? 'Configured' : 'Not configured'}</strong> · Telegram fallback: <strong>{monitor.notifications.telegramConfigured ? 'Configured' : 'Not configured'}</strong></p>
              {!monitor.notifications.emailConfigured && !monitor.notifications.telegramConfigured && (
                <p className="mt-1 text-xs leading-5 text-amber-900">No alert place is ready. Add a Resend key for owner email, or set both the Telegram bot token and chat ID on Keys. Alerts contain only the run ID and a safe failure code.</p>
              )}
            </div>
          </section>

          {monitor.runs.length === 0 ? (
            <section className="rounded-sm border border-gray-200 bg-white p-8 text-center">
              <h2 className="mt-3 font-serif text-xl text-charcoal">No automation runs yet</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">Runs are created for owner-approved scheduled articles on the daily studio-clock run. Turning on both switches does not edit or publish article prose.</p>
            </section>
          ) : (
            <section className="space-y-4" aria-label="Recent article runs">
              {monitor.runs.map(run => {
                const isPreviewing = previewRunId === run.id;
                const errorLabel = safeCodeLabel(run.safeErrorCode);
                return (
                  <article key={run.id} className="overflow-hidden rounded-sm border border-gray-200 bg-white">
                    <div className="border-b border-gray-100 p-4 sm:p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-serif text-xl text-charcoal">{run.title}</h2>
                            <span className={`inline-flex items-center rounded-full border px-2.5 text-xs font-medium ${STATUS_CLASSES[run.status]}`}>{STATUS_LABELS[run.status]}</span>
                          </div>
                          <p className="mt-1 break-all text-xs text-gray-500">Run {run.id} · Article {run.postId}</p>
                          <div className="mt-3 grid gap-2 text-xs text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
                            <p><strong>Scheduled:</strong> {automationLagosTime(run.scheduledAtUtc)}</p>
                            <p><strong>Created:</strong> {displayTime(run.createdAt)}</p>
                            <p><strong>Duration:</strong> {durationLabel(run.durationMs)}</p>
                            <p><strong>Start retries:</strong> {run.dispatchRetries} · Attempt {run.workflowAttempt ?? '—'}</p>
                          </div>
                          {errorLabel && <p className="mt-3 inline-flex items-center gap-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-900"><AlertTriangle size={14} aria-hidden="true" />Safe failure: {errorLabel}</p>}
                          {run.workflowUrl && <p className="mt-2"><a href={run.workflowUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm text-bronze underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze">View the run on GitHub</a></p>}
                          {run.finalUrls.map(url => <p key={url}><a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm text-bronze underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze">Open published article</a></p>)}
                        </div>
                        <div className="flex flex-wrap gap-2 sm:justify-end">
                          <button
                            type="button"
                            disabled={isPreviewing}
                            onClick={() => void showPreview(run)}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-sky-200 bg-sky-50 px-3 text-sm font-medium text-sky-950 hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:opacity-50"
                          >
                            {isPreviewing && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                            Read-only preview
                          </button>
                        </div>
                      </div>
                      {run.kit && (
                        <div className="mt-4 rounded-sm border border-gray-200 bg-gray-50 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-charcoal">Owner review kit</h3>
                            <span className="rounded-full border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700">{run.kit.reviewStatus}</span>
                          </div>
                          <p className="mt-1 text-sm text-gray-800">{run.kit.title}</p>
                          {run.kit.ownerExcerpt && <p className="mt-1 text-sm leading-6 text-gray-600">{run.kit.ownerExcerpt}</p>}
                          {run.kit.imageAlt && <p className="mt-1 text-xs text-gray-600">Owner image alt: {run.kit.imageAlt}</p>}
                          <code className="mt-2 inline-block text-xs text-gray-600">{run.kit.canonicalPath}</code>
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 p-4 sm:grid-cols-2">
                      <section aria-label={`Pipeline stages for ${run.title}`}>
                        <h3 className="mb-3 text-sm font-semibold text-charcoal">Pipeline steps</h3>
                        {run.steps.length === 0 ? <p className="text-sm text-gray-500">No stage details have been recorded yet.</p> : (
                          <ol className="space-y-2">
                            {run.steps.map(step => (
                              <li key={step.key} className="flex flex-col gap-1 rounded-sm border border-gray-100 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <span className="text-sm font-medium text-charcoal">{STEP_LABELS[step.key] || step.key}</span>
                                  {step.safeErrorCode && <span className="ml-2 text-[11px] text-gray-500">{safeCodeLabel(step.safeErrorCode)}</span>}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-gray-600">
                                  <span>{STEP_STATUS_LABELS[step.status]}</span>
                                  <span>{durationLabel(step.durationMs)}</span>
                                </div>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>
                      <section aria-label={`Recent safe events for ${run.title}`}>
                        <h3 className="mb-3 text-sm font-semibold text-charcoal">Recent events</h3>
                        {run.logs.length === 0 ? <p className="text-sm text-gray-500">No safe event log has been recorded.</p> : (
                          <ul className="space-y-2">
                            {run.logs.slice(0, 8).map(log => (
                              <li key={log.id} className="flex items-start gap-2 rounded-sm border border-gray-100 p-3 text-xs">
                                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-bronze" aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                  <strong>{log.eventCode}</strong> · {log.status}{log.step ? ` · ${log.step}` : ''}{log.channel ? ` · ${log.channel}` : ''}
                                  {log.errorCode && <span className="block mt-1 text-gray-600">{safeCodeLabel(log.errorCode)}</span>}
                                  <time className="mt-1 block text-gray-500" dateTime={log.createdAt}>{displayTime(log.createdAt)}</time>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </div>

                    {isPreviewing && previewRunId === run.id && preview && <div className="px-4 pb-4 sm:px-5"><PreviewChecks preview={preview} /></div>}
                    {isPreviewing && previewRunId === run.id && previewError && <p role="alert" className="mx-4 mb-4 rounded-sm border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:mx-5">{previewError}</p>}
                    {isPreviewing && !preview && !previewError && <p role="status" className="mx-4 mb-4 text-sm text-gray-500 sm:mx-5">Checking saved metadata only…</p>}

                    {renderControls(run) && (
                      <div className="border-t border-gray-100 bg-gray-50 p-4 sm:p-5">
                        <p className="mb-3 text-xs text-gray-600">Controls are owner-only and audit-logged. Resume and retry wait for the next daily tick; publishing remains a separate owner-approved action.</p>
                        {renderControls(run)}
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}
