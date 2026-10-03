import { useEffect, useState, type FormEvent } from 'react';
import { Layers, Plus, Trash2, Pencil, Loader2, GripVertical, X } from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';
import type { ArticleSeries } from '../../lib/types';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
type Part = { id: string; title: string; series_order: number | null; status: string };

export default function AdminSeries() {
  const [series, setSeries] = useState<ArticleSeries[]>([]);
  const [parts, setParts] = useState<Record<string, Part[]>>({});
  const [editing, setEditing] = useState<Partial<ArticleSeries> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Part[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('article_series').select('*').order('created_at', { ascending: false });
    setSeries(rows(data));
    const { data: p } = await supabase.from('posts').select('id, title, series_id, series_order, status').not('series_id', 'is', null).order('series_order');
    const map: Record<string, Part[]> = {};
    rows<Part & { series_id: string }>(p).forEach(x => { (map[x.series_id] ||= []).push(x); });
    setParts(map);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const t = setTimeout(async () => { const { data } = await supabase.from('posts').select('id, title, series_order, status').ilike('title', `%${search.trim()}%`).is('series_id', null).limit(8); setResults(rows(data)); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing?.title?.trim()) return;
    setSaving(true);
    const payload = { title: editing.title.trim(), slug: editing.slug?.trim() || slugify(editing.title), description: editing.description || null, cover_image: editing.cover_image || null, is_active: editing.is_active ?? true };
    if (editing.id) await supabase.from('article_series').update(payload).eq('id', editing.id); else await supabase.from('article_series').insert(payload);
    setSaving(false); setEditing(null); load();
  };
  const addPart = async (seriesId: string, postId: string) => { const n = (parts[seriesId]?.length || 0) + 1; await supabase.from('posts').update({ series_id: seriesId, series_order: n }).eq('id', postId); setSearch(''); load(); };
  const removePart = async (postId: string) => { await supabase.from('posts').update({ series_id: null, series_order: null }).eq('id', postId); load(); };
  const move = async (seriesId: string, idx: number, dir: -1 | 1) => {
    const list = [...(parts[seriesId] || [])]; const j = idx + dir; if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    await Promise.all(list.map((p, i) => supabase.from('posts').update({ series_order: i + 1 }).eq('id', p.id)));
    load();
  };
  const remove = async (s: ArticleSeries) => { if (!confirm(`Delete series “${s.title}”? Articles stay published.`)) return; await supabase.from('article_series').delete().eq('id', s.id); load(); };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><Layers size={20} className="text-bronze" /> Series</h1><p className="text-sm text-charcoal-muted mt-1">Group multi-part guides; readers get part navigation and a /series page.</p></div>
        <button onClick={() => setEditing({ title: '', description: '', is_active: true })} className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze"><Plus size={14} /> New series</button>
      </div>
      {editing && (
        <form onSubmit={save} className="bg-white rounded-sm p-6 border border-taupe/30 mb-6 grid gap-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Title<input required value={editing.title || ''} onChange={e => setEditing(x => ({ ...x, title: e.target.value }))} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case" /></label>
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Slug<input value={editing.slug || ''} onChange={e => setEditing(x => ({ ...x, slug: e.target.value }))} placeholder={slugify(editing.title || '') || 'auto'} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case" /></label>
          </div>
          <label className="text-xs text-charcoal-muted uppercase tracking-wide">Description<textarea rows={2} value={editing.description || ''} onChange={e => setEditing(x => ({ ...x, description: e.target.value }))} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case" /></label>
          <label className="text-xs text-charcoal-muted uppercase tracking-wide">Cover image URL<input value={editing.cover_image || ''} onChange={e => setEditing(x => ({ ...x, cover_image: e.target.value }))} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.is_active ?? true} onChange={e => setEditing(x => ({ ...x, is_active: e.target.checked }))} /> Visible to readers</label>
          <div className="flex gap-2"><button disabled={saving} className="px-4 py-2 bg-bronze text-white text-sm rounded-sm disabled:opacity-60">{saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}</button><button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-charcoal-muted">Cancel</button></div>
        </form>
      )}
      <div className="space-y-4">
        {series.map(s => (
          <div key={s.id} className="bg-white rounded-sm border border-taupe/30">
            <div className="p-4 flex items-center gap-3">
              <button onClick={() => setOpen(open === s.id ? null : s.id)} className="flex-1 text-left"><p className="font-medium text-charcoal">{s.title} <span className="text-xs text-charcoal-muted ml-2">/{s.slug} · {(parts[s.id] || []).length} parts{!s.is_active && ' · hidden'}</span></p></button>
              <button onClick={() => setEditing(s)} className="p-2 text-charcoal-muted hover:text-bronze" aria-label="Edit"><Pencil size={14} /></button>
              <button onClick={() => remove(s)} className="p-2 text-charcoal-muted hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
            </div>
            {open === s.id && (
              <div className="border-t border-taupe/20 p-4">
                <ol className="space-y-2 mb-4">
                  {(parts[s.id] || []).map((p, i) => (
                    <li key={p.id} className="flex items-center gap-2 text-sm">
                      <GripVertical size={14} className="text-charcoal-muted" /><span className="w-6 text-charcoal-muted">{i + 1}.</span><span className="flex-1">{p.title} {p.status !== 'published' && <span className="text-xs text-amber-600">({p.status})</span>}</span>
                      <button onClick={() => move(s.id, i, -1)} className="px-2 text-charcoal-muted hover:text-bronze" aria-label="Move up">↑</button><button onClick={() => move(s.id, i, 1)} className="px-2 text-charcoal-muted hover:text-bronze" aria-label="Move down">↓</button>
                      <button onClick={() => removePart(p.id)} className="p-1 text-charcoal-muted hover:text-red-600" aria-label="Remove from series"><X size={14} /></button>
                    </li>
                  ))}
                </ol>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Add an article by title…" className="w-full border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
                {results.length > 0 && <ul className="mt-2 border border-taupe/30 rounded-sm divide-y divide-taupe/20">{results.map(r => <li key={r.id}><button onClick={() => addPart(s.id, r.id)} className="w-full text-left px-3 py-2 text-sm hover:bg-taupe-light/50">{r.title}</button></li>)}</ul>}
              </div>
            )}
          </div>
        ))}
        {series.length === 0 && <p className="p-8 text-center text-sm text-charcoal-muted bg-white rounded-sm border border-taupe/30">No series yet.</p>}
      </div>
    </div>
  );
}
