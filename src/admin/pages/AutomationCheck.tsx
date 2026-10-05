import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import {
  AUTOMATION_HEALTH_STATUSES,
  parseAutomationHealthSnapshot,
  type AutomationHealthSnapshot,
  type AutomationHealthStatus,
} from '../../lib/automationHealth';

const STATUS_LABELS: Record<AutomationHealthStatus, string> = {
  healthy: 'Healthy',
  warning: 'Warning',
  blocked: 'Blocked',
  not_configured: 'Not configured',
};

const STATUS_CLASSES: Record<AutomationHealthStatus, string> = {
  healthy: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  blocked: 'border-red-200 bg-red-50 text-red-900',
  not_configured: 'border-gray-200 bg-gray-50 text-gray-700',
};

function apiError(status: number): string {
  if (status === 401) return 'Your admin session is missing or expired. Sign in again.';
  if (status === 403) return 'Your account does not have the database-verified automation health permission.';
  return 'The read-only automation health check is temporarily unavailable. No provider output was returned.';
}

function displayTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Unknown time' : parsed.toLocaleString();
}

export default function AutomationCheck() {
  const [snapshot, setSnapshot] = useState<AutomationHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) {
        setSnapshot(null);
        setError('Sign in with an active admin account to view the automation check.');
        return;
      }
      const response = await fetch('/api/automation/health', {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!response.ok) {
        setSnapshot(null);
        setError(apiError(response.status));
        return;
      }
      const parsed = parseAutomationHealthSnapshot(await response.json());
      if (!parsed) {
        setSnapshot(null);
        setError('The health endpoint returned an incomplete or unrecognized safe schema.');
        return;
      }
      setSnapshot(parsed);
    } catch {
      setSnapshot(null);
      setError('The read-only automation health check could not be reached. Try again shortly.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const groups = useMemo(() => {
    const result = new Map<string, NonNullable<typeof snapshot>['checks']>();
    for (const check of snapshot?.checks || []) {
      const items = result.get(check.category) || [];
      items.push(check);
      result.set(check.category, items);
    }
    return result;
  }, [snapshot]);

  const counts = useMemo(() => {
    const initial: Record<AutomationHealthStatus, number> = {
      healthy: 0, warning: 0, blocked: 0, not_configured: 0,
    };
    for (const check of snapshot?.checks || []) initial[check.status] += 1;
    return initial;
  }, [snapshot]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-bronze">
            <ShieldCheck size={18} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">Automation diagnostics</span>
          </div>
          <h1 className="font-serif text-3xl text-charcoal">System Check</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            Read-only evidence from the database and recorded job metadata. This page does not contact providers,
            enable switches, dispatch jobs, publish content, or expose credential values.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={loading || refreshing}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-4 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
          Refresh checks
        </button>
      </header>

      <section className="flex gap-3 rounded-sm border border-sky-200 bg-sky-50 p-4" aria-label="Check meaning">
        <Info size={18} className="mt-0.5 shrink-0 text-sky-700" aria-hidden="true" />
        <p className="text-sm leading-6 text-sky-950">
          <strong>Healthy</strong> requires recorded evidence. A saved key alone is not proof of connectivity;
          quota, channel-readback, webhook-signature, and delivery checks remain explicitly unverified until tested.
          “Not configured” is expected for disabled future-phase features.
        </p>
      </section>

      {loading ? (
        <div role="status" aria-live="polite" className="rounded-sm border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
          <Loader2 size={18} className="mx-auto mb-2 animate-spin" aria-hidden="true" />
          Reading safe automation metadata…
        </div>
      ) : error ? (
        <div role="alert" className="flex items-start gap-2 rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : snapshot && (
        <>
          <section aria-label="System check summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {AUTOMATION_HEALTH_STATUSES.map(status => (
              <div key={status} className={`rounded-sm border p-3 ${STATUS_CLASSES[status]}`}>
                <p className="text-xs uppercase tracking-wide">{STATUS_LABELS[status]}</p>
                <p className="mt-1 text-2xl font-semibold" aria-label={`${counts[status]} ${STATUS_LABELS[status]} checks`}>
                  {counts[status]}
                </p>
              </div>
            ))}
          </section>

          <p className="text-xs text-gray-500" aria-live="polite">
            Snapshot recorded <time dateTime={snapshot.checkedAt}>{displayTime(snapshot.checkedAt)}</time>.
          </p>

          {[...groups.entries()].map(([category, checks]) => (
            <section key={category} className="overflow-hidden rounded-sm border border-gray-200 bg-white" aria-label={`${category} checks`}>
              <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-charcoal">{category}</h2>
              <ul className="divide-y divide-gray-100">
                {checks.map(check => (
                  <li key={check.key} className="p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-charcoal">{check.label}</h3>
                          <span className={`inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] font-medium ${STATUS_CLASSES[check.status]}`}>
                            {STATUS_LABELS[check.status]}
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-gray-700">{check.detail}</p>
                        {check.remediation && <p className="mt-1 text-xs leading-5 text-gray-600">Next: {check.remediation}</p>}
                        <p className="mt-2 text-[11px] text-gray-500">
                          Evidence checked <time dateTime={check.observedAt}>{displayTime(check.observedAt)}</time>
                        </p>
                      </div>
                      {check.actionHref && check.actionLabel && (
                        <a
                          href={check.actionHref}
                          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-sm border border-gray-300 px-3 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"
                        >
                          {check.actionLabel}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
