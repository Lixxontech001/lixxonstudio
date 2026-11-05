import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Search, RotateCcw, X, ShieldAlert, Download, ArrowRight, Clock, User, Globe, List, GitCommit } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { downloadCsv } from '../lib/csv';
import { Panel, Btn, Notice, Severity, Empty, Loading, useAdminAction } from '../components/ui';

type LogRow = {
  id: string; seq: number; action: string; entity_type: string | null; entity_id: string | null;
  entity_label: string | null; description: string | null; performed_by: string | null;
  actor_id: string | null; actor_email: string | null; actor_role: string | null;
  changes: Record<string, { from?: unknown; to?: unknown }> | null;
  ip: string | null; severity: 'info' | 'warning' | 'critical'; source: string | null;
  created_at: string; reverted_at: string | null; reverted_by: string | null; revert_of: string | null;
  change_count: number;
};
type SearchResult = { rows: LogRow[]; total: number; entities: string[]; actors: string[] };
type Stats = { total: number; critical: number; warning: number; last_24h: number; actors_7d: number; reverted: number; revertable: number };

const REVERTABLE = new Set(['posts', 'products', 'promo_codes', 'gift_cards', 'collections', 'collection_items', 'categories',
  'authors', 'site_settings', 'glossary_terms', 'article_series', 'featured_slots', 'content_templates', 'currency_rates',
  'shop_categories', 'article_polls', 'sponsored_content', 'search_synonyms', 'headline_variants']);

const fmt = (v: unknown) => v === null || v === undefined ? '—'
  : typeof v === 'object' ? JSON.stringify(v)
    : typeof v === 'string' ? (v.length > 160 ? `${v.slice(0, 160)}…` : v)
      : String(v);

export default function AdminActivityLog() {
  const { can } = useAuth();
  const [filters, setFilters] = useState({ q: '', entity_type: '', action: '', severity: '', actor: '', from: '', to: '' });
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [viewMode, setViewMode] = useState<'timeline' | 'table'>('timeline');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<LogRow | null>(null);
  const action = useAdminAction();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase.rpc('admin_audit_search', { p_filters: { ...filters, limit, offset } });
    const { data: s } = await supabase.rpc('admin_audit_stats');
    if (e) setError(e.message); else { setError(null); setResult(data as SearchResult); setStats((s as Stats) || null); }
    setLoading(false);
  }, [filters, limit, offset]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); }, [filters, limit]);

  const rows = result?.rows || [];
  const canRevert = can('audit.revert');

  const revert = (row: LogRow) => {
    if (!confirm(`Undo this change to ${row.entity_type}? The revert is recorded as a new audit entry.`)) return;
    action.run(row.id, async () => {
      const { error: e } = await supabase.rpc('admin_audit_revert', { p_log_id: row.id });
      if (!e) { await load(); setOpen(null); }
      return { error: e?.message || null, text: 'Reverted — the original entry is marked and a new revert entry was written.' };
    });
  };

  const cards = useMemo(() => stats ? [
    ['Last 24 h', stats.last_24h], ['Critical (30 d)', stats.critical], ['Warnings (30 d)', stats.warning],
    ['Active actors (7 d)', stats.actors_7d], ['Revertable edits', stats.revertable], ['Reverted', stats.reverted],
  ] as const : [], [stats]);

  const getActionBadgeColor = (act: string) => {
    switch (act.toLowerCase()) {
      case 'insert': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
      case 'update': return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300 dark:border-blue-800';
      case 'delete': return 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300 dark:border-red-800';
      case 'revert': return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-300 dark:border-gray-700';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in text-charcoal dark:text-[#E8E2D9]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-taupe/20 dark:border-white/10 pb-4">
        <div>
          <h1 className="font-serif text-2xl lg:text-3xl text-charcoal dark:text-white flex items-center gap-2">
            <Activity size={22} className="text-bronze" /> Activity Log &amp; Audit Trail
          </h1>
          <p className="text-xs sm:text-sm text-charcoal-muted dark:text-gray-400 mt-1">
            Every studio write recorded with actor, IP, and a field-level before/after diff. Revertable edits can be undone in place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded border border-taupe/40 dark:border-white/10 bg-white dark:bg-[#1A1A1A] p-0.5 text-xs">
            <button
              onClick={() => setViewMode('timeline')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors ${viewMode === 'timeline' ? 'bg-charcoal text-white dark:bg-bronze' : 'text-charcoal-muted dark:text-gray-400'}`}
            >
              <GitCommit size={13} /> Timeline
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors ${viewMode === 'table' ? 'bg-charcoal text-white dark:bg-bronze' : 'text-charcoal-muted dark:text-gray-400'}`}
            >
              <List size={13} /> Table
            </button>
          </div>
          <Btn
            variant="ghost"
            icon={<Download size={13} />}
            onClick={() => downloadCsv('audit-log', rows.map(r => ({
              when: r.created_at, actor: r.actor_email || r.performed_by, role: r.actor_role, severity: r.severity,
              action: r.action, entity: r.entity_type, entity_id: r.entity_id, label: r.entity_label,
              changes: r.changes ? JSON.stringify(r.changes) : '', ip: r.ip, description: r.description, reverted: r.reverted_at || '',
            })))}
            disabled={!can('analytics.export')}
          >
            Export CSV
          </Btn>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(([label, n]) => (
          <div key={label} className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-3 shadow-xs">
            <p className="text-[10px] uppercase tracking-editorial text-charcoal-muted dark:text-gray-400">{label}</p>
            <p className="text-xl font-serif text-charcoal dark:text-white mt-0.5">{n}</p>
          </div>
        ))}
      </div>

      <Panel>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <label className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-3 text-charcoal-muted" />
            <input
              value={filters.q}
              onChange={e => setFilters({ ...filters, q: e.target.value })}
              placeholder="Search description, id, label or any changed value…"
              className="w-full border border-taupe/40 dark:border-white/10 pl-7 pr-2 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white dark:bg-[#1C1C1C] dark:text-white"
            />
          </label>
          <select
            value={filters.entity_type}
            onChange={e => setFilters({ ...filters, entity_type: e.target.value })}
            className="border border-taupe/40 dark:border-white/10 px-2 py-2 text-xs rounded-sm bg-white dark:bg-[#1C1C1C] dark:text-white"
          >
            <option value="">All entities</option>
            {(result?.entities || []).map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <select
            value={filters.action}
            onChange={e => setFilters({ ...filters, action: e.target.value })}
            className="border border-taupe/40 dark:border-white/10 px-2 py-2 text-xs rounded-sm bg-white dark:bg-[#1C1C1C] dark:text-white"
          >
            <option value="">All actions</option>
            {['insert', 'update', 'delete', 'revert'].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            value={filters.severity}
            onChange={e => setFilters({ ...filters, severity: e.target.value })}
            className="border border-taupe/40 dark:border-white/10 px-2 py-2 text-xs rounded-sm bg-white dark:bg-[#1C1C1C] dark:text-white"
          >
            <option value="">Any severity</option>
            {['info', 'warning', 'critical'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filters.actor}
            onChange={e => setFilters({ ...filters, actor: e.target.value })}
            className="border border-taupe/40 dark:border-white/10 px-2 py-2 text-xs rounded-sm bg-white dark:bg-[#1C1C1C] dark:text-white"
          >
            <option value="">Any actor</option>
            {(result?.actors || []).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input
            type="date"
            value={filters.from}
            onChange={e => setFilters({ ...filters, from: e.target.value })}
            className="border border-taupe/40 dark:border-white/10 px-2 py-2 text-xs rounded-sm bg-white dark:bg-[#1C1C1C] dark:text-white"
            aria-label="From date"
          />
          <input
            type="date"
            value={filters.to}
            onChange={e => setFilters({ ...filters, to: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : '' })}
            className="border border-taupe/40 dark:border-white/10 px-2 py-2 text-xs rounded-sm bg-white dark:bg-[#1C1C1C] dark:text-white"
            aria-label="To date"
          />
          <Btn variant="ghost" onClick={() => setFilters({ q: '', entity_type: '', action: '', severity: '', actor: '', from: '', to: '' })}>
            Clear
          </Btn>
        </div>

        {action.message && <div className="mb-3"><Notice tone={action.message.tone}>{action.message.text}</Notice></div>}
        {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}

        {loading ? <Loading /> : rows.length === 0 ? <Empty>No activity entries match those filters.</Empty> : (
          <>
            {viewMode === 'timeline' ? (
              <div className="space-y-3 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-taupe/30 dark:before:bg-white/10 pl-8 pt-2">
                {rows.map(r => (
                  <div key={r.id} className="relative bg-white dark:bg-[#1C1C1C] border border-taupe/20 dark:border-white/5 rounded-sm p-4 hover:border-bronze/40 transition-colors shadow-xs">
                    <div className="absolute -left-[27px] top-4 w-3.5 h-3.5 rounded-full border-2 border-bronze bg-white dark:bg-[#121212]" />
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] uppercase tracking-editorial font-bold px-2 py-0.5 rounded border ${getActionBadgeColor(r.action)}`}>
                          {r.action}
                        </span>
                        <span className="font-serif text-sm font-medium text-charcoal dark:text-white">
                          {r.entity_label || r.entity_type}
                        </span>
                        <Severity level={r.severity} />
                        {r.reverted_at && (
                          <span className="text-[9px] uppercase font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                            Reverted
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-charcoal-muted dark:text-gray-400 flex items-center gap-1 font-mono">
                        <Clock size={11} />
                        <span>{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                    </div>

                    <p className="text-xs text-charcoal-light dark:text-gray-300 leading-relaxed">
                      {r.description || (r.change_count ? `${r.change_count} field(s) modified` : 'Action executed')}
                    </p>

                    <div className="mt-2.5 pt-2 border-t border-taupe/15 dark:border-white/5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-3 text-charcoal-muted dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <User size={11} className="text-bronze" /> {r.actor_email || r.performed_by || 'system'}
                        </span>
                        {r.ip && (
                          <span className="flex items-center gap-1 font-mono text-[10px]">
                            <Globe size={11} /> {r.ip}
                          </span>
                        )}
                        <span className="font-mono text-[10px]">#{r.seq}</span>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setOpen(r)}
                          className="text-bronze hover:underline font-medium text-xs"
                        >
                          View Diff
                        </button>
                        {canRevert && REVERTABLE.has(r.entity_type || '') && r.action !== 'revert' && !r.reverted_at && (
                          <button
                            onClick={() => revert(r)}
                            className="text-charcoal-muted hover:text-red-600 dark:hover:text-red-400 text-xs hover:underline"
                          >
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-charcoal-muted dark:text-gray-400 text-left border-b border-taupe/20 dark:border-white/10">
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">Actor</th>
                      <th className="py-2 pr-3">Severity</th>
                      <th className="py-2 pr-3">Action</th>
                      <th className="py-2 pr-3">Entity</th>
                      <th className="py-2 pr-3">Change</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className={`border-b border-taupe/10 dark:border-white/5 hover:bg-taupe-light/20 dark:hover:bg-white/5 ${r.reverted_at ? 'opacity-60' : ''}`}>
                        <td className="py-2 pr-3 whitespace-nowrap text-charcoal-muted dark:text-gray-400">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span className="text-charcoal dark:text-white font-medium">{r.actor_email || r.performed_by || 'system'}</span>
                          {r.actor_role && <span className="block text-[10px] text-charcoal-muted dark:text-gray-400">{r.actor_role}{r.ip ? ` · ${r.ip}` : ''}</span>}
                        </td>
                        <td className="py-2 pr-3"><Severity level={r.severity} /></td>
                        <td className="py-2 pr-3 uppercase tracking-wide text-[10px]">{r.action}</td>
                        <td className="py-2 pr-3">
                          <span className="text-charcoal-light dark:text-gray-300">{r.entity_label || r.entity_type}</span>
                          <span className="block text-[10px] text-charcoal-muted font-mono">{r.entity_id?.slice(0, 8)}</span>
                        </td>
                        <td className="py-2 pr-3 text-charcoal-light dark:text-gray-300 max-w-[280px] truncate" title={r.description || ''}>
                          {r.description || (r.change_count ? `${r.change_count} field(s)` : '—')}
                        </td>
                        <td className="py-2 whitespace-nowrap text-right">
                          <button className="text-bronze underline text-[11px]" onClick={() => setOpen(r)}>diff</button>
                          {canRevert && REVERTABLE.has(r.entity_type || '') && r.action !== 'revert' && !r.reverted_at && (
                            <button className="ml-2 text-charcoal-muted hover:text-red-600 text-[11px] underline" onClick={() => revert(r)}>undo</button>
                          )}
                          {r.reverted_at && <span className="ml-2 text-[10px] uppercase text-amber-700 dark:text-amber-400">reverted</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between mt-5 text-xs text-charcoal-muted dark:text-gray-400 pt-3 border-t border-taupe/20 dark:border-white/10">
              <span>{result?.total || 0} entr(ies) · showing {offset + 1}–{offset + rows.length}</span>
              <div className="flex gap-2">
                <Btn variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Newer</Btn>
                <Btn variant="ghost" disabled={offset + limit >= (result?.total || 0)} onClick={() => setOffset(offset + limit)}>Older</Btn>
                <select
                  value={limit}
                  onChange={e => setLimit(Number(e.target.value))}
                  className="border border-taupe/40 dark:border-white/10 px-2 py-1.5 rounded-sm bg-white dark:bg-[#1C1C1C] dark:text-white"
                >
                  {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </div>
          </>
        )}
      </Panel>

      {/* Diff Inspector Modal Drawer */}
      {open && (
        <div className="fixed inset-0 z-[70] flex justify-end">
          <div className="absolute inset-0 bg-charcoal/50 backdrop-blur-xs" onClick={() => setOpen(null)} />
          <aside className="relative w-full max-w-2xl bg-white dark:bg-[#161616] dark:text-white h-full overflow-y-auto shadow-2xl p-6 border-l border-taupe/30 dark:border-white/10">
            <div className="flex items-start justify-between gap-4 mb-4 pb-3 border-b border-taupe/20 dark:border-white/10">
              <div>
                <h2 className="font-serif text-xl text-charcoal dark:text-white">{open.entity_label || open.entity_type}</h2>
                <p className="text-xs text-charcoal-muted dark:text-gray-400 mt-0.5">
                  {open.action} · {new Date(open.created_at).toLocaleString()} · {open.actor_email || open.performed_by}
                </p>
              </div>
              <button onClick={() => setOpen(null)} className="text-charcoal-muted hover:text-charcoal dark:hover:text-white" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs mb-5 bg-taupe-light/20 dark:bg-white/5 p-3 rounded">
              <div><p className="text-charcoal-muted dark:text-gray-400">Severity</p><Severity level={open.severity} /></div>
              <div><p className="text-charcoal-muted dark:text-gray-400">Role</p><p className="text-charcoal dark:text-white font-medium">{open.actor_role || '—'}</p></div>
              <div><p className="text-charcoal-muted dark:text-gray-400">IP</p><p className="text-charcoal dark:text-white font-mono">{open.ip || '—'}</p></div>
              <div><p className="text-charcoal-muted dark:text-gray-400">Source</p><p className="text-charcoal dark:text-white">{open.source || '—'}</p></div>
              <div><p className="text-charcoal-muted dark:text-gray-400">Entity id</p><p className="text-charcoal dark:text-white font-mono break-all">{open.entity_id || '—'}</p></div>
              <div><p className="text-charcoal-muted dark:text-gray-400">Sequence</p><p className="text-charcoal dark:text-white font-mono">#{open.seq}</p></div>
            </div>

            {open.description && <p className="text-sm text-charcoal-light dark:text-gray-300 mb-4">{open.description}</p>}

            {open.changes && Object.keys(open.changes).length > 0 ? (
              <div className="border border-taupe/30 dark:border-white/10 rounded-sm overflow-hidden mb-5">
                <table className="min-w-full text-xs">
                  <thead className="bg-taupe-light/30 dark:bg-white/5">
                    <tr>
                      <th className="text-left p-2.5 text-charcoal-muted dark:text-gray-400">Field</th>
                      <th className="text-left p-2.5 text-charcoal-muted dark:text-gray-400">Before</th>
                      <th className="text-left p-2.5 text-charcoal-muted dark:text-gray-400">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(open.changes).map(([field, d]) => (
                      <tr key={field} className="border-t border-taupe/15 dark:border-white/5">
                        <td className="p-2.5 font-mono text-charcoal dark:text-white font-medium">{field}</td>
                        <td className="p-2.5 text-red-700 dark:text-red-400 break-all max-w-[220px] bg-red-50/50 dark:bg-red-950/20">{fmt(d?.from)}</td>
                        <td className="p-2.5 text-green-800 dark:text-green-400 break-all max-w-[220px] bg-green-50/50 dark:bg-green-950/20">{fmt(d?.to)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Notice tone="info">No field-level diff was recorded for this entry (inserts and deletes keep the full record).</Notice>
            )}

            <div className="flex flex-wrap gap-2 mt-5">
              {canRevert && REVERTABLE.has(open.entity_type || '') && open.action !== 'revert' && !open.reverted_at && (
                <Btn variant="danger" icon={<RotateCcw size={13} />} busy={action.busy === open.id} onClick={() => revert(open)}>Undo this change</Btn>
              )}
              {open.revert_of && <Btn variant="ghost" disabled>This entry is itself a revert</Btn>}
              {open.reverted_at && <Notice tone="warn">Already reverted on {new Date(open.reverted_at).toLocaleString()}</Notice>}
            </div>

            {!canRevert && <p className="text-[11px] text-charcoal-muted dark:text-gray-400 mt-4 flex items-center gap-1"><ShieldAlert size={12} /> Undo requires the <code>audit.revert</code> permission.</p>}
            <p className="text-[11px] text-charcoal-muted dark:text-gray-400 mt-4 flex items-center gap-1"><ArrowRight size={12} /> Entries are archived according to scheduled retention rules.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
