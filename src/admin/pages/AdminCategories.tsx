import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useCategories } from '../../hooks/useSupabase';
import { Plus, Pencil, Trash2, X, FolderTree } from 'lucide-react';
import type { Category } from '../../lib/types';
import { MarkdownField } from '../components/AdminEditorKit';

export default function AdminCategories() {
  const { categories, loading } = useCategories();
  const [editing, setEditing] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [bannerImage, setBannerImage] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (cat: Category) => {
    setEditing(cat);
    setName(cat.name);
    setSlug(cat.slug);
    setDescription(cat.description || '');
    setSortOrder(cat.sort_order);
    setBannerImage(cat.banner_image || '');
    setSeoTitle(cat.seo_title || '');
    setSeoDescription(cat.seo_description || '');
    setShowForm(true);
  };

  const startNew = () => {
    setEditing(null);
    setName(''); setSlug(''); setDescription(''); setSortOrder(0);
    setBannerImage(''); setSeoTitle(''); setSeoDescription('');
    setShowForm(true);
  };

  const save = async () => {
    setSaving(true);
    const payload = {
      name: name.trim(),
      slug: slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      description: description || null,
      sort_order: sortOrder,
      banner_image: bannerImage || null,
      seo_title: seoTitle || null,
      seo_description: seoDescription || null,
    };

    if (editing) {
      await supabase.from('categories').update(payload).eq('id', editing.id);
    } else {
      await supabase.from('categories').insert(payload);
    }

    setSaving(false);
    setShowForm(false);
    window.location.reload();
  };

  const handleDelete = async (cat: Category) => {
    if (!confirm(`Archive category "${cat.name}"? Articles in this category will remain.`)) return;
    await supabase.from('categories').update({ is_active: false }).eq('id', cat.id);
    window.location.reload();
  };

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-gray-900">Categories</h1>
          <p className="text-gray-500 text-sm mt-1">Organize your content sections</p>
        </div>
        <button onClick={startNew} className="inline-flex items-center gap-2 bg-bronze text-white px-4 py-2.5 rounded text-sm font-medium hover:bg-bronze-dark">
          <Plus size={16} /> New Category
        </button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map(cat => (
          <div key={cat.id} className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <FolderTree size={18} className="text-bronze" />
                <h3 className="font-medium text-gray-900">{cat.name}</h3>
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(cat)} className="p-1.5 text-gray-400 hover:text-bronze"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(cat)} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
            <p className="text-xs text-gray-500 font-mono">/{cat.slug}</p>
            {cat.description && <p className="text-sm text-gray-600 mt-2">{cat.description}</p>}
            <p className="text-xs text-gray-400 mt-2">Sort order: {cat.sort_order}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-medium text-gray-900">{editing ? 'Edit Category' : 'New Category'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <input type="text" value={name} onChange={e => { setName(e.target.value); if (!editing) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')); }} className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Slug</label>
                <input type="text" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm font-mono focus:outline-none focus:border-bronze" />
              </div>
              <MarkdownField
                label="Description"
                value={description}
                onChange={setDescription}
                rows={3}
                max={600}
                hint="The short introduction shown above this category."
              />
              <div>
                <label className="block text-xs text-gray-500 mb-1">Sort Order</label>
                <input type="number" value={sortOrder} onChange={e => setSortOrder(parseInt(e.target.value) || 0)} className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Banner Image URL</label>
                <input type="text" value={bannerImage} onChange={e => setBannerImage(e.target.value)} placeholder="https://..." className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">SEO Title (optional)</label>
                <input type="text" value={seoTitle} onChange={e => setSeoTitle(e.target.value)} className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
              </div>
              <MarkdownField
                label="SEO Description"
                value={seoDescription}
                onChange={setSeoDescription}
                rows={2}
                min={110}
                max={160}
                hint="Keep this between 110 and 160 characters."
              />
              <button onClick={save} disabled={saving} className="w-full bg-bronze text-white py-2.5 rounded text-sm font-medium hover:bg-bronze-dark disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Category'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
