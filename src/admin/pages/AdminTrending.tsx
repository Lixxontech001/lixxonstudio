import { useState, useEffect, useCallback } from 'react';
import {
  Flame, Plus, Edit2, Archive, Trash2, Eye, MousePointerClick,
  Pin, X,
  ArrowUp, ArrowDown, ExternalLink, RefreshCw
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import AdminImageUploadField from '../components/AdminImageUploadField';
import type { TrendingItem, TrendingCategory, TrendingItemType } from '../../types/trending';

export default function AdminTrending() {
  const [items, setItems] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<TrendingItem> | null>(null);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

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

  const handleOpenNew = () => {
    setEditingItem({
      title: '',
      slug: '',
      excerpt: '',
      content: '',
      category: 'skincare',
      item_type: 'product',
      destination_url: '',
      cover_image: '',
      read_time_minutes: 3,
      priority_order: items.length > 0 ? (items[0].priority_order || 0) + 10 : 10,
      is_pinned: false,
      is_archived: false,
      metadata: {
        brand: '',
        badge: 'NEW RADAR',
        why_trending: '',
        rating_score: 95,
        price: '',
      },
    });
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
        item_type: (editingItem.item_type as TrendingItemType) || 'update',
        metadata: editingItem.metadata || {},
        destination_url: editingItem.destination_url?.trim() || '',
        cover_image: editingItem.cover_image || '',
        read_time_minutes: Number(editingItem.read_time_minutes) || 3,
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
            Curate, prioritize, and monitor reader engagement on the live Trending Radar.
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
            <Plus size={15} />
            <span>New Trending Item</span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-sm border border-gray-200 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-editorial text-gray-500 font-medium">Category:</span>
          {['all', 'skincare', 'fashion', 'wellness', 'others'].map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1 text-xs rounded-full uppercase tracking-editorial font-medium transition-colors ${
                filterCategory === cat ? 'bg-charcoal text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
            className="rounded text-bronze focus:ring-bronze"
          />
          <span>Show Archived Items</span>
        </label>
      </div>

      {/* Items Table */}
      <div className="bg-white rounded-sm border border-gray-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading trending index...</div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center text-sm text-gray-500">
            No trending items match the active filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-editorial">
                  <th className="py-3 px-4">Item</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Priority / Rank</th>
                  <th className="py-3 px-3">Engagement (Votes / Views / Clicks)</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                    {/* Item title and excerpt */}
                    <td className="py-3 px-4 max-w-xs">
                      <div className="flex items-center gap-2">
                        {item.is_pinned && (
                          <span title="Pinned to top" className="text-bronze flex-shrink-0">
                            <Pin size={13} className="fill-bronze" />
                          </span>
                        )}
                        <span className="font-medium text-gray-900 text-sm truncate">{item.title}</span>
                      </div>
                      <p className="text-gray-500 text-[11px] truncate mt-0.5">{item.excerpt}</p>
                    </td>

                    {/* Archetype */}
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-editorial bg-gray-100 text-gray-700">
                        {item.item_type}
                      </span>
                    </td>

                    {/* Category */}
                    <td className="py-3 px-3">
                      <span className="text-gray-600 uppercase tracking-editorial font-medium">{item.category}</span>
                    </td>

                    {/* Priority adjustment */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-900 w-8">{item.priority_order}</span>
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleAdjustPriority(item, 5)}
                            className="text-gray-400 hover:text-gray-800 p-0.5"
                            title="Increase rank"
                            aria-label={`Increase priority for ${item.title}`}
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            onClick={() => handleAdjustPriority(item, -5)}
                            className="text-gray-400 hover:text-gray-800 p-0.5"
                            title="Decrease rank"
                            aria-label={`Decrease priority for ${item.title}`}
                          >
                            <ArrowDown size={12} />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Counters */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-4 text-gray-600">
                        <span className="inline-flex items-center gap-1" title="Upvotes">
                          <Flame size={13} className="text-orange-500" />
                          <strong className="text-gray-900">{item.upvotes}</strong>
                        </span>
                        <span className="inline-flex items-center gap-1" title="Views">
                          <Eye size={13} className="text-blue-500" />
                          <span>{item.views_count}</span>
                        </span>
                        <span className="inline-flex items-center gap-1" title="Outbound clicks">
                          <MousePointerClick size={13} className="text-bronze" />
                          <span>{item.clicks_count}</span>
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        {item.destination_url && (
                          <a
                            href={item.destination_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors"
                            title="Preview destination link"
                            aria-label="Preview destination link"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        <button
                          onClick={() => handleEdit(item)}
                          className="p-1.5 text-gray-500 hover:text-bronze transition-colors"
                          title="Edit"
                          aria-label={`Edit ${item.title}`}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleToggleArchive(item)}
                          className={`p-1.5 transition-colors ${
                            item.is_archived ? 'text-green-600 hover:text-green-700' : 'text-gray-400 hover:text-gray-700'
                          }`}
                          title={item.is_archived ? 'Restore' : 'Archive'}
                          aria-label={item.is_archived ? 'Restore' : 'Archive'}
                        >
                          <Archive size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete"
                          aria-label={`Delete ${item.title}`}
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
              <h2 className="font-serif text-lg text-gray-900">
                {editingItem.id ? 'Edit Trending Entry' : 'Create Trending Entry'}
              </h2>
              <button
                onClick={() => setEditingItem(null)}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5 text-xs text-gray-700">
              {/* Title & Slug */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingItem.title || ''}
                    onChange={e => setEditingItem({ ...editingItem, title: e.target.value })}
                    className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm"
                    placeholder="e.g. Copper Peptide Rapid Barrier Ampoule"
                  />
                </div>
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Slug (Auto-generated if empty)
                  </label>
                  <input
                    type="text"
                    value={editingItem.slug || ''}
                    onChange={e => setEditingItem({ ...editingItem, slug: e.target.value })}
                    className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm"
                    placeholder="copper-peptide-ampoule"
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
                    Card Archetype
                  </label>
                  <select
                    value={editingItem.item_type || 'product'}
                    onChange={e =>
                      setEditingItem({ ...editingItem, item_type: e.target.value as TrendingItemType })
                    }
                    className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm"
                  >
                    <option value="product">Product Spotlight</option>
                    <option value="debate">Community Discussion & Debate</option>
                    <option value="ingredient">Ingredient & Science Argument</option>
                    <option value="update">Editorial Breaking Update</option>
                  </select>
                </div>
              </div>

              {/* Excerpt */}
              <div>
                <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                  Excerpt / Summary
                </label>
                <textarea
                  rows={2}
                  value={editingItem.excerpt || ''}
                  onChange={e => setEditingItem({ ...editingItem, excerpt: e.target.value })}
                  className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm"
                  placeholder="Key briefing sentence displayed prominently on the card..."
                />
              </div>

              {/* Archetype Specific Fields */}
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-sm space-y-4">
                <h3 className="font-serif text-sm font-medium text-gray-900 border-b border-gray-200 pb-2">
                  Archetype Metadata ({editingItem.item_type})
                </h3>

                {editingItem.item_type === 'product' && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-600 mb-1 font-medium">Brand Name</label>
                      <input
                        type="text"
                        value={editingItem.metadata?.brand || ''}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, brand: e.target.value },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. Biologique Lab"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1 font-medium">Heat Score (0-100)</label>
                      <input
                        type="number"
                        value={editingItem.metadata?.rating_score || 95}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, rating_score: Number(e.target.value) },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-gray-600 mb-1 font-medium">Why it's trending</label>
                      <input
                        type="text"
                        value={editingItem.metadata?.why_trending || ''}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, why_trending: e.target.value },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. Viral barrier rescue protocol after tretinoin irritation."
                      />
                    </div>
                  </div>
                )}

                {editingItem.item_type === 'debate' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-gray-600 mb-1 font-medium">Topic Headline</label>
                      <input
                        type="text"
                        value={editingItem.metadata?.topic_headline || ''}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, topic_headline: e.target.value },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. Double cleansing vs. natural microbiome balance"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1 font-medium">Counter-Arguments</label>
                      <textarea
                        rows={2}
                        value={editingItem.metadata?.counter_arguments || ''}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, counter_arguments: e.target.value },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. Some argue it strips lipid balance while others claim SPF removal requires oil."
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1 font-medium">Community Takeaway</label>
                      <input
                        type="text"
                        value={editingItem.metadata?.community_takeaway || ''}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, community_takeaway: e.target.value },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. Limit to PM routines and emulsify thoroughly."
                      />
                    </div>
                  </div>
                )}

                {editingItem.item_type === 'ingredient' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-gray-600 mb-1 font-medium">The Controversy</label>
                      <input
                        type="text"
                        value={editingItem.metadata?.controversy || ''}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, controversy: e.target.value },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. Stability vs. Cellular Retinoic Receptor Binding"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1 font-medium">Clinical Consensus</label>
                      <textarea
                        rows={2}
                        value={editingItem.metadata?.consensus || ''}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, consensus: e.target.value },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. Equal anti-aging transcription efficacy with 60% lower TEWL irritation."
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1 font-medium">Key Study Summary</label>
                      <input
                        type="text"
                        value={editingItem.metadata?.study_summary || ''}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, study_summary: e.target.value },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. 12-week randomized trial confirms non-inferior collagen synthesis."
                      />
                    </div>
                  </div>
                )}

                {editingItem.item_type === 'update' && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-600 mb-1 font-medium">Source Attribution Name</label>
                      <input
                        type="text"
                        value={editingItem.metadata?.source_name || ''}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, source_name: e.target.value },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. International Fragrance Association"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1 font-medium">Timestamp Label</label>
                      <input
                        type="text"
                        value={editingItem.metadata?.timestamp_label || ''}
                        onChange={e =>
                          setEditingItem({
                            ...editingItem,
                            metadata: { ...editingItem.metadata, timestamp_label: e.target.value },
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. 2 hours ago / Just Verified"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Destination URL */}
              <div>
                <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                  Destination Link (Shop, Article, or External)
                </label>
                <input
                  type="text"
                  value={editingItem.destination_url || ''}
                  onChange={e => setEditingItem({ ...editingItem, destination_url: e.target.value })}
                  className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm"
                  placeholder="e.g. /shop or https://pubmed.ncbi.nlm.nih.gov/..."
                />
              </div>

              {/* Image Upload */}
              <AdminImageUploadField
                label="Cover Image / Visual"
                value={editingItem.cover_image || ''}
                onChange={url => setEditingItem({ ...editingItem, cover_image: url })}
                folder="general"
                hint="Upload or pick an image from media library"
              />

              {/* Priority & Toggles */}
              <div className="grid sm:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Priority Rank
                  </label>
                  <input
                    type="number"
                    value={editingItem.priority_order || 0}
                    onChange={e =>
                      setEditingItem({ ...editingItem, priority_order: Number(e.target.value) })
                    }
                    className="w-full border border-gray-300 p-2.5 rounded-sm"
                  />
                </div>
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Read Time (Mins)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editingItem.read_time_minutes || 3}
                    onChange={e =>
                      setEditingItem({ ...editingItem, read_time_minutes: Number(e.target.value) })
                    }
                    className="w-full border border-gray-300 p-2.5 rounded-sm"
                  />
                </div>
                <div className="flex flex-col justify-center space-y-2 pt-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingItem.is_pinned)}
                      onChange={e => setEditingItem({ ...editingItem, is_pinned: e.target.checked })}
                      className="rounded text-bronze focus:ring-bronze"
                    />
                    <span className="font-medium text-gray-800">Pin to Top</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingItem.is_archived)}
                      onChange={e => setEditingItem({ ...editingItem, is_archived: e.target.checked })}
                      className="rounded text-bronze focus:ring-bronze"
                    />
                    <span className="font-medium text-gray-800">Archived</span>
                  </label>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t border-gray-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-sm hover:bg-gray-50 uppercase tracking-editorial text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-bronze text-white rounded-sm hover:bg-bronze-dark uppercase tracking-editorial text-xs font-medium transition-colors shadow-sm disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingItem.id ? 'Update Entry' : 'Create Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
