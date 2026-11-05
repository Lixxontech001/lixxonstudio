import { useEffect, useState, type FormEvent } from 'react';
import { MarkdownField } from '../components/AdminEditorKit';
import { BookA, Plus, Trash2, Pencil, Loader2, Search, ExternalLink, Sparkles, Volume2, Shield } from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';
import type { GlossaryTerm } from '../../lib/types';
import ExportButton from '../components/ExportButton';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const CATEGORIES = [
  'All',
  'Clinical Actives',
  'Peptides',
  'Exfoliating Acids',
  'Botanicals',
  'Lipids & Ceramides',
  'Antioxidants',
  'Ingredients',
];

export default function AdminGlossary() {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [selectedCat, setSelectedCat] = useState('All');
  const [editing, setEditing] = useState<Partial<GlossaryTerm> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const { data } = await supabase.from('glossary_terms').select('*').order('term');
    setTerms(rows(data));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing?.term?.trim() || !editing.definition?.trim()) return;
    setSaving(true);
    setError('');

    const payload = {
      term: editing.term.trim(),
      slug: slugify(editing.term),
      definition: editing.definition.trim(),
      category: editing.category?.trim() || null,
      pronunciation: editing.pronunciation?.trim() || null,
      skin_suitability: editing.skin_suitability?.trim() || null,
      synergies: editing.synergies?.trim() || null,
      related_article_slug: editing.related_article_slug?.trim() || null,
    };

    const { error: err } = editing.id
      ? await supabase.from('glossary_terms').update(payload).eq('id', editing.id)
      : await supabase.from('glossary_terms').insert(payload);

    setSaving(false);
    if (err) {
      setError(err.message.includes('duplicate') ? 'A term with that name already exists.' : err.message);
      return;
    }
    setEditing(null);
    load();
  };

  const remove = async (t: GlossaryTerm) => {
    if (!confirm(`Delete “${t.term}”?`)) return;
    await supabase.from('glossary_terms').delete().eq('id', t.id);
    load();
  };

  const list = terms.filter(t => {
    const matchCat = selectedCat === 'All' || (t.category && t.category.toLowerCase() === selectedCat.toLowerCase());
    const matchQ = !q || `${t.term} ${t.definition} ${t.category || ''} ${t.skin_suitability || ''}`.toLowerCase().includes(q.toLowerCase());
    return matchCat && matchQ;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-charcoal dark:text-white flex items-center gap-2">
            <BookA size={20} className="text-bronze" /> Advanced Glossary Studio
          </h1>
          <p className="text-sm text-charcoal-muted dark:text-gray-400 mt-1">
            {terms.length} curated terms · Powers hover definitions inside articles and the public glossary library.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/glossary"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-taupe/50 dark:border-white/20 text-charcoal dark:text-white text-xs uppercase tracking-editorial rounded-sm hover:border-bronze hover:text-bronze transition-colors"
          >
            <ExternalLink size={13} /> View Public Glossary
          </a>
          <ExportButton
            filename="glossary"
            load={async () => terms as unknown as Record<string, unknown>[]}
            columns={['term', 'category', 'definition']}
          />
          <button
            onClick={() => setEditing({ term: '', definition: '', category: 'Clinical Actives', pronunciation: '', skin_suitability: '', synergies: '' })}
            className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal dark:bg-bronze text-white text-xs uppercase tracking-editorial rounded-sm hover:bg-bronze transition-colors shadow-xs"
          >
            <Plus size={14} /> New term
          </button>
        </div>
      </div>

      {/* Editor Modal / Form */}
      {editing && (
        <form onSubmit={save} className="bg-white dark:bg-[#161616] rounded-sm p-6 border border-taupe/30 dark:border-white/10 shadow-sm grid gap-4 animate-fade-in">
          <div className="flex items-center justify-between border-b border-taupe/20 dark:border-white/10 pb-2">
            <h2 className="font-serif text-base text-charcoal dark:text-white font-medium">
              {editing.id ? `Edit: ${editing.term}` : 'Add New Chemical or Skincare Term'}
            </h2>
            <span className="text-[10px] tracking-editorial uppercase text-bronze font-medium">
              Editorial Scientific Precision
            </span>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <label className="text-xs text-charcoal-muted dark:text-gray-400 uppercase tracking-wide">
              Term Name *
              <input
                required
                value={editing.term || ''}
                onChange={e => setEditing(x => ({ ...x, term: e.target.value }))}
                placeholder="e.g. Hyaluronic Acid"
                className="w-full mt-1 border border-taupe/50 dark:border-white/15 dark:bg-[#202020] dark:text-white px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case"
              />
            </label>
            <label className="text-xs text-charcoal-muted dark:text-gray-400 uppercase tracking-wide">
              Category
              <input
                value={editing.category || ''}
                onChange={e => setEditing(x => ({ ...x, category: e.target.value }))}
                placeholder="e.g. Clinical Actives"
                className="w-full mt-1 border border-taupe/50 dark:border-white/15 dark:bg-[#202020] dark:text-white px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case"
              />
            </label>
            <label className="text-xs text-charcoal-muted dark:text-gray-400 uppercase tracking-wide">
              Phonetic Pronunciation
              <input
                value={editing.pronunciation || ''}
                onChange={e => setEditing(x => ({ ...x, pronunciation: e.target.value }))}
                placeholder="e.g. [hahy-uh-loo-ron-ik as-id]"
                className="w-full mt-1 border border-taupe/50 dark:border-white/15 dark:bg-[#202020] dark:text-white px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case"
              />
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-xs text-charcoal-muted dark:text-gray-400 uppercase tracking-wide">
              Skin Suitability &amp; Concerns
              <input
                value={editing.skin_suitability || ''}
                onChange={e => setEditing(x => ({ ...x, skin_suitability: e.target.value }))}
                placeholder="e.g. Dry, Dehydrated, Sensitive, Barrier Recovery"
                className="w-full mt-1 border border-taupe/50 dark:border-white/15 dark:bg-[#202020] dark:text-white px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case"
              />
            </label>
            <label className="text-xs text-charcoal-muted dark:text-gray-400 uppercase tracking-wide">
              Formulation Synergies &amp; Pairings
              <input
                value={editing.synergies || ''}
                onChange={e => setEditing(x => ({ ...x, synergies: e.target.value }))}
                placeholder="e.g. Pairs best with Ceramides &amp; Squalane; avoid high-proof alcohol"
                className="w-full mt-1 border border-taupe/50 dark:border-white/15 dark:bg-[#202020] dark:text-white px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze normal-case"
              />
            </label>
          </div>

          <div className="normal-case">
            <MarkdownField
              label={`Definition (${(editing.definition || '').length}/600)`}
              value={editing.definition || ''}
              onChange={v => setEditing(x => ({ ...x, definition: v.slice(0, 600) }))}
              rows={3}
              max={600}
              hint="Keep it under 600 characters — glossary entries are also used for hover previews, search and SEO."
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button
              disabled={saving}
              className="px-4 py-2 bg-bronze text-white text-xs uppercase tracking-editorial rounded-sm disabled:opacity-60 flex items-center gap-2"
            >
              {saving && <Loader2 size={13} className="animate-spin" />} Save Term
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="px-4 py-2 text-xs uppercase tracking-editorial text-charcoal-muted dark:text-gray-400 hover:text-charcoal dark:hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Filter and Category Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setSelectedCat(c)}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors whitespace-nowrap ${
                selectedCat === c
                  ? 'bg-charcoal text-white dark:bg-bronze'
                  : 'bg-white dark:bg-[#1A1A1A] text-charcoal-muted dark:text-gray-300 border border-taupe/30 dark:border-white/10 hover:border-bronze'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="relative max-w-xs w-full">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-muted" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search terms, suitability…"
            className="w-full bg-white dark:bg-[#161616] border border-taupe/50 dark:border-white/10 pl-9 pr-4 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze dark:text-white shadow-xs"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(n => (
            <div key={n} className="bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-[#161616] rounded-sm border border-taupe/30 dark:border-white/10 divide-y divide-taupe/20 dark:divide-white/5 shadow-xs">
          {list.map(t => (
            <div key={t.id} className="p-4 flex gap-4 items-start hover:bg-taupe-light/10 dark:hover:bg-white/5 transition-colors">
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-serif text-base font-medium text-charcoal dark:text-white">{t.term}</p>
                  {t.pronunciation && (
                    <span className="text-[11px] font-mono text-bronze dark:text-bronze-light flex items-center gap-1">
                      <Volume2 size={11} /> {t.pronunciation}
                    </span>
                  )}
                  {t.category && (
                    <span className="text-[10px] uppercase tracking-editorial px-2 py-0.5 bg-taupe-light/60 dark:bg-white/10 text-charcoal-muted dark:text-gray-300 rounded">
                      {t.category}
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-charcoal-light dark:text-gray-300 leading-relaxed">
                  {t.definition}
                </p>
                {(t.skin_suitability || t.synergies) && (
                  <div className="flex flex-wrap gap-3 pt-1 text-[11px]">
                    {t.skin_suitability && (
                      <span className="text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                        <Shield size={11} /> Best for: {t.skin_suitability}
                      </span>
                    )}
                    {t.synergies && (
                      <span className="text-amber-800 dark:text-amber-300 flex items-center gap-1">
                        <Sparkles size={11} /> {t.synergies}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setEditing(t)} className="p-2 text-charcoal-muted hover:text-bronze dark:text-gray-400 dark:hover:text-bronze-light" aria-label="Edit">
                  <Pencil size={14} />
                </button>
                <button onClick={() => remove(t)} className="p-2 text-charcoal-muted hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400" aria-label="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {list.length === 0 && <p className="p-8 text-center text-sm text-charcoal-muted dark:text-gray-400">No terms match your search or filter.</p>}
        </div>
      )}
    </div>
  );
}
