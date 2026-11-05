import { useState, useEffect, useMemo } from 'react';
import { MarkdownField } from '../components/AdminEditorKit';
import { ArrowLeft, Save, Plus, X, ExternalLink, Loader2, Check, Search, FileText, Sparkles } from 'lucide-react';
import { useNavigation } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabaseClient';
import type { Post } from '../../lib/types';
import AdminImageUploadField from '../components/AdminImageUploadField';

interface CollectionForm {
  title: string;
  slug: string;
  description: string;
  cover_image: string;
  is_featured: boolean;
  is_active: boolean;
  sort_order: number;
}

interface AttachedArticle {
  id: string;
  title: string;
  slug?: string;
  sort_order: number;
}

function computeArticleRelevance(postTitle: string, postSlug: string | undefined, targetTitle: string, targetDesc?: string) {
  const stopWords = new Set(['the', 'and', 'a', 'to', 'of', 'in', 'for', 'with', 'on', 'at', 'from', 'by', 'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under', 'around', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'how', 'what', 'why', 'when', 'where', 'guide', 'part', 'collection', 'edit']);
  const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  const targetTokens = new Set([...tokenize(targetTitle), ...tokenize(targetDesc || '')]);
  const postTokens = tokenize(postTitle + ' ' + (postSlug || ''));
  const matchedWords: string[] = [];
  let score = 0;
  for (const t of postTokens) {
    if (targetTokens.has(t) && !matchedWords.includes(t)) {
      matchedWords.push(t);
      score += 28;
    }
  }
  return { score: Math.min(99, Math.max(15, score)), matchedWords };
}

export default function AdminCollectionEditor({ collectionId, isNew }: { collectionId?: string; isNew?: boolean }) {
  const { navigate } = useNavigation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [form, setForm] = useState<CollectionForm>({
    title: '',
    slug: '',
    description: '',
    cover_image: '',
    is_featured: false,
    is_active: true,
    sort_order: 0,
  });

  const [articleSearch, setArticleSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [allAvailableArticles, setAllAvailableArticles] = useState<Post[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [selectedArticles, setSelectedArticles] = useState<AttachedArticle[]>([]);

  const loadArticles = async (searchQuery = '', status = 'all') => {
    setLoadingArticles(true);
    try {
      let query = supabase
        .from('posts')
        .select('id, title, slug, status, excerpt, published_at')
        .order('published_at', { ascending: false })
        .limit(200);

      if (status !== 'all') {
        query = query.eq('status', status);
      }

      if (searchQuery.trim()) {
        query = query.ilike('title', `%${searchQuery.trim()}%`);
      }

      const { data, error } = await query;
      if (!error && data) {
        setAllAvailableArticles(data as Post[]);
      }
    } catch {
      // ignore
    } finally {
      setLoadingArticles(false);
    }
  };

  // Load existing collection details and items
  useEffect(() => {
    if (!isNew && collectionId) {
      supabase
        .from('collections')
        .select('*')
        .eq('id', collectionId)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setForm({
              title: data.title,
              slug: data.slug,
              description: data.description || '',
              cover_image: data.cover_image || '',
              is_featured: data.is_featured,
              is_active: data.is_active,
              sort_order: data.sort_order || 0,
            });
          }
        });

      supabase
        .from('collection_items')
        .select('post_id, sort_order, post:posts(id, title, slug)')
        .eq('collection_id', collectionId)
        .order('sort_order')
        .then(({ data }) => {
          if (data) {
            setSelectedArticles(
              (data as unknown as { post_id: string; sort_order: number; post: { id: string; title: string; slug?: string } | null }[])
                .map(d => ({
                  id: d.post_id,
                  title: d.post?.title || 'Untitled',
                  slug: d.post?.slug,
                  sort_order: d.sort_order,
                }))
            );
          }
        });
    }

    loadArticles('', 'all');
  }, [collectionId, isNew]);

  const addArticle = (post: Post) => {
    if (selectedArticles.find(a => a.id === post.id)) return;
    setSelectedArticles(prev => [
      ...prev,
      { id: post.id, title: post.title, slug: post.slug, sort_order: prev.length },
    ]);
  };

  const removeArticle = (id: string) => {
    setSelectedArticles(prev => prev.filter(a => a.id !== id).map((a, i) => ({ ...a, sort_order: i })));
  };

  const moveArticle = (idx: number, dir: -1 | 1) => {
    const list = [...selectedArticles];
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    setSelectedArticles(list.map((a, i) => ({ ...a, sort_order: i })));
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setError('Please provide a collection title');
      return;
    }
    setSaving(true);
    setError('');
    const slug = form.slug?.trim() || form.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    try {
      let id = collectionId;
      if (isNew) {
        const { data, error: e } = await supabase.from('collections').insert({ ...form, slug }).select().single();
        if (e) throw e;
        id = data.id;
      } else {
        const { error: e } = await supabase
          .from('collections')
          .update({ ...form, slug, updated_at: new Date().toISOString() })
          .eq('id', collectionId);
        if (e) throw e;
      }

      if (id) {
        await supabase.from('collection_items').delete().eq('collection_id', id);
        if (selectedArticles.length > 0) {
          await supabase.from('collection_items').insert(
            selectedArticles.map((a, i) => ({
              collection_id: id,
              post_id: a.id,
              sort_order: i,
            }))
          );
        }
      }

      setSavedSuccess(true);
      setTimeout(() => {
        navigate({ name: 'admin-collections' });
      }, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save collection');
    } finally {
      setSaving(false);
    }
  };

  // Filter available articles based on search
  const filteredAvailableArticles = useMemo(() => {
    const selectedIds = new Set(selectedArticles.map(a => a.id));
    return allAvailableArticles
      .filter(p => !selectedIds.has(p.id))
      .filter(p => {
        if (!articleSearch.trim()) return true;
        const q = articleSearch.toLowerCase();
        return p.title.toLowerCase().includes(q) || (p.slug && p.slug.toLowerCase().includes(q));
      });
  }, [allAvailableArticles, selectedArticles, articleSearch]);

  const inputClass =
    'w-full bg-white border border-taupe/60 px-3 py-2.5 text-sm text-charcoal rounded-sm focus:outline-none focus:border-bronze transition-colors';
  const labelClass = 'block text-[11px] font-medium tracking-editorial uppercase text-charcoal-muted mb-1.5';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate({ name: 'admin-collections' })}
          className="inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors"
        >
          <ArrowLeft size={14} /> Back to Collections
        </button>
        {form.slug && !isNew && (
          <a
            href={`/collections/${form.slug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-bronze hover:underline"
          >
            <ExternalLink size={13} /> View on Public Site
          </a>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-taupe/30 pb-4">
        <div>
          <h1 className="font-serif text-3xl text-charcoal font-light">
            {isNew ? 'New Curated Collection' : 'Edit Collection'}
          </h1>
          <p className="text-sm text-charcoal-muted mt-1">
            Thematic collections gather curated articles into a branded reader journey.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-60 shadow-sm"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : savedSuccess ? <Check size={15} /> : <Save size={15} />}
          {saving ? 'Saving…' : savedSuccess ? 'Saved!' : 'Save Collection'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Left Column: Collection Metadata */}
        <div className="space-y-5 bg-white p-6 rounded-md border border-taupe/40 shadow-sm">
          <div>
            <label className={labelClass}>Collection Title *</label>
            <input
              required
              className={inputClass}
              value={form.title}
              onChange={e => {
                const t = e.target.value;
                setForm(p => ({
                  ...p,
                  title: t,
                  slug: isNew ? t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : p.slug,
                }));
              }}
              placeholder="e.g. The Barrier Repair Edit"
            />
          </div>

          <div>
            <label className={labelClass}>URL Slug (/collections/:slug)</label>
            <input
              className={`${inputClass} font-mono`}
              value={form.slug}
              onChange={e => setForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
              placeholder="barrier-repair-edit"
            />
          </div>

          <div>
            <MarkdownField
              label="Editorial Introduction & Description"
              value={form.description}
              onChange={v => setForm(p => ({ ...p, description: v }))}
              rows={4}
              max={1200}
              hint="Describe the focus of this curated collection for readers and search engines."
            />
          </div>

          <AdminImageUploadField
            label="Collection Cover Image"
            value={form.cover_image}
            onChange={url => setForm(p => ({ ...p, cover_image: url }))}
            folder="collections"
            hint="A distinctive cover image displayed on the collection card and page header."
          />

          <div>
            <label className={labelClass}>Sort Priority (Higher values appear first)</label>
            <input
              type="number"
              className={inputClass}
              value={form.sort_order}
              onChange={e => setForm(p => ({ ...p, sort_order: parseInt(e.target.value) || 0 }))}
            />
          </div>

          <div className="pt-2 border-t border-taupe/20 space-y-2.5">
            <label className="flex items-center gap-3 text-sm text-charcoal cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_featured}
                onChange={e => setForm(p => ({ ...p, is_featured: e.target.checked }))}
                className="accent-bronze w-4 h-4"
              />
              <span>Featured Collection (highlighted on homepage &amp; shop)</span>
            </label>
            <label className="flex items-center gap-3 text-sm text-charcoal cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                className="accent-bronze w-4 h-4"
              />
              <span>Active (visible to visitors)</span>
            </label>
          </div>
        </div>

        {/* Right Column: Attached Articles Management */}
        <div className="space-y-5 bg-white p-6 rounded-md border border-taupe/40 shadow-sm flex flex-col">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className={labelClass}>Articles in This Collection ({selectedArticles.length})</h2>
              {selectedArticles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedArticles([])}
                  className="text-[11px] text-red-600 hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
            <p className="text-xs text-charcoal-muted mb-4">
              Curate the exact reading journey. Use the arrows to reorder articles.
            </p>

            {/* List of currently selected articles */}
            <div className="space-y-2 mb-6 max-h-72 overflow-y-auto">
              {selectedArticles.length === 0 ? (
                <div className="p-6 border border-dashed border-taupe/50 rounded text-center">
                  <FileText size={20} className="text-charcoal-muted mx-auto mb-2" />
                  <p className="text-xs text-charcoal-muted italic">
                    No articles attached yet. Pick from the available articles below.
                  </p>
                </div>
              ) : (
                selectedArticles.map((a, i) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 bg-taupe-light/30 border border-taupe/30 rounded-sm px-3.5 py-2.5 group"
                  >
                    <span className="text-xs font-mono font-bold text-bronze w-6">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-sm text-charcoal flex-1 truncate font-medium">{a.title}</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => moveArticle(i, -1)}
                        className="p-1 text-charcoal-muted hover:text-bronze disabled:opacity-20"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={i === selectedArticles.length - 1}
                        onClick={() => moveArticle(i, 1)}
                        className="p-1 text-charcoal-muted hover:text-bronze disabled:opacity-20"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeArticle(a.id)}
                        className="p-1 text-charcoal-muted hover:text-red-600 ml-1"
                        title="Remove from collection"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Article Picker Search & Instant Browser */}
          <div className="pt-4 border-t border-taupe/30 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <label className={labelClass}>Add Articles to Collection</label>
              {filteredAvailableArticles.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    filteredAvailableArticles.forEach(p => addArticle(p));
                  }}
                  className="text-[11px] text-bronze hover:underline font-medium"
                >
                  + Add All Filtered ({filteredAvailableArticles.length})
                </button>
              )}
            </div>
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-3 text-charcoal-muted" />
                <input
                  type="text"
                  value={articleSearch}
                  onChange={e => {
                    const val = e.target.value;
                    setArticleSearch(val);
                    loadArticles(val, statusFilter);
                  }}
                  placeholder="Search articles by title or keyword…"
                  className={`${inputClass} pl-9`}
                />
                {articleSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setArticleSearch('');
                      loadArticles('', statusFilter);
                    }}
                    className="absolute right-3 top-3 text-charcoal-muted hover:text-charcoal"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <select
                value={statusFilter}
                onChange={e => {
                  const s = e.target.value as 'all' | 'published' | 'draft';
                  setStatusFilter(s);
                  loadArticles(articleSearch, s);
                }}
                className="bg-white border border-taupe/60 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze"
              >
                <option value="all">All Statuses</option>
                <option value="published">Published</option>
                <option value="draft">Drafts</option>
              </select>
            </div>

            {/* Smart Suggested Articles for this Collection */}
            {(() => {
              const suggestions = filteredAvailableArticles
                .map(p => {
                  const rel = computeArticleRelevance(p.title, p.slug, form.title, form.description || '');
                  return { ...p, score: rel.score, matchedWords: rel.matchedWords };
                })
                .filter(p => p.matchedWords.length > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 3);

              if (suggestions.length === 0 || articleSearch.trim()) return null;

              return (
                <div className="bg-amber-50/70 border border-amber-200/80 rounded p-3 mb-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                    <Sparkles size={14} className="text-bronze" />
                    <span>Suggested Articles for “{form.title || 'Collection'}”</span>
                    <span className="text-[10px] text-amber-700/80 font-normal ml-auto">
                      Based on theme &amp; keyword affinity
                    </span>
                  </div>
                  <div className="divide-y divide-amber-200/50">
                    {suggestions.map(p => (
                      <div key={`col-rec-${p.id}`} className="py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium text-charcoal truncate">{p.title}</p>
                            <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-bronze/10 text-bronze font-bold">
                              {p.score}% match
                            </span>
                          </div>
                          <p className="text-[10px] text-charcoal-muted mt-0.5">
                            Matched keywords: {p.matchedWords.join(', ')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addArticle(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-bronze text-white hover:bg-bronze-dark text-[11px] rounded transition-colors whitespace-nowrap font-medium shadow-xs"
                        >
                          <Plus size={11} /> Add to Collection
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Scrollable list of available published articles */}
            <div className="border border-taupe/30 rounded max-h-60 overflow-y-auto divide-y divide-taupe/15 flex-1">
              {loadingArticles ? (
                <div className="py-6 text-center text-xs text-charcoal-muted flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin text-bronze" /> Loading articles…
                </div>
              ) : filteredAvailableArticles.length === 0 ? (
                <div className="py-6 text-center text-xs text-charcoal-muted">
                  {allAvailableArticles.length === 0
                    ? 'No articles found matching query.'
                    : 'All matching articles are already added to this collection.'}
                </div>
              ) : (
                filteredAvailableArticles.map(p => (
                  <div
                    key={p.id}
                    className="p-2.5 flex items-center justify-between gap-3 hover:bg-taupe-light/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-charcoal font-medium truncate">{p.title}</p>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${p.status === 'published' ? 'text-green-700 bg-green-50' : 'text-amber-700 bg-amber-50'}`}>
                        {p.status}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => addArticle(p)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-taupe hover:border-bronze hover:text-bronze text-charcoal text-xs rounded transition-colors whitespace-nowrap"
                    >
                      <Plus size={12} className="text-bronze" /> Add
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 pt-6 border-t border-taupe/30">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-8 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-60 shadow-sm"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : savedSuccess ? <Check size={16} /> : <Save size={16} />}
          {saving ? 'Saving Collection…' : savedSuccess ? 'Saved!' : 'Save Collection'}
        </button>
        <button
          onClick={() => navigate({ name: 'admin-collections' })}
          className="text-xs text-charcoal-muted hover:text-charcoal tracking-editorial uppercase ml-auto"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
