import { useEffect, useState, type FormEvent } from 'react';
import { BookA, Plus, Trash2, Pencil, Loader2, Search } from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';
import type { GlossaryTerm } from '../../lib/types';
import ExportButton from '../components/ExportButton';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export default function AdminGlossary() {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<GlossaryTerm> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => { const { data } = await supabase.from('glossary_terms').select('*').order('term'); setTerms(rows(data)); setLoading(false); };
  useEffect(() => { load(); }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing?.term?.trim() || !editing.definition?.trim()) return;
    setSaving(true); setError('');
    const payload = { term: editing.term.trim(), slug: slugify(editing.term), definition: editing.definition.trim(), category: editing.category?.trim() || null };
    const { error: err } = editing.id ? await supabase.from('glossary_terms').update(payload).eq('id', editing.id) : await supabase.from('glossary_terms').insert(payload);
    setSaving(false);
    if (err) { setError(err.message.includes('duplicate') ? 'A term with that name already exists.' : err.message); return; }
    setEditing(null); load();
  };
  const remove = async (t: GlossaryTerm) => { if (!confirm(`Delete “${t.term}”?`)) return; await supabase.from('glossary_terms').delete().eq('id', t.id); load(); };
  const list = terms.filter(t => !q || `${t.term} ${t.definition} ${t.category || ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div><h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><BookA size={20} className="text-bronze" /> Glossary</h1><p className="text-sm text-charcoal-muted mt-1">{terms.length} terms · powers hover definitions inside articles and the public /glossary page.</p></div>
        <div className="flex gap-2">
          <ExportButton filename="glossary" load={async () => terms as unknown as Record<string, unknown>[]} columns={['term', 'category', 'definition']} />
          <button onClick={() => setEditing({ term: '', definition: '', category: '' })} className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze"><Plus size={14} /> New term</button>
        </div>
      </div>
      {editing && (
        <form onSubmit={save} className="bg-white rounded-sm p-6 border border-taupe/30 mb-6 grid gap-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Term<input required value={editing.term || ''} onChange={e => setEditing(x => ({ ...x, term: e.target.value }))} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case" /></label>
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Category<input value={editing.category || ''} onChange={e => setEditing(x => ({ ...x, category: e.target.value }))} placeholder="e.g. Ingredients" className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case" /></label>
          </div>
          <label className="text-xs text-charcoal-muted uppercase tracking-wide">Definition <span className="normal-case">({(editing.definition || '').length}/600)</span><textarea required maxLength={600} rows={3} value={editing.definition || ''} onChange={e => setEditing(x => ({ ...x, definition: e.target.value }))} className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case" /></label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2"><button disabled={saving} className="px-4 py-2 bg-bronze text-white text-sm rounded-sm disabled:opacity-60">{saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}</button><button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-charcoal-muted">Cancel</button></div>
        </form>
      )}
      <div className="relative max-w-xs mb-4"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="w-full bg-white border border-taupe/50 pl-9 pr-4 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" /></div>
      {loading ? <div className="skeleton h-40 rounded-sm" /> : (
        <div className="bg-white rounded-sm border border-taupe/30 divide-y divide-taupe/20">
          {list.map(t => (
            <div key={t.id} className="p-4 flex gap-4 items-start">
              <div className="flex-1 min-w-0"><p className="font-medium text-charcoal">{t.term} {t.category && <span className="ml-2 text-[10px] uppercase tracking-wide text-charcoal-muted">{t.category}</span>}</p><p className="text-sm text-charcoal-light mt-1">{t.definition}</p></div>
              <button onClick={() => setEditing(t)} className="p-2 text-charcoal-muted hover:text-bronze" aria-label="Edit"><Pencil size={14} /></button>
              <button onClick={() => remove(t)} className="p-2 text-charcoal-muted hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
            </div>
          ))}
          {list.length === 0 && <p className="p-8 text-center text-sm text-charcoal-muted">No terms yet.</p>}
        </div>
      )}
    </div>
  );
}
