import { useState } from 'react';
import { useAdminPosts, useCategories } from '../../hooks/useSupabase';
import { useNavigation } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabaseClient';
import { Plus, Search, Copy, Trash2, Eye, Pencil } from 'lucide-react';
import type { PostStatus } from '../../lib/types';

const STATUS_COLORS: Record<PostStatus, string> = {
  published: 'bg-green-50 text-green-700',
  draft: 'bg-amber-50 text-amber-700',
  scheduled: 'bg-blue-50 text-blue-700',
  archived: 'bg-gray-100 text-gray-600',
};

export default function AdminArticles() {
  const { navigate } = useNavigation();
  const { categories } = useCategories();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');
  const { posts, totalPages, loading } = useAdminPosts(page, { status: statusFilter, category: categoryFilter, search });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkTag, setBulkTag] = useState('');
  const allSelected = posts.length > 0 && posts.every(p => selected.has(p.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(posts.map(p => p.id)));
  const toggleOne = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const bulk = async (action: 'publish' | 'draft' | 'archive' | 'delete' | 'tag' | 'feature' | 'unfeature') => {
    const ids = [...selected]; if (!ids.length) return;
    if (action === 'delete' && !confirm(`Delete ${ids.length} article(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    if (action === 'delete') await supabase.from('posts').delete().in('id', ids);
    else if (action === 'tag') {
      const tag = bulkTag.trim().toLowerCase(); if (!tag) { setBulkBusy(false); return; }
      await Promise.all(posts.filter(p => selected.has(p.id)).map(p => supabase.from('posts').update({ tags: Array.from(new Set([...(p.tags || []), tag])) }).eq('id', p.id)));
    }
    else if (action === 'feature' || action === 'unfeature') await supabase.from('posts').update({ featured: action === 'feature' }).in('id', ids);
    else await supabase.from('posts').update({ status: action === 'publish' ? 'published' : action === 'draft' ? 'draft' : 'archived', ...(action === 'publish' ? { published_at: new Date().toISOString() } : {}) }).in('id', ids);
    setBulkBusy(false); setSelected(new Set());
    window.location.reload();
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    await supabase.from('posts').delete().eq('id', id);
    window.location.reload();
  };

  const handleDuplicate = async (post: typeof posts[0]) => {
    const { data, error } = await supabase.from('posts').insert({
      title: `${post.title} (Copy)`,
      slug: `${post.slug}-copy-${Date.now().toString(36)}`,
      excerpt: post.excerpt,
      content: post.content,
      cover_image: post.cover_image,
      category_id: post.category_id,
      author_id: post.author_id,
      status: 'draft',
      tags: post.tags,
      reading_time_minutes: post.reading_time_minutes,
    }).select().single();
    if (!error && data) {
      navigate({ name: 'admin-article-edit', id: data.id });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-gray-900">Articles</h1>
          <p className="text-gray-500 text-sm mt-1">Manage all editorial content</p>
        </div>
        <button
          onClick={() => navigate({ name: 'admin-article-new' })}
          className="inline-flex items-center gap-2 bg-bronze text-white px-4 py-2.5 rounded text-sm font-medium hover:bg-bronze-dark transition-colors"
        >
          <Plus size={16} /> New Article
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search articles..."
            className="w-full bg-white border border-gray-200 pl-10 pr-4 py-2.5 rounded text-sm focus:outline-none focus:border-bronze"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-white border border-gray-200 px-4 py-2.5 rounded text-sm focus:outline-none focus:border-bronze"
        >
          <option value="all">All Statuses</option>
          <option value="published">Published</option>
          <option value="draft">Drafts</option>
          <option value="scheduled">Scheduled</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
          className="bg-white border border-gray-200 px-4 py-2.5 rounded text-sm focus:outline-none focus:border-bronze"
        >
          <option value="all">All Categories</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-charcoal text-white rounded text-xs">
          <span className="font-medium mr-2">{selected.size} selected</span>
          <button disabled={bulkBusy} onClick={() => bulk('publish')} className="px-3 py-1.5 bg-white/10 rounded hover:bg-bronze">Publish</button>
          <button disabled={bulkBusy} onClick={() => bulk('draft')} className="px-3 py-1.5 bg-white/10 rounded hover:bg-bronze">Unpublish</button>
          <button disabled={bulkBusy} onClick={() => bulk('archive')} className="px-3 py-1.5 bg-white/10 rounded hover:bg-bronze">Archive</button>
          <button disabled={bulkBusy} onClick={() => bulk('feature')} className="px-3 py-1.5 bg-white/10 rounded hover:bg-bronze">Feature</button>
          <button disabled={bulkBusy} onClick={() => bulk('unfeature')} className="px-3 py-1.5 bg-white/10 rounded hover:bg-bronze">Unfeature</button>
          <span className="inline-flex"><input value={bulkTag} onChange={e => setBulkTag(e.target.value)} placeholder="add tag…" className="px-2 py-1.5 rounded-l text-charcoal w-28" /><button disabled={bulkBusy} onClick={() => bulk('tag')} className="px-3 py-1.5 bg-white/10 rounded-r hover:bg-bronze">Tag</button></span>
          <button disabled={bulkBusy} onClick={() => bulk('delete')} className="ml-auto px-3 py-1.5 bg-red-600/80 rounded hover:bg-red-600">Delete</button>
          <button onClick={() => setSelected(new Set())} className="px-2 py-1.5 text-white/60 hover:text-white">Clear</button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : posts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <p className="text-gray-500 text-sm">No articles found. Try adjusting your filters or create a new article.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Title</th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider hidden md:table-cell">Category</th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider hidden lg:table-cell">Date</th>
                <th className="text-right px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map(post => (
                <tr key={post.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${selected.has(post.id) ? 'bg-bronze/5' : ''}`}>
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.has(post.id)} onChange={() => toggleOne(post.id)} aria-label={`Select ${post.title}`} /></td>
                  <td className="px-5 py-3">
                    <button onClick={() => navigate({ name: 'admin-article-edit', id: post.id })} className="text-left">
                      <p className="font-medium text-gray-900 hover:text-bronze transition-colors">{post.title}</p>
                      {post.featured && <span className="text-xs text-bronze">Featured</span>}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-gray-600 hidden md:table-cell">{post.category?.name || '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[post.status]}`}>{post.status}</span>
                  </td>
                  <td className="px-5 py-3 text-gray-600 hidden lg:table-cell">
                    {new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => navigate({ name: 'admin-article-edit', id: post.id })} className="p-1.5 text-gray-400 hover:text-bronze transition-colors" title="Edit">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => navigate({ name: 'article', slug: post.slug })} className="p-1.5 text-gray-400 hover:text-bronze transition-colors" title="View">
                        <Eye size={15} />
                      </button>
                      <button onClick={() => handleDuplicate(post)} className="p-1.5 text-gray-400 hover:text-bronze transition-colors" title="Duplicate">
                        <Copy size={15} />
                      </button>
                      <button onClick={() => handleDelete(post.id, post.title)} className="p-1.5 text-gray-400 hover:text-red-600 transition-colors" title="Delete">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 text-sm border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600 px-2">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 text-sm border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
