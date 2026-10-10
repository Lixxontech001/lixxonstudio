import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Play, Plus, RefreshCw, Save, Table2, Trash2, X, Download, Search } from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { downloadCsv } from '../lib/csv';
import { Panel, Btn, Notice, useAdminRpc, Loading, Empty } from '../components/ui';

type Column = { name: string; type: string; nullable: boolean; default: string | null; is_generated: boolean; is_pk: boolean };
type CatalogueEntry = {
  table: string; label: string; category: string;
  allow_insert: boolean; allow_update: boolean; allow_delete: boolean;
  is_sensitive: boolean; notes: string | null; row_estimate: number; columns: Column[];
};

const editable = (c: Column) => !c.is_generated;

export default function AdminDataExplorer() {
  const { can } = useAuth();
  const catalogue = useAdminRpc<CatalogueEntry[]>('admin_table_catalog');
  const [tab, setTab] = useState<'browse' | 'sql'>('browse');
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState<CatalogueEntry | null>(null);

  const tables = catalogue.data || [];
  const filtered = useMemo(
    () => tables.filter(t => !filter || `${t.label} ${t.table} ${t.category}`.toLowerCase().includes(filter.toLowerCase())),
    [tables, filter]);

  useEffect(() => {
    if (!active && tables.length) setActive(tables.find(t => t.table === 'posts') || tables[0]);
  }, [tables, active]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><Database size={20} className="text-bronze" /> Data</h1>
        <p className="text-sm text-charcoal-muted mt-1">
          Browse and edit any table the database lets you touch. Row-level security runs as <em>you</em>, so the explorer can never show or change a row a permission does not cover — and every write is audited.
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-taupe/30">
        {([['browse', 'Browse & edit', <Table2 size={14} key="t" />], ['sql', 'SQL console', <Play size={14} key="p" />]] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-3 py-2 text-xs border-b-2 -mb-px ${tab === id ? 'border-bronze text-charcoal' : 'border-transparent text-charcoal-muted hover:text-charcoal'}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {tab === 'sql' ? <SqlConsole allowed={can('data.sql')} /> : (
        catalogue.loading ? <Loading /> : catalogue.error ? <Notice tone="error">{catalogue.error}</Notice> : (
          <div className="grid lg:grid-cols-[240px_1fr] gap-5">
            <div className="bg-white border border-taupe/30 rounded-sm p-3 h-fit lg:sticky lg:top-4">
              <label className="relative block mb-3">
                <Search size={13} className="absolute left-2.5 top-2.5 text-charcoal-muted" />
                <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter tables…"
                  className="w-full border border-taupe/40 pl-7 pr-2 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze" />
              </label>
              <div className="max-h-[60vh] overflow-y-auto space-y-3">
                {Array.from(new Set(filtered.map(t => t.category))).map(cat => (
                  <div key={cat}>
                    <p className="text-[10px] uppercase tracking-editorial text-bronze mb-1">{cat}</p>
                    {filtered.filter(t => t.category === cat).map(t => (
                      <button key={t.table} onClick={() => setActive(t)}
                        className={`block w-full text-left px-2 py-1.5 text-xs rounded-sm ${active?.table === t.table ? 'bg-charcoal text-white' : 'text-charcoal-light hover:bg-taupe-light/40'}`}>
                        {t.label}
                        <span className="block text-[10px] opacity-70">{t.table} · ~{t.row_estimate} rows</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {active ? <TableBrowser key={active.table} entry={active} /> : <Empty>Pick a table.</Empty>}
          </div>
        )
      )}
    </div>
  );
}

function TableBrowser({ entry }: { entry: CatalogueEntry }) {
  const { can } = useAuth();
  const pk = entry.columns.find(c => c.is_pk)?.name || null;
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [order, setOrder] = useState<{ col: string; asc: boolean } | null>(pk ? { col: pk, asc: false } : null);
  const [containsCol, setContainsCol] = useState(entry.columns[0]?.name || '');
  const [contains, setContains] = useState('');
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [inserting, setInserting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    let q = supabase.from(entry.table).select('*', { count: 'exact' });
    if (contains.trim()) q = q.ilike(containsCol, `%${contains.trim()}%`);
    q = q.order(order?.col || pk || entry.columns[0]?.name, { ascending: order?.asc ?? false });
    const { data: d, count: c, error: e } = await q.range(page * pageSize, page * pageSize + pageSize - 1);
    if (e) setError(e.message); else { setData(rows<Record<string, unknown>>(d)); setCount(c || 0); }
    setLoading(false);
  }, [entry, page, pageSize, order, contains, containsCol, pk]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(0); setContains(''); setEditing(null); setInserting(false); }, [entry.table]);

  const canWrite = can('data.write');
  const mayUpdate = canWrite && entry.allow_update && Boolean(pk);
  const mayInsert = canWrite && entry.allow_insert;
  const mayDelete = canWrite && entry.allow_delete && Boolean(pk);

  const openEdit = (row: Record<string, unknown>) => {
    setDraft(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)])));
    setEditing(row);
    setInserting(false);
  };

  const parseDrafts = () => {
    const out: Record<string, unknown> = {};
    for (const c of entry.columns) {
      if (!(c.name in draft)) continue;
      const raw = draft[c.name];
      if (raw === '' && c.nullable) { out[c.name] = null; continue; }
      if (c.type === 'jsonb' || c.type === 'ARRAY' || c.type === 'USER-DEFINED') {
        try { out[c.name] = raw === '' ? null : JSON.parse(raw); } catch { throw new Error(`${c.name} is not valid JSON`); }
      } else if (/int|numeric|decimal|real|double/.test(c.type) && raw !== '') {
        out[c.name] = Number(raw);
      } else out[c.name] = raw;
    }
    return out;
  };

  const saveEdit = async () => {
    if (!editing || !pk) return;
    try {
      const patch = parseDrafts();
      delete patch[pk];
      const { error: e } = await supabase.from(entry.table).update(patch).eq(pk, editing[pk] as string);
      if (e) setError(e.message); else { setNotice('Saved — the audit trail recorded the diff.'); setEditing(null); load(); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); }
  };

  const saveInsert = async () => {
    try {
      const patch = parseDrafts();
      Object.keys(patch).forEach(k => { if (patch[k] === '' && !entry.columns.find(c => c.name === k)?.nullable) delete patch[k]; });
      const { error: e } = await supabase.from(entry.table).insert(patch);
      if (e) setError(e.message); else { setNotice('Row created.'); setInserting(false); setDraft({}); load(); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not insert'); }
  };

  const removeRow = async (row: Record<string, unknown>) => {
    if (!pk || !confirm(`Delete this row from ${entry.table}? This is audited and may not be reversible everywhere.`)) return;
    const { error: e } = await supabase.from(entry.table).delete().eq(pk, row[pk] as string);
    if (e) setError(e.message); else { setNotice('Row deleted (audit entry written).'); load(); }
  };

  const cell = (v: unknown) => v === null ? <span className="text-charcoal-muted italic">null</span> : typeof v === 'object' ? <span className="font-mono text-[11px]">{JSON.stringify(v).slice(0, 80)}</span> : String(v).slice(0, 120);

  return (
    <div>
      <Panel title={`${entry.label} (${entry.table})`}
        icon={<Table2 size={15} className="text-bronze" />}
        actions={<>
          {entry.is_sensitive && <span className="text-[10px] uppercase tracking-wide text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-sm">contains PII / money</span>}
          {mayInsert && <Btn variant="ghost" icon={<Plus size={13} />} onClick={() => { setInserting(true); setEditing(null); setDraft({}); }}>New row</Btn>}
          <Btn variant="ghost" icon={<Download size={13} />} onClick={async () => {
            const { data: all } = await supabase.from(entry.table).select('*').limit(5000);
            downloadCsv(entry.table, rows<Record<string, unknown>>(all));
          }}>CSV</Btn>
          <Btn variant="ghost" icon={<RefreshCw size={13} />} onClick={load} busy={loading}>Reload</Btn>
        </>}>
        {entry.notes && <p className="text-xs text-charcoal-muted mb-3">{entry.notes}</p>}

        <div className="flex flex-wrap items-end gap-2 mb-4">
          <select value={containsCol} onChange={e => setContainsCol(e.target.value)} className="border border-taupe/40 px-2 py-1.5 text-xs rounded-sm bg-white">
            {entry.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <input value={contains} onChange={e => setContains(e.target.value)} placeholder="contains…" className="border border-taupe/40 px-2 py-1.5 text-xs rounded-sm" />
          <Btn variant="ghost" onClick={() => { setContains(''); setPage(0); }}>Clear</Btn>
          <span className="text-xs text-charcoal-muted ml-auto">{count} row(s) · page {page + 1} of {Math.max(1, Math.ceil(count / pageSize))}</span>
        </div>

        {notice && <div className="mb-3"><Notice tone="ok">{notice}</Notice></div>}
        {error && <div className="mb-3"><Notice tone="error">{error} <button className="underline ml-1" onClick={() => setError(null)}>dismiss</button></Notice></div>}

        {loading ? <Loading /> : data.length === 0 ? <Empty>No rows.</Empty> : (
          <div className="overflow-auto max-h-[60vh] border border-taupe/20 rounded-sm">
            <table className="min-w-full text-xs">
              <thead className="bg-taupe-light/30 sticky top-0">
                <tr>
                  {entry.columns.map(c => (
                    <th key={c.name} className="text-left p-2 whitespace-nowrap cursor-pointer" onClick={() => setOrder(o => o?.col === c.name ? { col: c.name, asc: !o.asc } : { col: c.name, asc: true })}>
                      {c.name}{c.is_pk && ' 🔑'}{order?.col === c.name && (order.asc ? ' ↑' : ' ↓')}
                    </th>
                  ))}
                  {(mayUpdate || mayDelete) && <th className="p-2" />}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={pk ? String(row[pk]) : i} className="border-t border-taupe/15 hover:bg-taupe-light/20">
                    {entry.columns.map(c => <td key={c.name} className="p-2 align-top whitespace-nowrap">{cell(row[c.name])}</td>)}
                    {(mayUpdate || mayDelete) && (
                      <td className="p-2 whitespace-nowrap">
                        {mayUpdate && <button className="text-charcoal-muted hover:text-bronze mr-2" onClick={() => openEdit(row)} title="Edit row"><Save size={12} /></button>}
                        {mayDelete && <button className="text-charcoal-muted hover:text-red-600" onClick={() => removeRow(row)} title="Delete row"><Trash2 size={12} /></button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-between mt-3">
          <Btn variant="ghost" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Btn>
          <Btn variant="ghost" disabled={(page + 1) * pageSize >= count} onClick={() => setPage(p => p + 1)}>Next</Btn>
        </div>
      </Panel>

      {(editing || inserting) && (
        <Panel title={editing ? `Edit row in ${entry.table}` : `New row in ${entry.table}`}
          actions={<Btn variant="ghost" icon={<X size={13} />} onClick={() => { setEditing(null); setInserting(false); }}>Close</Btn>}>
          <div className="grid sm:grid-cols-2 gap-3">
            {entry.columns.filter(editable).map(c => (
              <label key={c.name} className={`text-xs text-charcoal-muted ${c.type === 'jsonb' || c.type === 'ARRAY' ? 'sm:col-span-2' : ''}`}>
                {c.name} <span className="text-[10px]">({c.type}{c.nullable ? ', nullable' : ''})</span>
                {(c.type === 'jsonb' || c.type === 'ARRAY' || c.type === 'text') ? (
                  <textarea rows={c.type === 'text' ? 3 : 2} value={draft[c.name] ?? ''} onChange={e => setDraft(d => ({ ...d, [c.name]: e.target.value }))}
                    className="w-full mt-1 border border-taupe/40 px-2 py-1.5 text-xs rounded-sm font-mono" />
                ) : (
                  <input value={draft[c.name] ?? ''} onChange={e => setDraft(d => ({ ...d, [c.name]: e.target.value }))}
                    className="w-full mt-1 border border-taupe/40 px-2 py-1.5 text-xs rounded-sm" />
                )}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Btn onClick={editing ? saveEdit : saveInsert} icon={<Save size={13} />}>{editing ? 'Save changes' : 'Create row'}</Btn>
          </div>
        </Panel>
      )}
    </div>
  );
}

function SqlConsole({ allowed }: { allowed: boolean }) {
  const [sql, setSql] = useState('SELECT table_name, (SELECT count(*) FROM pg_stat_user_tables s WHERE s.relname = t.table_name) AS seq_scans\nFROM information_schema.tables t\nWHERE table_schema = \'public\'\nORDER BY table_name\nLIMIT 50;');
  const [result, setResult] = useState<{ ok: boolean; rows?: Record<string, unknown>[]; row_count?: number; truncated?: boolean; ms?: number; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_run_sql', { p_sql: sql, p_max_rows: 200 });
    setBusy(false);
    setResult(error ? { ok: false, error: error.message } : (data as typeof result));
  };

  if (!allowed) {
    return <Notice tone="warn">Your role does not hold the <code>data.sql</code> permission. An owner can grant it under Team &amp; access.</Notice>;
  }

  return (
    <Panel title="Read-only SQL" icon={<Play size={15} className="text-bronze" />}
      actions={<Btn onClick={run} busy={busy} icon={<Play size={13} />}>Run (⌘/Ctrl + Enter)</Btn>}>
      <p className="text-xs text-charcoal-muted mb-3">
        Single <code>SELECT</code>/<code>WITH</code> statement. It runs as you inside a read-only transaction with a 5-second timeout and a 200-row cap, so writes fail, and the database access rules still hide rows you could not read elsewhere.
      </p>
      <textarea value={sql} onChange={e => setSql(e.target.value)} rows={7} spellCheck={false}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); }}
        className="w-full border border-taupe/40 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze" />

      {result && (
        <div className="mt-4">
          {result.ok === false ? <Notice tone="error">{result.error}</Notice> : (
            <>
              <p className="text-xs text-charcoal-muted mb-2">{result.row_count} row(s) · {result.ms} ms {result.truncated && '· truncated at the row cap'}</p>
              {result.rows && result.rows.length > 0 && (
                <div className="overflow-auto max-h-[50vh] border border-taupe/20 rounded-sm">
                  <table className="min-w-full text-xs">
                    <thead className="bg-taupe-light/30">
                      <tr>{Object.keys(result.rows[0]).map(k => <th key={k} className="text-left p-2">{k}</th>)}</tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r, i) => (
                        <tr key={i} className="border-t border-taupe/15">
                          {Object.keys(result.rows![0]).map(k => (
                            <td key={k} className="p-2 whitespace-nowrap">{r[k] === null ? <span className="text-charcoal-muted italic">null</span> : typeof r[k] === 'object' ? JSON.stringify(r[k]).slice(0, 100) : String(r[k]).slice(0, 120)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
