import { useState, useEffect, useCallback } from 'react';
import {
  Flame, Plus, Edit2, Archive, Trash2, Eye, MousePointerClick,
  Pin, X, ArrowUp, ArrowDown, ExternalLink, RefreshCw, BookOpen,
  Search, Check, Sparkles
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import AdminImageUploadField from '../components/AdminImageUploadField';
import type { TrendingItem, TrendingCategory, TrendingItemType } from '../../types/trending';

interface PublishedArticleOption {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image: string | null;
  reading_time_minutes: number | null;
  category?: { name: string; slug: string } | null;
  author?: { name: string; avatar_url: string | null; role: string | null } | null;
}

export default function AdminTrending() {
  const [items, setItems] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<TrendingItem> | null>(null);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Article Picker state
  const [showArticlePicker, setShowArticlePicker] = useState(false);
  const [availableArticles, setAvailableArticles] = useState<PublishedArticleOption[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [articleSearch, setArticleSearch] = useState('');

  const showNotification = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const loadTrending = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('trending_items')
        .select('*')
        .order('is_pinned', { ascending: false })
        .order('priority_order', { ascending: false })
        .order('created_at', { ascending: false });

      if (!showArchived) {
        query = query.eq('is_archived', false);
      }
      if (filterCategory !== 'all') {
        query = query.eq('category', filterCategory);
      }

      const { data, error } = await query;
      if (error) throw error;
      setItems((data || []) as TrendingItem[]);
    } catch (err) {
      console.error('[AdminTrending] Error loading:', err);
    } finally {
      setLoading(false);
    }
  }, [showArchived, filterCategory]);

  useEffect(() => {
    loadTrending();
  }, [loadTrending]);

  const loadArticlesForPicker = async () => {
    setArticlesLoading(true);
    try {
      const { data, error } = await supabase
        .from('posts')
        .select('id, title, slug, excerpt, cover_image, reading_time_minutes, category:categories(name, slug), author:authors(name, avatar_url, role)')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setAvailableArticles((data || []) as unknown as PublishedArticleOption[]);
    } catch (err) {
      console.warn('[AdminTrending] Error loading articles for picker:', err);
    } finally {
      setArticlesLoading(false);
    }
  };

  const handleOpenNew = () => {
    setEditingItem({
      title: '',
      slug: '',
      excerpt: '',
      content: '',
      category: 'skincare',
      item_type: 'article',
      destination_url: '',
      cover_image: '',
      read_time_minutes: 5,
      priority_order: items.length > 0 ? (items[0].priority_order || 0) + 10 : 10,
      is_pinned: false,
      is_archived: false,
      metadata: {
        post_id: '',
        post_slug: '',
        author_name: 'Staff Editor',
        trending_badge: 'Trending #1',
        why_trending: 'Editorially highlighted story',
      },
    });
  };

  const handleSelectArticle = (art: PublishedArticleOption) => {
    const catSlug = (art.category?.slug || 'skincare').toLowerCase();
    const categoryNormalized: TrendingCategory =
      catSlug === 'skincare' ? 'skincare' :
      catSlug === 'fashion' ? 'fashion' :
      catSlug === 'wellness' ? 'wellness' : 'others';

    setEditingItem(prev => ({
      ...prev,
      title: art.title,
      slug: art.slug,
      excerpt: art.excerpt || '',
      category: categoryNormalized,
      item_type: 'article',
      destination_url: `/article/${art.slug}`,
      cover_image: art.cover_image || '',
      read_time_minutes: art.reading_time_minutes || 5,
      metadata: {
        ...(prev?.metadata || {}),
        post_id: art.id,
        post_slug: art.slug,
        author_name: art.author?.name || 'Staff Editor',
        author_avatar: art.author?.avatar_url || '',
        author_role: art.author?.role || 'Contributor',
        trending_badge: prev?.metadata?.trending_badge || 'Viral Story',
        why_trending: prev?.metadata?.why_trending || 'Featured editorial deep dive',
      },
    }));
    setShowArticlePicker(false);
    showNotification(`Populated details from "${art.title}"`);
  };

  const handleEdit = (item: TrendingItem) => {
    setEditingItem({ ...item, metadata: { ...item.metadata } });
  };

  const handleToggleArchive = async (item: TrendingItem) => {
    try {
      const next = !item.is_archived;
      await supabase.from('trending_items').update({ is_archived: next }).eq('id', item.id);
      showNotification(next ? 'Entry archived' : 'Entry restored to active index');
      loadTrending();
    } catch {
      showNotification('Action failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this trending item?')) return;
    try {
      await supabase.from('trending_items').delete().eq('id', id);
      showNotification('Trending item deleted');
      loadTrending();
    } catch {
      showNotification('Delete failed');
    }
  };

  const handleAdjustPriority = async (item: TrendingItem, delta: number) => {
    const nextPriority = Math.max(0, (item.priority_order || 0) + delta);
    try {
      await supabase.from('trending_items').update({ priority_order: nextPriority }).eq('id', item.id);
      loadTrending();
    } catch {
      // ignore
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.title?.trim()) return;

    setSaving(true);
    try {
      const slug =
        editingItem.slug?.trim() ||
        editingItem.title
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');

      const payload = {
        title: editingItem.title.trim(),
        slug,
        excerpt: editingItem.excerpt?.trim() || '',
        content: editingItem.content?.trim() || '',
        category: (editingItem.category as TrendingCategory) || 'all',
        item_type: (editingItem.item_type as TrendingItemType) || 'article',
        metadata: editingItem.metadata || {},
        destination_url: editingItem.destination_url?.trim() || (editingItem.item_type === 'article' && editingItem.metadata?.post_slug ? `/article/${editingItem.metadata.post_slug}` : ''),
        cover_image: editingItem.cover_image || '',
        read_time_minutes: Number(editingItem.read_time_minutes) || 5,
        priority_order: Number(editingItem.priority_order) || 0,
        is_pinned: Boolean(editingItem.is_pinned),
        is_archived: Boolean(editingItem.is_archived),
        expires_at: editingItem.expires_at || null,
        updated_at: new Date().toISOString(),
      };

      if (editingItem.id) {
        const { error } = await supabase.from('trending_items').update(payload).eq('id', editingItem.id);
        if (error) throw error;
        showNotification('Trending item updated');
      } else {
        const { error } = await supabase.from('trending_items').insert(payload);
        if (error) throw error;
        showNotification('Trending item created');
      }

      setEditingItem(null);
      loadTrending();
    } catch (err: unknown) {
      console.error('[AdminTrending] save error:', err);
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const filteredPickerArticles = availableArticles.filter(art => {
    if (!articleSearch.trim()) return true;
    const q = articleSearch.toLowerCase();
    return art.title.toLowerCase().includes(q) || art.slug.toLowerCase().includes(q);
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white px-4 py-2.5 rounded-sm shadow-lg text-xs tracking-wide">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2">
            <Flame size={22} className="text-bronze" />
            <h1 className="font-serif text-2xl sm:text-3xl text-charcoal">Trending Hub Engine</h1>
          </div>
          <p className="text-sm text-charcoal-muted mt-1">
            Curate and feature primary editorial articles and cultural radar highlights on the live Trending Index.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadTrending}
            className="p-2 border border-gray-300 rounded-sm hover:bg-gray-50 text-gray-600 transition-colors"
            title="Refresh"
            aria-label="Refresh trending list"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={handleOpenNew}
            className="inline-flex items-center gap-2 px-4 py-2 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-colors shadow-sm"
          >
            <Plus size={16} />
            <span>Feature New Article</span>
          </button>
        </div>
      </div>

      {/* Filter and Statistics Bar */}
      <div className="bg-white border border-gray-200 rounded-sm p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-editorial">Filter:</span>
          {['all', 'skincare', 'fashion', 'wellness', 'others'].map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
                filterCategory === cat
                  ? 'bg-bronze text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-600">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
              className="accent-bronze"
            />
            <span>Show Archived</span>
          </label>
          <span className="text-gray-300">|</span>
          <span>{items.length} Curated Entries</span>
        </div>
      </div>

      {/* Main List Table */}
      <div className="bg-white border border-gray-200 rounded-sm overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-500">Loading trending radar entries...</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <Flame size={32} className="mx-auto text-gray-400 mb-3" />
            <p className="font-serif text-lg text-gray-800 mb-1">No custom entries found</p>
            <p className="text-xs text-gray-500 max-w-sm mx-auto mb-4">
              Your public Trending page automatically streams real published articles. You can feature specific articles or cultural spotlights here.
            </p>
            <button
              onClick={handleOpenNew}
              className="px-4 py-2 bg-bronze text-white text-xs uppercase tracking-editorial rounded-sm hover:bg-bronze-dark transition-colors"
            >
              Feature First Article
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-editorial text-[10px]">
                  <th className="py-3 px-4">Priority / Pin</th>
                  <th className="py-3 px-4">Entry / Headline</th>
                  <th className="py-3 px-4">Format</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Engagement</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => (
                  <tr
                    key={item.id}
                    className={`hover:bg-gray-50 transition-colors ${
                      item.is_archived ? 'opacity-50 bg-gray-50/50' : ''
                    }`}
                  >
                    {/* Priority & Pin */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        {item.is_pinned && (
                          <span
                            className="p-1 text-bronze bg-bronze/10 rounded"
                            title="Pinned to Lead Top"
                          >
                            <Pin size={12} />
                          </span>
                        )}
                        <span className="font-mono text-gray-700 font-semibold">
                          {item.priority_order || 0}
                        </span>
                        <div className="flex flex-col ml-1">
                          <button
                            onClick={() => handleAdjustPriority(item, 5)}
                            className="text-gray-400 hover:text-gray-700"
                            title="Increase Priority"
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button
                            onClick={() => handleAdjustPriority(item, -5)}
                            className="text-gray-400 hover:text-gray-700"
                            title="Decrease Priority"
                          >
                            <ArrowDown size={11} />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Title & Excerpt */}
                    <td className="py-3 px-4 max-w-sm">
                      <div className="flex items-start gap-3">
                        {item.cover_image && (
                          <img
                            src={item.cover_image}
                            alt=""
                            className="w-12 h-10 object-cover rounded-sm border border-gray-200 flex-shrink-0"
                          />
                        )}
                        <div>
                          <p className="font-medium text-gray-900 text-xs line-clamp-1">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">
                            {item.excerpt}
                          </p>
                          {item.metadata?.why_trending && (
                            <span className="inline-block text-[10px] text-bronze mt-0.5 italic">
                              Angle: {item.metadata.why_trending}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Format */}
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-gray-100 text-gray-700">
                        {item.item_type === 'article' && <BookOpen size={10} className="text-bronze" />}
                        {item.item_type}
                      </span>
                    </td>

                    {/* Category */}
                    <td className="py-3 px-4 capitalize text-gray-600 font-medium">
                      {item.category}
                    </td>

                    {/* Counters */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3 text-gray-600">
                        <span className="flex items-center gap-1" title="Upvotes">
                          <Flame size={12} className="text-bronze" /> {item.upvotes}
                        </span>
                        <span className="flex items-center gap-1" title="Views">
                          <Eye size={12} /> {item.views_count}
                        </span>
                        <span className="flex items-center gap-1" title="Clicks">
                          <MousePointerClick size={12} /> {item.clicks_count}
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {item.destination_url && (
                          <a
                            href={item.destination_url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 text-gray-400 hover:text-gray-700"
                            title="View Link"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        <button
                          onClick={() => handleEdit(item)}
                          className="p-1.5 text-gray-400 hover:text-bronze transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleToggleArchive(item)}
                          className={`p-1.5 transition-colors ${
                            item.is_archived ? 'text-green-600 hover:text-green-700' : 'text-gray-400 hover:text-gray-700'
                          }`}
                          title={item.is_archived ? 'Restore' : 'Archive'}
                        >
                          <Archive size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-sm border border-gray-200 shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col my-8">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-2">
                <Flame size={18} className="text-bronze" />
                <h2 className="font-serif text-lg text-gray-900">
                  {editingItem.id ? 'Edit Trending Entry' : 'Feature Article / Cultural Spotlight'}
                </h2>
              </div>
              <button
                onClick={() => setEditingItem(null)}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5 text-xs text-gray-700">
              {/* Top Quick Action: Select Published Article */}
              <div className="bg-bronze/5 border border-bronze/20 p-4 rounded-sm flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 text-xs">Feature an existing published article?</p>
                  <p className="text-[11px] text-gray-500">Pick from your live editorial catalogue to auto-fill details.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    loadArticlesForPicker();
                    setShowArticlePicker(true);
                  }}
                  className="px-3 py-1.5 bg-bronze text-white text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-bronze-dark transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <BookOpen size={13} />
                  <span>Select Article</span>
                </button>
              </div>

              {/* Title & Slug */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Article Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingItem.title || ''}
                    onChange={e => setEditingItem({ ...editingItem, title: e.target.value })}
                    className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm"
                    placeholder="e.g. The Barrier Repair Masterclass"
                  />
                </div>
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Slug
                  </label>
                  <input
                    type="text"
                    value={editingItem.slug || ''}
                    onChange={e => setEditingItem({ ...editingItem, slug: e.target.value })}
                    className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm"
                    placeholder="barrier-repair-masterclass"
                  />
                </div>
              </div>

              {/* Category & Archetype */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Category
                  </label>
                  <select
                    value={editingItem.category || 'skincare'}
                    onChange={e =>
                      setEditingItem({ ...editingItem, category: e.target.value as TrendingCategory })
                    }
                    className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm"
                  >
                    <option value="skincare">Skincare</option>
                    <option value="fashion">Fashion</option>
                    <option value="wellness">Wellness</option>
                    <option value="others">Others</option>
                  </select>
                </div>
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Content Format
                  </label>
                  <select
                    value={editingItem.item_type || 'article'}
                    onChange={e =>
                      setEditingItem({ ...editingItem, item_type: e.target.value as TrendingItemType })
                    }
                    className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm font-medium"
                  >
                    <option value="article">Editorial Article (Primary)</option>
                    <option value="product">Product Spotlight</option>
                    <option value="debate">Community Discussion / Debate</option>
                    <option value="ingredient">Science / Clinical Argument</option>
                    <option value="update">Editorial Breaking Wire</option>
                  </select>
                </div>
              </div>

              {/* Excerpt */}
              <div>
                <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                  Excerpt / Editorial Synopsis *
                </label>
                <textarea
                  rows={2}
                  required
                  value={editingItem.excerpt || ''}
                  onChange={e => setEditingItem({ ...editingItem, excerpt: e.target.value })}
                  className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm"
                  placeholder="Compelling 2-sentence summary of the story..."
                />
              </div>

              {/* Article Specific Metadata Controls */}
              <div className="bg-gray-50 border border-gray-200 p-4 rounded-sm space-y-3">
                <div className="flex items-center gap-2 mb-2 text-gray-800 font-medium">
                  <Sparkles size={14} className="text-bronze" />
                  <span>Trending Badges & Editorial Hook</span>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-600 mb-1">Trending Badge</label>
                    <input
                      type="text"
                      value={editingItem.metadata?.trending_badge || ''}
                      onChange={e =>
                        setEditingItem({
                          ...editingItem,
                          metadata: { ...editingItem.metadata, trending_badge: e.target.value },
                        })
                      }
                      placeholder="e.g. Trending #1, Viral Story, Editor's Pick"
                      className="w-full border border-gray-300 p-2 rounded-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">Why It's Trending (Angle)</label>
                    <input
                      type="text"
                      value={editingItem.metadata?.why_trending || ''}
                      onChange={e =>
                        setEditingItem({
                          ...editingItem,
                          metadata: { ...editingItem.metadata, why_trending: e.target.value },
                        })
                      }
                      placeholder="e.g. Over 4,200 readers engaged in discussion"
                      className="w-full border border-gray-300 p-2 rounded-sm bg-white"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-600 mb-1">Author Byline</label>
                    <input
                      type="text"
                      value={editingItem.metadata?.author_name || ''}
                      onChange={e =>
                        setEditingItem({
                          ...editingItem,
                          metadata: { ...editingItem.metadata, author_name: e.target.value },
                        })
                      }
                      placeholder="e.g. Emma Vance"
                      className="w-full border border-gray-300 p-2 rounded-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">Read Time (Minutes)</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={editingItem.read_time_minutes || 5}
                      onChange={e => setEditingItem({ ...editingItem, read_time_minutes: Number(e.target.value) })}
                      className="w-full border border-gray-300 p-2 rounded-sm bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Cover Image Upload */}
              <AdminImageUploadField
                label="Cover Image"
                value={editingItem.cover_image || ''}
                onChange={url => setEditingItem({ ...editingItem, cover_image: url })}
                folder="articles"
              />

              {/* Priority & Pinned Controls */}
              <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-gray-200">
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Priority Rank (Higher = Top of Leaderboard)
                  </label>
                  <input
                    type="number"
                    value={editingItem.priority_order || 0}
                    onChange={e =>
                      setEditingItem({ ...editingItem, priority_order: Number(e.target.value) })
                    }
                    className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none"
                  />
                </div>
                <div className="flex flex-col justify-center">
                  <label className="flex items-center gap-2 cursor-pointer mt-4">
                    <input
                      type="checkbox"
                      checked={Boolean(editingItem.is_pinned)}
                      onChange={e =>
                        setEditingItem({ ...editingItem, is_pinned: e.target.checked })
                      }
                      className="h-4 w-4 accent-bronze"
                    />
                    <span className="font-medium text-gray-900">Pin as #01 Hero Story</span>
                  </label>
                  <span className="text-[11px] text-gray-500 ml-6">
                    Displays in the giant magazine hero banner at top of Trending Index.
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-gray-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 border border-gray-300 rounded-sm hover:bg-gray-50 text-gray-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-bronze text-white text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-bronze-dark transition-colors shadow-sm disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingItem.id ? 'Update Story' : 'Publish to Trending'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Published Article Picker Drawer / Modal */}
      {showArticlePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-sm border border-gray-200 shadow-2xl max-w-xl w-full max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-2">
                <BookOpen size={18} className="text-bronze" />
                <h3 className="font-serif text-base text-gray-900">Select Published Article</h3>
              </div>
              <button
                onClick={() => setShowArticlePicker(false)}
                className="text-gray-400 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 border-b border-gray-200">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={articleSearch}
                  onChange={e => setArticleSearch(e.target.value)}
                  placeholder="Search articles by title or slug..."
                  className="w-full border border-gray-300 pl-9 pr-3 py-2 text-xs rounded-sm focus:border-bronze focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {articlesLoading ? (
                <p className="text-center py-8 text-xs text-gray-500">Loading published articles...</p>
              ) : filteredPickerArticles.length === 0 ? (
                <p className="text-center py-8 text-xs text-gray-500">No matching articles found.</p>
              ) : (
                filteredPickerArticles.map(art => (
                  <div
                    key={art.id}
                    onClick={() => handleSelectArticle(art)}
                    className="p-3 border border-gray-100 hover:border-bronze hover:bg-bronze/5 rounded-sm flex items-center gap-3 cursor-pointer transition-all group"
                  >
                    {art.cover_image ? (
                      <img
                        src={art.cover_image}
                        alt=""
                        className="w-12 h-12 object-cover rounded-sm flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-gray-100 rounded-sm flex items-center justify-center flex-shrink-0 text-gray-400">
                        <BookOpen size={16} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 group-hover:text-bronze transition-colors line-clamp-1">
                        {art.title}
                      </p>
                      <p className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">
                        {art.category?.name || 'Editorial'} · By {art.author?.name || 'Staff'} · {art.reading_time_minutes || 5} min read
                      </p>
                    </div>
                    <Check size={16} className="text-gray-300 group-hover:text-bronze flex-shrink-0" />
                  </div>
                ))
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setShowArticlePicker(false)}
                className="px-4 py-1.5 border border-gray-300 text-xs text-gray-600 rounded-sm hover:bg-gray-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
