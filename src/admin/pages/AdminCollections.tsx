import { useState } from 'react';
import { Plus, Edit, Trash2, FolderHeart } from 'lucide-react';
import { useAdminCollections } from '../../hooks/useCommerce';
import { useNavigation } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabaseClient';
import type { Collection } from '../../lib/types';

export default function AdminCollections() {
  const { collections, loading, setCollections } = useAdminCollections();
  const { navigate } = useNavigation();

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this collection?')) return;
    await supabase.from('collections').delete().eq('id', id);
    setCollections(prev => prev.filter(c => c.id !== id));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-charcoal font-light">Collections</h1>
          <p className="text-sm text-charcoal-muted mt-1">{collections.length} total</p>
        </div>
        <button onClick={() => navigate({ name: 'admin-collection-new' })} className="inline-flex items-center gap-2 px-4 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all">
          <Plus size={16} /> New Collection
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-24 rounded-sm" />)}</div>
      ) : collections.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-sm border border-taupe/30">
          <FolderHeart size={32} strokeWidth={1.5} className="text-charcoal-muted mx-auto mb-4" />
          <p className="text-charcoal-muted">No collections yet. Create one to group articles into curated reading journeys.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map((c: Collection) => (
            <div key={c.id} className="bg-white rounded-sm border border-taupe/30 p-5">
              {c.cover_image && <img src={c.cover_image} alt="" className="w-full h-32 object-cover rounded-sm mb-3" />}
              <h3 className="font-serif text-lg text-charcoal">{c.title}</h3>
              <p className="text-xs text-charcoal-muted mt-1 line-clamp-2">{c.description}</p>
              <div className="flex items-center gap-2 mt-3">
                {c.is_featured && <span className="text-xs px-2 py-1 rounded-full bg-bronze/10 text-bronze">Featured</span>}
                <span className={`text-xs px-2 py-1 rounded-full ${c.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.is_active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="flex items-center gap-3 mt-4 pt-3 border-t border-taupe/30">
                <button onClick={() => navigate({ name: 'admin-collection-edit', id: c.id })} className="text-charcoal-muted hover:text-bronze transition-colors text-xs flex items-center gap-1"><Edit size={14} /> Edit</button>
                <button onClick={() => handleDelete(c.id)} className="text-charcoal-muted hover:text-red-600 transition-colors text-xs flex items-center gap-1 ml-auto"><Trash2 size={14} /> Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
