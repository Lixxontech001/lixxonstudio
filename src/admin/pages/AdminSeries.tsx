import { useEffect, useState, useMemo, type FormEvent } from 'react';
import {
  Layers, Plus, Trash2, Pencil, Loader2, X,
  ExternalLink, Search, Check, ChevronDown, ChevronUp, FileText, BookOpen, Sparkles
} from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';
import type { ArticleSeries } from '../../lib/types';
import { MarkdownField } from '../components/AdminEditorKit';
import AdminImageUploadField from '../components/AdminImageUploadField';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

interface Part {
  id: string;
  title: string;
  slug?: string;
  series_order: number | null;
  status: string;
  published_at?: string;
}

interface AvailablePost {
  id: string;
  title: string;
  slug?: string;
  series_id: string | null;
  series_order: number | null;
  status: string;
  created_at?: string;
}

function computeArticleRelevance(postTitle: string, postSlug: string | undefined, targetTitle: string, targetDesc?: string) {
  const stopWords = new Set(['the', 'and', 'a', 'to', 'of', 'in', 'for', 'with', 'on', 'at', 'from', 'by', 'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under', 'around', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'how', 'what', 'why', 'when', 'where', 'guide', 'part', 'series']);
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

export default function AdminSeries() {
  const [series, setSeries] = useState<ArticleSeries[]>([]);
  const [parts, setParts] = useState<Record<string, Part[]>>({});
  const [allPosts, setAllPosts] = useState<AvailablePost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [editing, setEditing] = useState<Partial<ArticleSeries> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft' | 'unassigned'>('all');
  const [showAddDrawer, setShowAddDrawer] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  const load = async () => {
    const { data } = await supabase.from('article_series').select('*').order('created_at', { ascending: false });
    const sList = rows<ArticleSeries>(data);
    setSeries(sList);
    if (!open && sList.length > 0) {
      setOpen(sList[0].id);
    }

    const { data: p } = await supabase
      .from('posts')
      .select('id, title, slug, series_id, series_order, status, published_at')
      .not('series_id', 'is', null)
      .order('series_order', { ascending: true });

    const map: Record<string, Part[]> = {};
    rows<Part & { series_id: string }>(p).forEach(x => {
      (map[x.series_id] ||= []).push(x);
    });
    setParts(map);
  };

  const loadAllPosts = async (query = '') => {
    setLoadingPosts(true);
    try {
      let q = supabase
        .from('posts')
        .select('id, title, slug, series_id, series_order, status, created_at')
        .order('created_at', { ascending: false })
        .limit(300);

      if (query.trim()) {
        q = q.ilike('title', `%${query.trim()}%`);
      }

      const { data, error } = await q;
      if (!error && data) {
        setAllPosts(rows<AvailablePost>(data));
      }
    } catch {
      // ignore
    } finally {
      setLoadingPosts(false);
    }
  };

  useEffect(() => {
    load();
    loadAllPosts();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing?.title?.trim()) return;
    setSaving(true);
    const payload = {
      title: editing.title.trim(),
      slug: editing.slug?.trim() || slugify(editing.title),
      description: editing.description || null,
      cover_image: editing.cover_image || null,
      is_active: editing.is_active ?? true,
    };

    try {
      if (editing.id) {
        const { error } = await supabase.from('article_series').update(payload).eq('id', editing.id);
        if (error) throw error;
        showToast('Series updated successfully');
      } else {
        const { data, error } = await supabase.from('article_series').insert(payload).select().single();
        if (error) throw error;
        showToast('New series created! You can now add guides to it.');
        if (data) {
          setEditing(data as ArticleSeries);
          setOpen(data.id);
          setShowAddDrawer(data.id);
          await load();
          return;
        }
      }
      setEditing(null);
      await load();
    } catch (err) {
      showToast('Error saving series: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const addPart = async (seriesId: string, postId: string) => {
    try {
      const currentList = parts[seriesId] || [];
      const n = currentList.length + 1;
      const { error } = await supabase.from('posts').update({ series_id: seriesId, series_order: n }).eq('id', postId);
      if (error) throw error;
      showToast('Guide added to series');
      await load();
      await loadAllPosts(searchFilter);
    } catch (err) {
      showToast('Error adding guide: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const removePart = async (postId: string) => {
    try {
      const { error } = await supabase.from('posts').update({ series_id: null, series_order: null }).eq('id', postId);
      if (error) throw error;
      showToast('Article removed from series');
      await load();
      await loadAllPosts(searchFilter);
    } catch (err) {
      showToast('Error removing article: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const move = async (seriesId: string, idx: number, dir: -1 | 1) => {
    try {
      const list = [...(parts[seriesId] || [])];
      const j = idx + dir;
      if (j < 0 || j >= list.length) return;
      [list[idx], list[j]] = [list[j], list[idx]];
      setParts(prev => ({ ...prev, [seriesId]: list }));
      for (let i = 0; i < list.length; i++) {
        await supabase.from('posts').update({ series_order: i + 1 }).eq('id', list[i].id);
      }
      showToast('Order updated');
      load();
    } catch (err) {
      showToast('Error reordering: ' + (err instanceof Error ? err.message : String(err)));
    }
  };



  const remove = async (s: ArticleSeries) => {
    if (!confirm(`Delete series “${s.title}”? All articles stay published and are merely unlinked.`)) return;
    await supabase.from('posts').update({ series_id: null, series_order: null }).eq('series_id', s.id);
    await supabase.from('article_series').delete().eq('id', s.id);
    showToast('Series deleted');
    load();
    loadAllPosts(searchFilter);
  };

  // Filter available posts for the current active series
  const activeSeriesId = showAddDrawer || editing?.id || open;
  const filteredAvailablePosts = useMemo(() => {
    return allPosts.filter(p => {
      // Exclude posts already in this active series
      const isAlreadyInThisSeries = activeSeriesId ? (parts[activeSeriesId] || []).some(item => item.id === p.id) : false;
      if (isAlreadyInThisSeries) return false;

      // Status filter
      if (statusFilter === 'published' && p.status !== 'published') return false;
      if (statusFilter === 'draft' && p.status !== 'draft') return false;
      if (statusFilter === 'unassigned' && p.series_id) return false;

      // Search filter
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        return p.title.toLowerCase().includes(q) || (p.slug && p.slug.toLowerCase().includes(q));
      }

      return true;
    });
  }, [allPosts, activeSeriesId, parts, statusFilter, searchFilter]);

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {feedbackMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-charcoal text-white text-xs px-4 py-2.5 rounded-sm shadow-xl flex items-center gap-2 animate-fade-in border border-bronze/40">
          <Check size={14} className="text-bronze" /> {feedbackMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-charcoal flex items-center gap-2">
            <Layers size={24} className="text-bronze" /> Editorial Series
          </h1>
          <p className="text-sm text-charcoal-muted mt-1">
            Curate multi-part comprehensive guides. Readers get linear step navigation, part indexes, and dedicated hub pages.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/series"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-taupe text-charcoal text-xs tracking-editorial uppercase rounded-sm hover:border-bronze transition-colors"
          >
            <ExternalLink size={13} /> View /series
          </a>
          <button
            onClick={() => setEditing({ title: '', slug: '', description: '', cover_image: '', is_active: true })}
            className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze transition-colors"
          >
            <Plus size={14} /> New Series
          </button>
        </div>
      </div>

      {/* Series Editor Form */}
      {editing && (
        <form onSubmit={save} className="bg-white rounded-md p-6 border border-taupe/40 shadow-sm space-y-5 animate-fade-in">
          <div className="flex items-center justify-between border-b border-taupe/20 pb-3">
            <h2 className="font-serif text-lg text-charcoal font-medium">
              {editing.id ? 'Edit Series Information' : 'Create New Editorial Series'}
            </h2>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-charcoal-muted hover:text-charcoal p-1"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] tracking-editorial uppercase text-charcoal-muted mb-1">
                Series Title *
              </label>
              <input
                required
                value={editing.title || ''}
                onChange={e => {
                  const t = e.target.value;
                  setEditing(x => ({ ...x, title: t, slug: x?.slug || slugify(t) }));
                }}
                placeholder="e.g. The Clean Beauty Formulation Blueprint"
                className="w-full border border-taupe/60 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] tracking-editorial uppercase text-charcoal-muted mb-1">
                URL Slug (/series/:slug)
              </label>
              <input
                value={editing.slug || ''}
                onChange={e => setEditing(x => ({ ...x, slug: slugify(e.target.value) }))}
                placeholder="clean-beauty-formulation"
                className="w-full border border-taupe/60 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze font-mono bg-white"
              />
            </div>
          </div>

          <MarkdownField
            label="Series Editorial Synopsis / Description"
            value={editing.description || ''}
            onChange={v => setEditing(x => ({ ...x, description: v }))}
            rows={3}
            max={800}
            hint="Explain what this series teaches, who it is for, and the learning journey readers will take."
          />

          <AdminImageUploadField
            label="Series Cover Image"
            value={editing.cover_image || ''}
            onChange={url => setEditing(x => ({ ...x, cover_image: url }))}
            folder="series"
            hint="Recommended high-resolution landscape image (1600x900 or 1200x800) for series hero cards."
          />

          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer text-charcoal">
              <input
                type="checkbox"
                checked={editing.is_active ?? true}
                onChange={e => setEditing(x => ({ ...x, is_active: e.target.checked }))}
                className="accent-bronze w-4 h-4"
              />
              <span>Visible to readers on the website and feeds</span>
            </label>
          </div>

          {editing.id && (
            <div className="pt-5 border-t border-taupe/30 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-medium tracking-editorial uppercase text-charcoal flex items-center gap-2">
                    <FileText size={14} className="text-bronze" /> Guides in this Series ({(parts[editing.id] || []).length})
                  </h3>
                  <p className="text-xs text-charcoal-muted mt-0.5">
                    Articles will be presented to readers in this sequential reading order.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddDrawer(showAddDrawer === editing.id ? null : (editing.id || null))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bronze text-white text-xs font-medium rounded-sm hover:bg-bronze-dark transition-colors self-start"
                >
                  <Plus size={13} /> {showAddDrawer === editing.id ? 'Close Guide Picker' : 'Add Guides to this Series'}
                </button>
              </div>

              {/* Parts list inside edit form */}
              {(parts[editing.id] || []).length === 0 ? (
                <div className="bg-taupe-light/20 rounded border border-dashed border-taupe/40 p-6 text-center">
                  <p className="text-xs text-charcoal font-medium">No guides attached to this series yet.</p>
                  <p className="text-[11px] text-charcoal-muted mt-1">Click “Add Guides to this Series” above to pick from your published and draft articles.</p>
                </div>
              ) : (
                <div className="bg-white rounded border border-taupe/30 divide-y divide-taupe/20 max-h-64 overflow-y-auto">
                  {(parts[editing.id] || []).map((p, i) => (
                    <div key={p.id} className="p-3 flex items-center gap-3 hover:bg-taupe-light/20">
                      <span className="w-7 h-7 rounded-full bg-bronze/10 text-bronze flex items-center justify-center font-mono text-xs font-bold flex-shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-xs text-charcoal truncate">{p.title}</p>
                        <p className="text-[10px] text-charcoal-muted">Part {i + 1} of {(parts[editing.id!] || []).length}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={() => move(editing.id!, i, -1)}
                          className="p-1.5 text-charcoal-muted hover:text-bronze disabled:opacity-20 rounded"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={i === (parts[editing.id!] || []).length - 1}
                          onClick={() => move(editing.id!, i, 1)}
                          className="p-1.5 text-charcoal-muted hover:text-bronze disabled:opacity-20 rounded"
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removePart(p.id)}
                          className="p-1.5 text-charcoal-muted hover:text-red-600 rounded ml-1"
                          title="Remove from series"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Drawer inside edit form */}
              {showAddDrawer === editing.id && (
                <div className="bg-taupe-light/20 border border-bronze/40 rounded-md p-4 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-taupe/20">
                    <p className="text-xs font-semibold text-charcoal">Select Articles to Add</p>
                    <button type="button" onClick={() => setShowAddDrawer(null)} className="text-xs text-charcoal-muted hover:text-charcoal"><X size={13} /></button>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search size={13} className="absolute left-2.5 top-2.5 text-charcoal-muted" />
                      <input
                        type="text"
                        value={searchFilter}
                        onChange={e => {
                          setSearchFilter(e.target.value);
                          loadAllPosts(e.target.value);
                        }}
                        placeholder="Search articles by title..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-taupe/60 rounded bg-white focus:outline-none focus:border-bronze"
                      />
                    </div>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value as never)}
                      className="border border-taupe/60 px-2 py-1.5 text-xs rounded bg-white"
                    >
                      <option value="all">All</option>
                      <option value="published">Published</option>
                      <option value="draft">Drafts</option>
                      <option value="unassigned">Unassigned Only</option>
                    </select>
                  </div>
                  <div className="max-h-52 overflow-y-auto border border-taupe/30 rounded bg-white divide-y divide-taupe/15">
                    {loadingPosts ? (
                      <div className="py-6 text-center text-xs text-charcoal-muted"><Loader2 size={13} className="animate-spin inline mr-1" /> Loading articles...</div>
                    ) : filteredAvailablePosts.length === 0 ? (
                      <div className="py-6 text-center text-xs text-charcoal-muted">No matching articles found.</div>
                    ) : (
                      filteredAvailablePosts.map(post => (
                        <div key={post.id} className="p-2.5 flex items-center justify-between gap-2 hover:bg-taupe-light/30">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-charcoal truncate">{post.title}</p>
                            <span className="text-[10px] text-charcoal-muted capitalize">{post.status}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => addPart(editing.id!, post.id)}
                            className="px-2.5 py-1 bg-charcoal text-white hover:bg-bronze text-[10px] rounded transition-colors whitespace-nowrap"
                          >
                            + Add
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-3 border-t border-taupe/20">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze-dark disabled:opacity-50 transition-all font-medium"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {editing.id ? 'Save Changes' : 'Create Series'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="px-4 py-2.5 text-xs text-charcoal-muted hover:text-charcoal tracking-editorial uppercase"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Series List & Parts Management */}
      <div className="space-y-4">
        {series.length === 0 ? (
          <div className="bg-white rounded-md border border-taupe/30 p-12 text-center">
            <Layers size={36} className="text-taupe mx-auto mb-3" />
            <h3 className="font-serif text-lg text-charcoal mb-1">No series created yet</h3>
            <p className="text-sm text-charcoal-muted mb-4 max-w-md mx-auto">
              Group multi-part editorial guides and tutorials into structured, numbered reading paths.
            </p>
            <button
              onClick={() => setEditing({ title: '', is_active: true })}
              className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze transition-colors"
            >
              <Plus size={14} /> Create Your First Series
            </button>
          </div>
        ) : (
          series.map(s => {
            const seriesParts = parts[s.id] || [];
            const isOpen = open === s.id;
            const isAdding = showAddDrawer === s.id;

            return (
              <div key={s.id} className="bg-white rounded-md border border-taupe/30 shadow-sm overflow-hidden transition-all">
                {/* Series Banner Bar */}
                <div className="p-4 flex items-center gap-4 bg-white hover:bg-taupe-light/20 transition-colors">
                  {s.cover_image ? (
                    <img src={s.cover_image} alt="" className="w-14 h-14 rounded-sm object-cover border border-taupe/30 flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-sm bg-taupe-light flex items-center justify-center text-bronze flex-shrink-0">
                      <BookOpen size={20} strokeWidth={1.5} />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-serif text-lg text-charcoal font-medium truncate">{s.title}</h3>
                      {!s.is_active && (
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                          Draft / Hidden
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-charcoal-muted mt-1">
                      <span className="font-mono text-bronze">/series/{s.slug}</span>
                      <span>·</span>
                      <span className="font-medium text-charcoal">{seriesParts.length} {seriesParts.length === 1 ? 'Part' : 'Parts'}</span>
                      {s.description && (
                        <>
                          <span>·</span>
                          <span className="truncate max-w-xs text-gray-500">{s.description}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <a
                      href={`/series/${s.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 text-charcoal-muted hover:text-bronze"
                      title="View public series page"
                    >
                      <ExternalLink size={15} />
                    </a>
                    <button
                      onClick={() => setEditing(s)}
                      className="p-2 text-charcoal-muted hover:text-bronze"
                      title="Edit series info"
                      aria-label="Edit series details"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => remove(s)}
                      className="p-2 text-charcoal-muted hover:text-red-600"
                      title="Delete series"
                      aria-label="Delete series"
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      onClick={() => setOpen(isOpen ? null : s.id)}
                      className="p-2 text-charcoal-muted hover:text-charcoal ml-1"
                      aria-label={isOpen ? 'Collapse series' : 'Expand series'}
                    >
                      {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {/* Series Content & Part List */}
                {isOpen && (
                  <div className="border-t border-taupe/20 bg-taupe-light/10 p-5 space-y-5">
                    {/* Header of parts section */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-medium tracking-editorial uppercase text-charcoal">
                          Series Reading Order ({seriesParts.length} Articles)
                        </h4>
                        <p className="text-xs text-charcoal-muted mt-0.5">
                          Articles are ordered linearly from first to last guide.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAddDrawer(isAdding ? null : s.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bronze text-white text-xs font-medium rounded-sm hover:bg-bronze-dark transition-colors self-start"
                      >
                        <Plus size={13} /> {isAdding ? 'Close Article Picker' : 'Add Articles / Guides'}
                      </button>
                    </div>

                    {/* Articles list */}
                    {seriesParts.length === 0 ? (
                      <div className="bg-white rounded border border-dashed border-taupe/40 p-8 text-center">
                        <FileText size={24} className="text-charcoal-muted mx-auto mb-2" />
                        <p className="text-xs text-charcoal font-medium">No articles assigned to this series yet</p>
                        <p className="text-[11px] text-charcoal-muted mt-1">
                          Click “Add Articles / Guides” above to attach existing articles or guides into this series.
                        </p>
                      </div>
                    ) : (
                      <div className="bg-white rounded border border-taupe/30 divide-y divide-taupe/20">
                        {seriesParts.map((p, i) => (
                          <div key={p.id} className="p-3.5 flex items-center gap-3 hover:bg-taupe-light/20 transition-colors">
                            <span className="w-8 h-8 rounded-full bg-bronze/10 text-bronze flex items-center justify-center font-mono text-xs font-bold flex-shrink-0">
                              {String(i + 1).padStart(2, '0')}
                            </span>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <a
                                  href={`/admin/articles/edit/${p.id}`}
                                  className="font-medium text-sm text-charcoal hover:text-bronze truncate transition-colors"
                                  title="Open article in editor"
                                >
                                  {p.title}
                                </a>
                                {p.status !== 'published' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">
                                    {p.status}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-charcoal-muted flex items-center gap-2 mt-0.5">
                                <span>Part {i + 1} of {seriesParts.length}</span>
                                {p.slug && <span>· <span className="font-mono">/blog/{p.slug}</span></span>}
                              </div>
                            </div>

                            {/* Order adjustment */}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={i === 0}
                                onClick={() => move(s.id, i, -1)}
                                className="p-1.5 text-charcoal-muted hover:text-bronze disabled:opacity-20 rounded"
                                title="Move Part Up"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                disabled={i === seriesParts.length - 1}
                                onClick={() => move(s.id, i, 1)}
                                className="p-1.5 text-charcoal-muted hover:text-bronze disabled:opacity-20 rounded"
                                title="Move Part Down"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => removePart(p.id)}
                                className="p-1.5 text-charcoal-muted hover:text-red-600 rounded ml-2"
                                title="Remove from this series"
                              >
                                <X size={15} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Article Selector Drawer */}
                    {isAdding && (
                      <div className="bg-white border border-bronze/40 rounded-md p-4 space-y-4 shadow-md animate-fade-in">
                        <div className="flex items-center justify-between border-b border-taupe/20 pb-2">
                          <div className="flex items-center gap-2">
                            <Plus size={16} className="text-bronze" />
                            <h5 className="font-serif text-sm font-medium text-charcoal">
                              Select Articles to Add to “{s.title}”
                            </h5>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowAddDrawer(null)}
                            className="text-charcoal-muted hover:text-charcoal text-xs"
                          >
                            Close
                          </button>
                        </div>

                        {/* Search & Filter Controls */}
                        <div className="grid sm:grid-cols-3 gap-2">
                          <div className="sm:col-span-2 relative">
                            <Search size={14} className="absolute left-3 top-3 text-charcoal-muted" />
                            <input
                              type="text"
                              value={searchFilter}
                              onChange={e => setSearchFilter(e.target.value)}
                              placeholder="Search by article title or slug…"
                              className="w-full pl-9 pr-3 py-2 border border-taupe/60 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white"
                            />
                            {searchFilter && (
                              <button
                                type="button"
                                onClick={() => setSearchFilter('')}
                                className="absolute right-2.5 top-2.5 text-charcoal-muted hover:text-charcoal"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                          <div>
                            <select
                              value={statusFilter}
                              onChange={e => setStatusFilter(e.target.value as never)}
                              className="w-full border border-taupe/60 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white"
                            >
                              <option value="all">All Statuses</option>
                              <option value="published">Published Only</option>
                              <option value="draft">Drafts Only</option>
                              <option value="unassigned">Unassigned Only</option>
                            </select>
                          </div>
                        </div>

                        {/* Smart Recommendations Section */}
                        {(() => {
                          const suggestions = filteredAvailablePosts
                            .map(p => {
                              const rel = computeArticleRelevance(p.title, p.slug, s.title, s.description || '');
                              return { ...p, score: rel.score, matchedWords: rel.matchedWords };
                            })
                            .filter(p => p.matchedWords.length > 0)
                            .sort((a, b) => b.score - a.score)
                            .slice(0, 3);

                          if (suggestions.length === 0 || searchFilter.trim()) return null;

                          return (
                            <div className="bg-amber-50/70 border border-amber-200/80 rounded p-3 space-y-2">
                              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                                <Sparkles size={14} className="text-bronze" />
                                <span>Suggested Articles for “{s.title}”</span>
                                <span className="text-[10px] text-amber-700/80 font-normal ml-auto">
                                  Based on title &amp; editorial affinity
                                </span>
                              </div>
                              <div className="divide-y divide-amber-200/50">
                                {suggestions.map(p => (
                                  <div key={`rec-${p.id}`} className="py-2 flex items-center justify-between gap-3">
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
                                      onClick={() => addPart(s.id, p.id)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-bronze text-white hover:bg-bronze-dark text-[11px] rounded transition-colors whitespace-nowrap font-medium shadow-xs"
                                    >
                                      <Plus size={11} /> Add to Series
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Available Post Items List */}
                        <div className="max-h-64 overflow-y-auto border border-taupe/30 rounded divide-y divide-taupe/15">
                          {loadingPosts ? (
                            <div className="py-8 text-center text-xs text-charcoal-muted flex items-center justify-center gap-2">
                              <Loader2 size={14} className="animate-spin text-bronze" /> Loading available articles…
                            </div>
                          ) : filteredAvailablePosts.length === 0 ? (
                            <div className="py-8 text-center text-xs text-charcoal-muted">
                              No matching articles found. Try adjusting your search query or filter.
                            </div>
                          ) : (
                            filteredAvailablePosts.map(post => (
                              <div
                                key={post.id}
                                className="p-3 flex items-center justify-between gap-3 hover:bg-taupe-light/30 transition-colors"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-charcoal truncate">{post.title}</p>
                                  <div className="flex items-center gap-2 text-[10px] text-charcoal-muted mt-0.5">
                                    <span className={post.status === 'published' ? 'text-green-600' : 'text-amber-600'}>
                                      {post.status}
                                    </span>
                                    {post.series_id && (
                                      <span className="text-charcoal-muted">
                                        (Assigned to another series)
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => addPart(s.id, post.id)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-charcoal text-white hover:bg-bronze text-[11px] rounded transition-colors whitespace-nowrap"
                                >
                                  <Plus size={12} /> Add to Series
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
