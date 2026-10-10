import { useEffect, useState } from 'react';
import { DatabaseBackup, Download, Loader2, Play } from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';

type Snap = { id: number; taken_at: string; summary: Record<string, unknown> };

export default function AdminBackups() {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<{ status: string; count: number }[]>([]);
  const load = async () => {
    const { data } = await supabase.from('backup_snapshots').select('id, taken_at, summary').order('taken_at', { ascending: false }).limit(40);
    setSnaps(rows(data));
    const { data: q } = await supabase.from('email_queue').select('status');
    const m: Record<string, number> = {}; rows<{ status: string }>(q).forEach(r => { m[r.status] = (m[r.status] || 0) + 1; });
    setQueue(Object.entries(m).map(([status, count]) => ({ status, count })));
  };
  useEffect(() => { load(); }, []);
  const run = async () => { setBusy(true); await supabase.rpc('admin_take_backup'); setBusy(false); load(); };
  const download = (s: Snap) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(s.summary, null, 2)], { type: 'application/json' })); a.download = `lixxon-backup-${s.taken_at.slice(0, 19).replace(/[:T]/g, '-')}.json`; a.click(); };
  const counts = (s: Snap) => Object.entries(s.summary).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}: ${(v as unknown[]).length}`).join(' · ');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div><h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><DatabaseBackup size={20} className="text-bronze" /> Backups & jobs</h1><p className="text-sm text-charcoal-muted mt-1">Supabase Free has no point-in-time recovery, so a nightly JSON snapshot of all editorial and commerce tables is kept for 30 days. Download one occasionally and keep it somewhere safe.</p></div>
        <button onClick={run} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze disabled:opacity-60">{busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Snapshot now</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-taupe/30 rounded-sm p-4"><p className="text-xs uppercase tracking-wide text-charcoal-muted mb-2">Email queue</p>{queue.length === 0 ? <p className="text-sm text-charcoal-light">Empty</p> : <ul className="text-sm space-y-1">{queue.map(q => <li key={q.status} className="flex justify-between"><span className="capitalize">{q.status}</span><span className="text-charcoal-muted">{q.count}</span></li>)}</ul>}<p className="text-xs text-charcoal-muted mt-3">Drained every 20 min by a scheduled job on GitHub (max 90/day on Resend's free tier).</p></div>
        <div className="bg-white border border-taupe/30 rounded-sm p-4"><p className="text-xs uppercase tracking-wide text-charcoal-muted mb-2">Scheduled jobs</p><ul className="text-sm space-y-1 text-charcoal-light"><li>Publish scheduled posts — every 5 min</li><li>Abandoned-cart emails — hourly</li><li>Weekly digest — Fridays 08:00 UTC</li><li>Backup snapshot — daily 02:00 UTC</li><li>Keep-alive — every 6 h (a scheduled job on GitHub)</li></ul></div>
      </div>
      <div className="bg-white rounded-sm border border-taupe/30 divide-y divide-taupe/20">
        {snaps.map(s => <div key={s.id} className="p-4 flex items-center gap-4"><div className="flex-1 min-w-0"><p className="text-sm text-charcoal">{new Date(s.taken_at).toLocaleString()}</p><p className="text-xs text-charcoal-muted truncate">{counts(s)}</p></div><button onClick={() => download(s)} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-taupe/50 text-xs rounded-sm hover:border-bronze"><Download size={12} /> JSON</button></div>)}
        {snaps.length === 0 && <p className="p-8 text-center text-sm text-charcoal-muted">No snapshots yet — the first one runs tonight, or click “Snapshot now”.</p>}
      </div>
    </div>
  );
}
