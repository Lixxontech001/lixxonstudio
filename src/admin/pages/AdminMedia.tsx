import { useState, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAdminMedia } from '../../hooks/useSupabase';
import { Upload, Search, Trash2, X } from 'lucide-react';
import type { MediaItem } from '../../lib/types';

export default function AdminMedia() {
  const { media, loading, setMedia } = useAdminMedia();
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList) => {
    setUploading(true);
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const path = `media/${fileName}`;

      const { error: uploadError } = await supabase.storage.from('media').upload(path, file);
      if (uploadError) {
        alert(`Upload failed: ${uploadError.message}`);
        continue;
      }

      const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);

      await supabase.from('media').insert({
        url: urlData.publicUrl,
        alt_text: '',
        title: file.name,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
      });
    }
    setUploading(false);
if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (item: MediaItem) => {
    if (!confirm(`Delete this image? It may be in use by articles.`)) return;
    if (item.file_name) {
      const path = `media/${item.url.split('/').pop()}`;
      await supabase.storage.from('media').remove([path]);
    }
    await supabase.from('media').delete().eq('id', item.id);
    setMedia(prev => prev.filter(m => m.id !== item.id));
  };

  const updateMedia = async (id: string, updates: Partial<MediaItem>) => {
    await supabase.from('media').update(updates).eq('id', id);
    setMedia(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const filtered = media.filter(m =>
    m.title?.toLowerCase().includes(search.toLowerCase()) ||
    m.alt_text?.toLowerCase().includes(search.toLowerCase()) ||
    m.file_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-2xl text-gray-900">Media Library</h1>
          <p className="text-gray-500 text-sm mt-1">Upload and manage images for articles and categories</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 bg-bronze text-white px-4 py-2.5 rounded text-sm font-medium hover:bg-bronze-dark disabled:opacity-50"
        >
          <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) handleUpload(e.target.files); }}
        />
      </div>

      <div className="relative mb-6 max-w-md">
        <Search size={16} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search media..."
          className="w-full bg-white border border-gray-200 pl-10 pr-4 py-2.5 rounded text-sm focus:outline-none focus:border-bronze"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <p className="text-gray-500 text-sm">No images yet. Upload some to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map(item => (
            <div key={item.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden group">
              <div className="aspect-square overflow-hidden bg-gray-100 relative">
                <img src={item.url} alt={item.alt_text || ''} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <button onClick={() => setEditing(item)} className="bg-white p-2 rounded text-gray-700 hover:text-bronze" title="Edit">
                    <Search size={14} />
                  </button>
                  <button onClick={() => handleDelete(item)} className="bg-white p-2 rounded text-gray-700 hover:text-red-600" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="p-3">
                <p className="text-xs text-gray-700 truncate">{item.title || item.file_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-lg max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-medium text-gray-900">Edit Media</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <img src={editing.url} alt={editing.alt_text || ''} className="w-full rounded" />
              <div>
                {/* <label className="block text-xs text-gray-500 mb-1">Alt Text</label>
                <input
                  type="text"
                  value={editing.alt_text || ''}
                  onChange={e => { const v = e.target.value; setEditing({ ...editing, alt_text: v }); updateMedia(editing.id, { alt_text: v }); }}
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                /> */}
                <label className="block text-xs text-gray-500 mb-1">Alt Text</label>
  <input
    type="text"
    value={editing.alt_text || ''}
    onChange={e => setEditing({ ...editing, alt_text: e.target.value })}
    className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
  />
</div>
{/* ...Same simplified onChange for Title and Caption... */}

{/* Add explicit Save button before closing the modal */}
<div className="flex justify-end gap-2 pt-2">
  <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs text-gray-600 rounded">
    Cancel
  </button>
  <button
    onClick={async () => {
      await updateMedia(editing.id, {
        alt_text: editing.alt_text,
        title: editing.title,
        caption: editing.caption,
      });
      setEditing(null);
    }}
    className="px-4 py-1.5 text-xs bg-bronze text-white rounded"
  >
    Save Changes
  </button>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Title</label>
                <input
                  type="text"
                  value={editing.title || ''}
                  onChange={e => { const v = e.target.value; setEditing({ ...editing, title: v }); updateMedia(editing.id, { title: v }); }}
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Caption</label>
                <input
                  type="text"
                  value={editing.caption || ''}
                  onChange={e => { const v = e.target.value; setEditing({ ...editing, caption: v }); updateMedia(editing.id, { caption: v }); }}
                  className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze"
                />
              </div>
              <div className="text-xs text-gray-400">
                URL: <input type="text" value={editing.url} readOnly className="w-full bg-gray-50 px-2 py-1.5 rounded text-xs font-mono" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
