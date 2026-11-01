import { useState, useEffect, useMemo } from 'react';
import { Plus, Edit, Trash2, FolderHeart, ExternalLink, BookOpen, Search, Sparkles } from 'lucide-react';
import { useNavigation } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabaseClient';
import type { Collection } from '../../lib/types';

interface CollectionWithItems extends Collection {
  item_count?: number;
}

export default function AdminCollections() {
  const { navigate } = useNavigation();
  const [collections, setCollections] = useState<CollectionWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadCollections = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('collections')
        .select('*, items:collection_items(id)')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      const formatted = (data || []).map((c: Collection & { items?: { id: string }[] }) => ({
        ...c,
        item_count: c.items?.length || 0,
      }));
      setCollections(formatted);
    } catch {
      // fallback without join
      const { data } = await supabase
        .from('collections')
        .select('*')
        .order('sort_order', { ascending: true });
      setCollections((data || []) as CollectionWithItems[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCollections();
  }, []);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete collection "${title}"? Attached articles will remain in your library.`)) return;
    await supabase.from('collection_items').delete().eq('collection_id', id);
    await supabase.from('collections').delete().eq('id', id);
    setCollections(prev => prev.filter(c => c.id !== id));
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return collections;
    const q = search.toLowerCase();
    return collections.filter(
      c => c.title.toLowerCase().includes(q) || (c.description && c.description.toLowerCase().includes(q))
    );
  }, [collections, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-charcoal font-light">Curated Collections</h1>
          <p className="text-sm text-charcoal-muted mt-1">
            Group editorial guides into thematic reading journeys ({collections.length} total)
          </p>
        </div>
        <a
          href="/admin/collections/new"
          onClick={e => {
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              navigate({ name: 'admin-collection-new' });
            }
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all shadow-sm"
        >
          <Plus size={16} /> New Collection
        </a>
      </div>

      {collections.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-2.5 text-charcoal-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter collections by title or description…"
              className="w-full pl-9 pr-3 py-2 text-xs border border-taupe/60 rounded-sm focus:outline-none focus:border-bronze bg-white"
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-48 rounded-sm bg-taupe/15" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-sm border border-taupe/30 p-8">
          <FolderHeart size={36} strokeWidth={1.5} className="text-bronze/70 mx-auto mb-4" />
          <h3 className="font-serif text-xl text-charcoal mb-2 font-normal">No Collections Created Yet</h3>
          <p className="text-sm text-charcoal-muted max-w-md mx-auto mb-6">
            Create your first curated collection to bundle articles, styling guides, and routines into cohesive, branded reading experiences.
          </p>
          <a
            href="/admin/collections/new"
            onClick={e => {
              if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                navigate({ name: 'admin-collection-new' });
              }
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze-dark transition-all"
          >
            <Plus size={15} /> Create First Collection
          </a>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(c => (
            <div
              key={c.id}
              className="bg-white rounded-sm border border-taupe/30 hover:border-bronze/40 transition-all flex flex-col overflow-hidden shadow-xs group"
            >
              <div className="relative aspect-video bg-charcoal/5 overflow-hidden">
                {c.cover_image ? (
                  <img
                    src={c.cover_image}
                    alt={c.title}
                    className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-charcoal-muted/60 p-4">
                    <FolderHeart size={28} strokeWidth={1.2} />
                    <span className="text-[11px] mt-1 tracking-editorial uppercase">No Cover Image</span>
                  </div>
                )}
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                  {c.is_featured && (
                    <span className="text-[10px] uppercase tracking-editorial px-2 py-0.5 rounded-xs bg-bronze text-white font-medium shadow-xs flex items-center gap-1">
                      <Sparkles size={10} /> Featured
                    </span>
                  )}
                  <span
                    className={`text-[10px] uppercase tracking-editorial px-2 py-0.5 rounded-xs font-medium shadow-xs ${
                      c.is_active ? 'bg-emerald-600 text-white' : 'bg-charcoal/60 text-white'
                    }`}
                  >
                    {c.is_active ? 'Live' : 'Hidden'}
                  </span>
                </div>
              </div>

              <div className="p-5 flex-1 flex flex-col">
                <div className="flex items-center gap-1.5 text-xs text-charcoal-muted mb-1.5">
                  <BookOpen size={13} className="text-bronze" />
                  <span>
                    {c.item_count === 1 ? '1 Article' : `${c.item_count ?? 0} Articles & Guides`}
                  </span>
                </div>

                <h3 className="font-serif text-lg text-charcoal group-hover:text-bronze transition-colors font-medium">
                  {c.title}
                </h3>
                {c.description && (
                  <p className="text-xs text-charcoal-muted mt-1.5 line-clamp-2 leading-relaxed">
                    {c.description}
                  </p>
                )}

                <div className="flex items-center justify-between gap-3 mt-auto pt-4 border-t border-taupe/20">
                  <div className="flex items-center gap-3">
                    <a
                      href={`/admin/collections/${c.id}`}
                      onClick={e => {
                        if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                          e.preventDefault();
                          navigate({ name: 'admin-collection-edit', id: c.id });
                        }
                      }}
                      className="text-xs font-medium text-bronze hover:text-bronze-dark transition-colors flex items-center gap-1"
                    >
                      <Edit size={13} /> Edit Collection
                    </a>

                    {c.slug && (
                      <a
                        href={`/collections/${c.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-charcoal-muted hover:text-charcoal transition-colors flex items-center gap-1"
                        title="View public collection page"
                      >
                        <ExternalLink size={12} /> Public Page
                      </a>
                    )}
                  </div>

                  <button
                    onClick={() => handleDelete(c.id, c.title)}
                    className="text-charcoal-muted/60 hover:text-red-600 transition-colors p-1"
                    title="Delete collection"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
