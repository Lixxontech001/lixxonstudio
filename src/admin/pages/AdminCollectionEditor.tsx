import { useState, useEffect } from 'react';
import {ArrowLeft, Save, Plus, X} from 'lucide-react';
import { useNavigation } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabaseClient';
import type { Post } from '../../lib/types';

interface CollectionForm {
  title: string; slug: string; description: string; cover_image: string;
  is_featured: boolean; is_active: boolean; sort_order: number;
}

export default function AdminCollectionEditor({ collectionId, isNew }: { collectionId?: string; isNew?: boolean }) {
  const { navigate } = useNavigation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState<CollectionForm>({
    title: '', slug: '', description: '', cover_image: '', is_featured: false, is_active: true, sort_order: 0,
  });

  const [articleSearch, setArticleSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Post[]>([]);
  const [selectedArticles, setSelectedArticles] = useState<{ id: string; title: string; sort_order: number }[]>([]);

  useEffect(() => {
    if (!isNew && collectionId) {
      supabase.from('collections').select('*').eq('id', collectionId).maybeSingle().then(({ data }) => {
        if (data) setForm({ title: data.title, slug: data.slug, description: data.description || '', cover_image: data.cover_image || '', is_featured: data.is_featured, is_active: data.is_active, sort_order: data.sort_order || 0 });
      });
      supabase.from('collection_items').select('post_id, sort_order, post:posts(id, title)').eq('collection_id', collectionId).order('sort_order').then(({ data }) => {
        if (data) setSelectedArticles((data as unknown as { post_id: string; sort_order: number; post: { id: string; title: string } | null }[]).map((d) => ({ id: d.post_id, title: d.post?.title || 'Untitled', sort_order: d.sort_order })));
      });
    }
  }, [collectionId, isNew]);

  const searchArticles = async (q: string) => {
    setArticleSearch(q);
    if (q.length < 2) { setSearchResults([]); return; }
    const { data } = await supabase.from('posts').select('id, title').ilike('title', `%${q}%`).eq('status', 'published').limit(10);
    setSearchResults((data || []) as Post[]);
  };

  const addArticle = (post: Post) => {
    if (selectedArticles.find(a => a.id === post.id)) return;
    setSelectedArticles(prev => [...prev, { id: post.id, title: post.title, sort_order: prev.length }]);
    setArticleSearch(''); setSearchResults([]);
  };

  const removeArticle = (id: string) => {
    setSelectedArticles(prev => prev.filter(a => a.id !== id).map((a, i) => ({ ...a, sort_order: i })));
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    const slug = form.slug || form.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try {
      let id = collectionId;
      if (isNew) {
        const { data, error: e } = await supabase.from('collections').insert({ ...form, slug }).select().single();
        if (e) throw e;
        id = data.id;
      } else {
        const { error: e } = await supabase.from('collections').update({ ...form, slug, updated_at: new Date().toISOString() }).eq('id', collectionId);
        if (e) throw e;
      }

      if (id) {
        await supabase.from('collection_items').delete().eq('collection_id', id);
        if (selectedArticles.length > 0) {
          await supabase.from('collection_items').insert(selectedArticles.map(a => ({ collection_id: id, post_id: a.id, sort_order: a.sort_order })));
        }
      }
      setTimeout(() => navigate({ name: 'admin-collections' }), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
    setSaving(false);
  };

  const inputClass = "w-full bg-white border border-taupe/50 px-3 py-2.5 text-sm text-charcoal rounded-sm focus:outline-none focus:border-bronze transition-colors";
  const labelClass = "block text-[10px] tracking-editorial uppercase text-charcoal-muted mb-1.5";

  return (
    <div>
      <button onClick={() => navigate({ name: 'admin-collections' })} className="inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors mb-6">
        <ArrowLeft size={14} /> Back to Collections
      </button>
      <h1 className="font-serif text-3xl text-charcoal font-light mb-8">{isNew ? 'New Collection' : 'Edit Collection'}</h1>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-sm mb-6">{error}</div>}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div><label className={labelClass}>Title</label><input className={inputClass} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
          <div><label className={labelClass}>Slug</label><input className={inputClass} value={form.slug} onChange={e => setForm(p => ({ ...p, slug: e.target.value }))} /></div>
          <div><label className={labelClass}>Description</label><textarea className={inputClass} rows={3} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
          <div><label className={labelClass}>Cover Image URL</label><input className={inputClass} value={form.cover_image} onChange={e => setForm(p => ({ ...p, cover_image: e.target.value }))} /></div>
          <div><label className={labelClass}>Sort Order</label><input type="number" className={inputClass} value={form.sort_order} onChange={e => setForm(p => ({ ...p, sort_order: parseInt(e.target.value) || 0 }))} /></div>
          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-3 text-sm text-charcoal"><input type="checkbox" checked={form.is_featured} onChange={e => setForm(p => ({ ...p, is_featured: e.target.checked }))} className="accent-bronze" /> Featured</label>
            <label className="flex items-center gap-3 text-sm text-charcoal"><input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="accent-bronze" /> Active</label>
          </div>
        </div>

        <div>
          <label className={labelClass}>Articles in this collection</label>
          <div className="relative mb-4">
            <input type="text" value={articleSearch} onChange={e => searchArticles(e.target.value)} placeholder="Search articles to add..." className={inputClass} />
            {searchResults.length > 0 && (
              <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-taupe/50 rounded-sm shadow-lg max-h-48 overflow-y-auto">
                {searchResults.map(p => (
                  <button key={p.id} onClick={() => addArticle(p)} className="w-full text-left px-3 py-2 text-sm text-charcoal hover:bg-taupe-light/40 flex items-center gap-2">
                    <Plus size={14} className="text-bronze" /> {p.title}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            {selectedArticles.length === 0 ? (
              <p className="text-sm text-charcoal-muted italic">No articles added yet. Search above to add articles to this collection.</p>
            ) : (
              selectedArticles.map((a, i) => (
                <div key={a.id} className="flex items-center gap-3 bg-white border border-taupe/30 rounded-sm px-3 py-2">
                  <span className="text-xs text-bronze w-6">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-sm text-charcoal flex-1 truncate">{a.title}</span>
                  <button onClick={() => removeArticle(a.id)} className="text-charcoal-muted hover:text-red-600 transition-colors"><X size={14} /></button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-8 pt-6 border-t border-taupe/30">
        <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-6 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-60">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Collection'}
        </button>
        <button onClick={() => navigate({ name: 'admin-collections' })} className="text-xs text-charcoal-muted hover:text-charcoal tracking-editorial uppercase ml-auto">Cancel</button>
      </div>
    </div>
  );
}
