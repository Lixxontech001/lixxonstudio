import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { usePosts } from '../../hooks/useSupabase';
import { useNavigation } from '../../context/NavigationContext';
import { Star, Sparkles, Search } from 'lucide-react';

export default function AdminFeatured() {
  const { posts, loading } = usePosts();
  const { navigate } = useNavigation();
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  const filtered = posts.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  const toggleFlag = async (id: string, field: 'featured' | 'editors_pick', current: boolean) => {
    setUpdating(id);
    await supabase.from('posts').update({ [field]: !current }).eq('id', id);
    setUpdating(null);
    window.location.reload();
  };

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-2xl text-gray-900">Featured Content</h1>
        <p className="text-gray-500 text-sm mt-1">Control which articles appear as featured, trending, or editor's picks on the homepage</p>
      </div>

      <div className="relative mb-6 max-w-md">
        <Search size={16} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search articles..."
          className="w-full bg-white border border-gray-200 pl-10 pr-4 py-2.5 rounded text-sm focus:outline-none focus:border-bronze"
        />
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
                  <button onClick={() => navigate({ name: 'admin-article-edit', id: post.id })} className="text-left">
                    <p className="font-medium text-gray-900 hover:text-bronze">{post.title}</p>
                    <p className="text-xs text-gray-500">{post.category?.name || 'Uncategorized'}</p>
                  </button>
                </td>
                <td className="px-5 py-3 text-center">
                  <button
                    onClick={() => toggleFlag(post.id, 'featured', post.featured)}
                    disabled={updating === post.id}
                    className={`p-2 rounded transition-colors ${post.featured ? 'text-bronze bg-bronze/10' : 'text-gray-300 hover:text-gray-400'}`}
                  >
                    <Star size={18} fill={post.featured ? 'currentColor' : 'none'} />
                  </button>
                </td>
                <td className="px-5 py-3 text-center">
                  <button
                    onClick={() => toggleFlag(post.id, 'editors_pick', post.editors_pick)}
                    disabled={updating === post.id}
                    className={`p-2 rounded transition-colors ${post.editors_pick ? 'text-bronze bg-bronze/10' : 'text-gray-300 hover:text-gray-400'}`}
                  >
                    <Sparkles size={18} fill={post.editors_pick ? 'currentColor' : 'none'} />
                  </button>
                </td>
                <td className="px-5 py-3">
                  <button
                    onClick={() => navigate({ name: 'article', slug: post.slug })}
                    className="text-xs text-bronze hover:underline"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
