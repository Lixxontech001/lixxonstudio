import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Search, RotateCcw, X, ShieldAlert, Download, ArrowRight } from 'lucide-react';
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

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><Activity size={20} className="text-bronze" /> Activity log</h1>
          <p className="text-sm text-charcoal-muted mt-1">
            Every admin write, with actor, IP and a field-level before/after diff. Entries are written by database triggers, so the panel cannot skip one; revertable edits can be undone in place.
          </p>
        </div>
        <Btn variant="ghost" icon={<Download size={13} />} onClick={() => downloadCsv('audit-log', rows.map(r => ({
          when: r.created_at, actor: r.actor_email || r.performed_by, role: r.actor_role, severity: r.severity,
          action: r.action, entity: r.entity_type, entity_id: r.entity_id, label: r.entity_label,
          changes: r.changes ? JSON.stringify(r.changes) : '', ip: r.ip, description: r.description, reverted: r.reverted_at || '',
        })))} disabled={!can('analytics.export')}>Export CSV</Btn>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        {cards.map(([label, n]) => (
          <div key={label} className="bg-white border border-taupe/30 rounded-sm p-3">
            <p className="text-[10px] uppercase tracking-wide text-charcoal-muted">{label}</p>
            <p className="text-xl font-serif text-charcoal">{n}</p>
          </div>
        ))}
      </div>

      <Panel>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <label className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-3 text-charcoal-muted" />
            <input value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} placeholder="Search description, id, label or any changed value…"
              className="w-full border border-taupe/40 pl-7 pr-2 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze" />
          </label>
          <select value={filters.entity_type} onChange={e => setFilters({ ...filters, entity_type: e.target.value })} className="border border-taupe/40 px-2 py-2 text-xs rounded-sm bg-white">
            <option value="">All entities</option>
            {(result?.entities || []).map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <select value={filters.action} onChange={e => setFilters({ ...filters, action: e.target.value })} className="border border-taupe/40 px-2 py-2 text-xs rounded-sm bg-white">
            <option value="">All actions</option>
            {['insert', 'update', 'delete', 'revert'].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filters.severity} onChange={e => setFilters({ ...filters, severity: e.target.value })} className="border border-taupe/40 px-2 py-2 text-xs rounded-sm bg-white">
            <option value="">Any severity</option>
            {['info', 'warning', 'critical'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.actor} onChange={e => setFilters({ ...filters, actor: e.target.value })} className="border border-taupe/40 px-2 py-2 text-xs rounded-sm bg-white">
            <option value="">Any actor</option>
            {(result?.actors || []).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} className="border border-taupe/40 px-2 py-2 text-xs rounded-sm" aria-label="From date" />
          <input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : '' })} className="border border-taupe/40 px-2 py-2 text-xs rounded-sm" aria-label="To date" />
          <Btn variant="ghost" onClick={() => setFilters({ q: '', entity_type: '', action: '', severity: '', actor: '', from: '', to: '' })}>Clear</Btn>
        </div>

        {action.message && <div className="mb-3"><Notice tone={action.message.tone}>{action.message.text}</Notice></div>}
        {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}

        {loading ? <Loading /> : rows.length === 0 ? <Empty>No entries match those filters.</Empty> : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-charcoal-muted text-left border-b border-taupe/20">
                    <th className="py-2 pr-3">When</th><th className="py-2 pr-3">Actor</th><th className="py-2 pr-3">Severity</th>
                    <th className="py-2 pr-3">Action</th><th className="py-2 pr-3">Entity</th><th className="py-2 pr-3">Change</th><th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className={`border-b border-taupe/10 hover:bg-taupe-light/20 ${r.reverted_at ? 'opacity-60' : ''}`}>
                      <td className="py-2 pr-3 whitespace-nowrap text-charcoal-muted">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="text-charcoal">{r.actor_email || r.performed_by || 'system'}</span>
                        {r.actor_role && <span className="block text-[10px] text-charcoal-muted">{r.actor_role}{r.ip ? ` · ${r.ip}` : ''}</span>}
                      </td>
                      <td className="py-2 pr-3"><Severity level={r.severity} /></td>
                      <td className="py-2 pr-3 uppercase tracking-wide text-[10px]">{r.action}</td>
                      <td className="py-2 pr-3">
                        <span className="text-charcoal-light">{r.entity_label || r.entity_type}</span>
                        <span className="block text-[10px] text-charcoal-muted font-mono">{r.entity_id?.slice(0, 8)}</span>
                      </td>
                      <td className="py-2 pr-3 text-charcoal-light max-w-[280px] truncate" title={r.description || ''}>{r.description || (r.change_count ? `${r.change_count} field(s)` : '—')}</td>
                      <td className="py-2 whitespace-nowrap">
                        <button className="text-bronze underline text-[11px]" onClick={() => setOpen(r)}>diff</button>
                        {canRevert && REVERTABLE.has(r.entity_type || '') && r.action !== 'revert' && !r.reverted_at && (
                          <button className="ml-2 text-charcoal-muted hover:text-red-600 text-[11px] underline" onClick={() => revert(r)}>undo</button>
                        )}
                        {r.reverted_at && <span className="ml-2 text-[10px] uppercase text-amber-700">reverted</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-4 text-xs text-charcoal-muted">
              <span>{result?.total || 0} entr(ies) · showing {offset + 1}–{offset + rows.length}</span>
              <div className="flex gap-2">
                <Btn variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Newer</Btn>
                <Btn variant="ghost" disabled={offset + limit >= (result?.total || 0)} onClick={() => setOffset(offset + limit)}>Older</Btn>
                <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="border border-taupe/40 px-2 py-1.5 rounded-sm bg-white">
                  {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </div>
          </>
        )}
      </Panel>

      {open && (
        <div className="fixed inset-0 z-[70] flex justify-end">
          <div className="absolute inset-0 bg-charcoal/40" onClick={() => setOpen(null)} />
          <aside className="relative w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="font-serif text-xl text-charcoal">{open.entity_label || open.entity_type}</h2>
                <p className="text-xs text-charcoal-muted">{open.action} · {new Date(open.created_at).toLocaleString()} · {open.actor_email || open.performed_by}</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-charcoal-muted hover:text-charcoal" aria-label="Close"><X size={18} /></button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs mb-5">
              <div><p className="text-charcoal-muted">Severity</p><Severity level={open.severity} /></div>
              <div><p className="text-charcoal-muted">Role</p><p className="text-charcoal">{open.actor_role || '—'}</p></div>
              <div><p className="text-charcoal-muted">IP</p><p className="text-charcoal font-mono">{open.ip || '—'}</p></div>
              <div><p className="text-charcoal-muted">Source</p><p className="text-charcoal">{open.source || '—'}</p></div>
              <div><p className="text-charcoal-muted">Entity id</p><p className="text-charcoal font-mono break-all">{open.entity_id || '—'}</p></div>
              <div><p className="text-charcoal-muted">Sequence</p><p className="text-charcoal">#{open.seq}</p></div>
            </div>

            {open.description && <p className="text-sm text-charcoal-light mb-4">{open.description}</p>}

            {open.changes && Object.keys(open.changes).length > 0 ? (
              <div className="border border-taupe/30 rounded-sm overflow-hidden mb-5">
                <table className="min-w-full text-xs">
                  <thead className="bg-taupe-light/30"><tr><th className="text-left p-2">Field</th><th className="text-left p-2">Before</th><th className="text-left p-2">After</th></tr></thead>
                  <tbody>
                    {Object.entries(open.changes).map(([field, d]) => (
                      <tr key={field} className="border-t border-taupe/15">
                        <td className="p-2 font-mono text-charcoal">{field}</td>
                        <td className="p-2 text-red-700 break-all max-w-[220px]">{fmt(d?.from)}</td>
                        <td className="p-2 text-green-800 break-all max-w-[220px]">{fmt(d?.to)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Notice tone="info">No field-level diff was recorded for this entry (inserts and deletes keep the full row).</Notice>
            )}

            <div className="flex flex-wrap gap-2 mt-5">
              {canRevert && REVERTABLE.has(open.entity_type || '') && open.action !== 'revert' && !open.reverted_at && (
                <Btn variant="danger" icon={<RotateCcw size={13} />} busy={action.busy === open.id} onClick={() => revert(open)}>Undo this change</Btn>
              )}
              {open.revert_of && <Btn variant="ghost" disabled>This entry is itself a revert</Btn>}
              {open.reverted_at && <Notice tone="warn">Already reverted on {new Date(open.reverted_at).toLocaleString()}</Notice>}
            </div>

            {!canRevert && <p className="text-[11px] text-charcoal-muted mt-4 flex items-center gap-1"><ShieldAlert size={12} /> Undo needs the <code>audit.revert</code> permission.</p>}
            <p className="text-[11px] text-charcoal-muted mt-4 flex items-center gap-1"><ArrowRight size={12} /> Entries are pruned weekly (180-day retention) by the scheduled job.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
