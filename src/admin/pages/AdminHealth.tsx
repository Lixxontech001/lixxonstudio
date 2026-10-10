import { HeartPulse, Play, Wrench, HardDrive, Gauge, Database } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '../../context/NavigationContext';
import { Panel, Btn, Notice, Severity, useAdminRpc, useAdminAction, Loading, Empty } from '../components/ui';

type Check = {
  key: string; label: string; category: string; severity: 'ok' | 'info' | 'warning' | 'critical';
  detail: string; metric: number | null; suggestion: string | null;
  action_route: string | null; action_label: string | null; fix_key: string | null;
  data?: Record<string, unknown> | null; checked_at?: string;
};
type Overview = {
  last: { taken_at: string; critical: number; warning: number; info: number; ok: number; duration_ms: number } | null;
  checks: Check[];
  trend: { taken_at: string; critical: number; warning: number }[];
};
type Metrics = {
  database_size: number; database_pretty: string; free_tier_limit: number; tables: number; estimated_rows: number;
  indexes: number; connections: number; cache_hit: number; uptime_seconds: number; server_version: string;
  top_tables: { table: string; size_pretty: string; live_rows: number; dead_rows: number; seq_scan: number; idx_scan: number }[];
  unused_indexes: { table: string; index: string; size: number; scans: number }[];
};

const bytes = (n: number) => n > 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB` : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

const CHECK_LABELS: Record<string, string> = {
  'db.cache_hit': 'Reads served from memory',
  'db.unindexed_fk': 'Links without a quick lookup',
  'db.seq_scans': 'Tables read the slow way',
  'db.dead_tuples': 'Tables needing a clean-up',
  'security.rls': 'Tables without access rules',
};

/** Plain English for a check's label. The check text itself is written in the database; this only changes the label on screen. */
function plainCheckLabel(c: { key: string; label: string }): string {
  return CHECK_LABELS[c.key] || c.label.replace(/ & /g, ' and ');
}

export default function AdminHealth() {
  const { can } = useAuth();
  const { navigate } = useNavigation();
  const overview = useAdminRpc<Overview>('admin_health_overview');
  const metrics = useAdminRpc<Metrics>('admin_system_metrics');
  const action = useAdminAction();
  const canFix = can('ops.fix');

  const checks = overview.data?.checks || [];
  const issues = checks.filter(c => c.severity !== 'ok');
  const last = overview.data?.last;

  const runChecks = () => action.run('scan', async () => {
    const { error } = await supabase.rpc('admin_run_checks');
    overview.reload(); metrics.reload();
    return { error: error?.message || null, text: error ? '' : 'Scan complete.' };
  });

  const fix = (c: Check) => action.run(`fix-${c.key}`, async () => {
    const { data, error } = await supabase.rpc('admin_fix_issue', { p_key: c.fix_key });
    overview.reload();
    const message = (data as { message?: string } | null)?.message;
    return { error: error?.message || null, text: message || 'Repair applied.' };
  });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><HeartPulse size={20} className="text-bronze" /> Health &amp; issues</h1>
          <p className="text-sm text-charcoal-muted mt-1">
            {last ? `Last scan ${new Date(last.taken_at).toLocaleString()} (${last.duration_ms} ms).` : 'No scan has run yet.'} Checks cover the database, queue, commerce, content, security, storage and jobs.
          </p>
        </div>
        <Btn onClick={runChecks} busy={action.busy === 'scan'} icon={<Play size={13} />}>Run checks now</Btn>
      </div>

      {action.message && <div className="mb-4"><Notice tone={action.message.tone}>{action.message.text}</Notice></div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {([['critical', 'red'], ['warning', 'amber'], ['info', 'blue'], ['ok', 'green']] as const).map(([sev, tone]) => {
          const n = last ? (last as unknown as Record<string, number>)[sev] : 0;
          return (
            <div key={sev} className={`bg-white border rounded-sm p-4 border-taupe/30`}>
              <p className="text-xs uppercase tracking-wide text-charcoal-muted">{sev}</p>
              <p className={`text-2xl font-serif ${tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'blue' ? 'text-blue-600' : 'text-green-600'}`}>{n}</p>
            </div>
          );
        })}
      </div>

      {overview.data?.trend && overview.data.trend.length > 1 && (
        <Panel title="Trend (last 30 scans)">
          <div className="flex items-end gap-1 h-16">
            {overview.data.trend.map((t, i) => {
              const total = Math.max(1, t.critical + t.warning);
              return <div key={i} title={`${new Date(t.taken_at).toLocaleString()} — ${t.critical} critical, ${t.warning} warning`}
                className="flex-1 flex flex-col justify-end">
                <div className="bg-red-400" style={{ height: `${(t.critical / total) * 100}%` }} />
                <div className="bg-amber-300" style={{ height: `${(t.warning / total) * 100}%` }} />
              </div>;
            })}
          </div>
        </Panel>
      )}

      <Panel title={`Issues (${issues.length})`} icon={<Wrench size={15} className="text-bronze" />}
        actions={<Btn variant="ghost" onClick={overview.reload} busy={overview.loading}>Reload</Btn>}>
        {overview.loading ? <Loading /> : overview.error ? <Notice tone="error">{overview.error}</Notice> : issues.length === 0 ? (
          <Empty>Everything checks out. Run the scan again after your next deploy.</Empty>
        ) : (
          <div className="space-y-3">
            {issues.map(c => (
              <div key={c.key} className="border border-taupe/30 rounded-sm p-4">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Severity level={c.severity} />
                  <span className="text-sm text-charcoal font-medium">{plainCheckLabel(c)}</span>
                  <span className="text-[10px] uppercase tracking-wide text-charcoal-muted">{c.category}</span>
                </div>
                <p className="text-xs text-charcoal-light">{c.detail}</p>
                {c.suggestion && <p className="text-xs text-charcoal-muted mt-1">{c.suggestion}</p>}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {c.fix_key && canFix && <Btn variant="ghost" icon={<Wrench size={12} />} busy={action.busy === `fix-${c.key}`} onClick={() => fix(c)}>Fix now</Btn>}
                  {c.fix_key && !canFix && <span className="text-[11px] text-charcoal-muted">You need the repair permission to fix this.</span>}
                  {c.action_route && <Btn variant="ghost" onClick={() => navigate({ name: c.action_route } as never)}>{c.action_label || 'Open'}</Btn>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Capacity & scaling" icon={<Gauge size={15} className="text-bronze" />}>
        {metrics.loading ? <Loading /> : metrics.error ? <Notice tone="error">{metrics.error}</Notice> : metrics.data && (
          <>
            <div className="grid sm:grid-cols-3 gap-3 mb-4 text-sm">
              <div><p className="text-xs text-charcoal-muted">Database size</p><p className="text-charcoal">{metrics.data.database_pretty} of {bytes(metrics.data.free_tier_limit)}</p></div>
              <div><p className="text-xs text-charcoal-muted">Reads served from memory</p><p className="text-charcoal">{Math.round((metrics.data.cache_hit || 0) * 1000) / 10}%</p></div>
              <div><p className="text-xs text-charcoal-muted">Connections</p><p className="text-charcoal">{metrics.data.connections}</p></div>
              <div><p className="text-xs text-charcoal-muted">Tables and lookups</p><p className="text-charcoal">{metrics.data.tables} / {metrics.data.indexes}</p></div>
              <div><p className="text-xs text-charcoal-muted">Estimated rows</p><p className="text-charcoal">{metrics.data.estimated_rows.toLocaleString()}</p></div>
              <div><p className="text-xs text-charcoal-muted">Database version</p><p className="text-charcoal">{metrics.data.server_version}</p></div>
            </div>
            <div className="h-2 bg-taupe-light/50 rounded-sm mb-5">
              <div className={`h-2 rounded-sm ${metrics.data.database_size / metrics.data.free_tier_limit > 0.9 ? 'bg-red-500' : 'bg-bronze'}`}
                style={{ width: `${Math.min(100, (metrics.data.database_size / metrics.data.free_tier_limit) * 100)}%` }} />
            </div>

            <p className="text-xs font-medium text-charcoal mb-2 flex items-center gap-1.5"><HardDrive size={13} /> Largest tables</p>
            <div className="overflow-auto mb-4">
              <table className="min-w-full text-xs">
                <thead><tr className="text-charcoal-muted text-left"><th className="p-2">Table</th><th className="p-2">Size</th><th className="p-2">Rows</th><th className="p-2">Old rows to clean</th><th className="p-2">Full scans / quick lookups</th></tr></thead>
                <tbody>
                  {metrics.data.top_tables.map(t => (
                    <tr key={t.table} className="border-t border-taupe/15">
                      <td className="p-2 font-mono">{t.table}</td><td className="p-2">{t.size_pretty}</td>
                      <td className="p-2">{t.live_rows?.toLocaleString?.() ?? t.live_rows}</td>
                      <td className="p-2">{t.dead_rows}</td>
                      <td className="p-2">{t.seq_scan} / {t.idx_scan}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {metrics.data.unused_indexes.length > 0 && (
              <>
                <p className="text-xs font-medium text-charcoal mb-2 flex items-center gap-1.5"><Database size={13} /> Lookups never used since the counts were last reset</p>
                <ul className="text-xs text-charcoal-muted space-y-1">
                  {metrics.data.unused_indexes.map(i => <li key={i.index}>{i.table}.{i.index} — {bytes(i.size)}</li>)}
                </ul>
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
