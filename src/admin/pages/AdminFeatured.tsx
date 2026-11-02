import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { usePosts } from '../../hooks/useSupabase';
import { useNavigation } from '../../context/NavigationContext';
import { Star, Sparkles, Search } from 'lucide-react';

export default function AdminFeatured() {
  const { posts, loading } = usePosts();
  const { navigate } = useNavigation();
  const [localPosts, setLocalPosts] = useState(posts);
  const [activeFilter, setActiveFilter] = useState<'all' | 'featured' | 'editors_pick'>('all');
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  // Keep in sync with posts initially
  useState(() => {
    setLocalPosts(posts);
  });

  const displayPosts = localPosts.length > 0 ? localPosts : posts;

  const filtered = displayPosts.filter(p => {
    const matchesSearch = p.title.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (activeFilter === 'featured') return p.featured;
    if (activeFilter === 'editors_pick') return p.editors_pick;
    return true;
  });

  const toggleFlag = async (id: string, field: 'featured' | 'editors_pick', current: boolean) => {
    setUpdating(id);
    const nextVal = !current;
    setLocalPosts(prev => prev.map(p => p.id === id ? { ...p, [field]: nextVal } : p));
    await supabase.from('posts').update({ [field]: nextVal }).eq('id', id);
    setUpdating(null);
  };

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-2xl text-gray-900">Featured Content</h1>
        <p className="text-gray-500 text-sm mt-1">Control which articles appear as featured, trending, or editor's picks on the homepage</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="relative max-w-md w-full">
          <Search size={16} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search articles..."
            className="w-full bg-white border border-gray-200 pl-10 pr-4 py-2.5 rounded text-sm focus:outline-none focus:border-bronze"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-sm text-xs">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 rounded-xs transition-all ${activeFilter === 'all' ? 'bg-white text-charcoal font-medium shadow-xs' : 'text-charcoal-muted hover:text-charcoal'}`}
          >
            All Articles ({displayPosts.length})
          </button>
          <button
            onClick={() => setActiveFilter('featured')}
            className={`px-3 py-1.5 rounded-xs transition-all flex items-center gap-1.5 ${activeFilter === 'featured' ? 'bg-white text-bronze font-medium shadow-xs' : 'text-charcoal-muted hover:text-charcoal'}`}
          >
            <Star size={13} fill={activeFilter === 'featured' ? 'currentColor' : 'none'} />
            Featured ({displayPosts.filter(p => p.featured).length})
          </button>
          <button
            onClick={() => setActiveFilter('editors_pick')}
            className={`px-3 py-1.5 rounded-xs transition-all flex items-center gap-1.5 ${activeFilter === 'editors_pick' ? 'bg-white text-bronze font-medium shadow-xs' : 'text-charcoal-muted hover:text-charcoal'}`}
          >
            <Sparkles size={13} fill={activeFilter === 'editors_pick' ? 'currentColor' : 'none'} />
            Editor's Picks ({displayPosts.filter(p => p.editors_pick).length})
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Title</th>
              <th className="text-center px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Featured</th>
              <th className="text-center px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Editor's Pick</th>
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 50).map(post => (
              <tr key={post.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-5 py-3">
                  <a
                    href={`/admin/articles/${post.id}`}
                    onClick={e => {
                      if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                        e.preventDefault();
                        navigate({ name: 'admin-article-edit', id: post.id });
                      }
                    }}
                    className="text-left block group"
                  >
                    <p className="font-medium text-gray-900 group-hover:text-bronze transition-colors">{post.title}</p>
                    <p className="text-xs text-gray-500">{post.category?.name || 'Uncategorized'}</p>
                  </a>
                </td>
                <td className="px-5 py-3 text-center">
                  <button
                    onClick={() => toggleFlag(post.id, 'featured', post.featured)}
                    disabled={updating === post.id}
                    title={post.featured ? 'Click to unfeature' : 'Click to feature on homepage'}
                    className={`p-2 rounded transition-colors ${post.featured ? 'text-bronze bg-bronze/10' : 'text-gray-300 hover:text-gray-400'}`}
                  >
                    <Star size={18} fill={post.featured ? 'currentColor' : 'none'} />
                  </button>
                </td>
                <td className="px-5 py-3 text-center">
                  <button
                    onClick={() => toggleFlag(post.id, 'editors_pick', post.editors_pick)}
                    disabled={updating === post.id}
                    title={post.editors_pick ? "Click to remove editor's pick" : "Click to mark as editor's pick"}
                    className={`p-2 rounded transition-colors ${post.editors_pick ? 'text-bronze bg-bronze/10' : 'text-gray-300 hover:text-gray-400'}`}
                  >
                    <Sparkles size={18} fill={post.editors_pick ? 'currentColor' : 'none'} />
                  </button>
                </td>
                <td className="px-5 py-3">
                  <a
                    href={`/article/${post.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-bronze hover:underline font-medium inline-flex items-center gap-1"
                  >
                    View Live
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
