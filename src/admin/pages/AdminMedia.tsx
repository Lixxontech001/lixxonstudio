import { useState, useRef, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAdminMedia } from '../../hooks/useSupabase';
import { Upload, Search, Trash2, X, Copy, Check, AlertTriangle, Link2, Pencil } from 'lucide-react';
import type { MediaItem } from '../../lib/types';
import { optimizeAdminImage } from '../../lib/imageUpload';

const fmtSize = (n: number | null) => !n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

type Usage = Record<string, { posts: string[]; products: string[] }>;

export default function AdminMedia() {
  const { media, loading, setMedia } = useAdminMedia();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'missing-alt' | 'unused'>('all');
  const [uploading, setUploading] = useState<string | null>(null);
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Usage tracking: which posts / products reference each image URL
  useEffect(() => {
    if (media.length === 0) return;
    (async () => {
      const [{ data: posts }, { data: products }] = await Promise.all([
        supabase.from('posts').select('id, title, cover_image, content'),
        supabase.from('products').select('id, name, image_url, gallery'),
      ]);
      const u: Usage = {};
      for (const m of media) {
        const key = m.url.split('/').pop() || m.url;
        u[m.id] = {
          posts: (posts || []).filter((p: { cover_image: string | null; content: string | null }) => (p.cover_image || '').includes(key) || (p.content || '').includes(key)).map((p: { title: string }) => p.title),
          products: (products || []).filter((p: { image_url: string | null; gallery: string[] | null }) => (p.image_url || '').includes(key) || (p.gallery || []).some(g => g.includes(key))).map((p: { name: string }) => p.name),
        };
      }
      setUsage(u);
    })();
  }, [media]);

  const handleUpload = async (files: FileList) => {
    const list = Array.from(files);
    let i = 0;
    for (const file of list) {
      i++;
      setUploading(`Uploading ${i}/${list.length}…`);
      // Alt text is required: ask up-front, pre-filled from the file name
      const suggested = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      const alt = window.prompt(`Alt text for "${file.name}" (describe the image for screen readers):`, suggested);
      if (alt === null) continue;
      if (!alt.trim()) { alert('Alt text is required for accessibility. Skipped.'); continue; }

      const { blob, width, height, contentType, extension } = await optimizeAdminImage(file, 1600, 0.78);
      const path = `media/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('media').upload(path, blob, { contentType, cacheControl: '31536000' });
      if (uploadError) { alert(`Upload failed: ${uploadError.message}`); continue; }
      const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
      const { data: row } = await supabase.from('media').insert({
        url: urlData.publicUrl, alt_text: alt.trim(), title: suggested, file_name: file.name,
        file_size: blob.size, mime_type: contentType, width: width || null, height: height || null,
      }).select('*').single();
      if (row) setMedia(prev => [row as MediaItem, ...prev]);
    }
    setUploading(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (item: MediaItem) => {
    const used = usage[item.id];
    const where = used ? [...used.posts, ...used.products] : [];
    const msg = where.length ? `This image is used by: ${where.slice(0, 5).join(', ')}${where.length > 5 ? '…' : ''}.\n\nDeleting it will break those pages. Continue?` : 'Delete this image permanently?';
    if (!confirm(msg)) return;
    const path = `media/${item.url.split('/').pop()}`;
    await supabase.storage.from('media').remove([path]);
    await supabase.from('media').delete().eq('id', item.id);
    setMedia(prev => prev.filter(m => m.id !== item.id));
  };

  const updateMedia = async (id: string, updates: Partial<MediaItem>) => {
    await supabase.from('media').update(updates).eq('id', id);
    setMedia(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const copyUrl = async (item: MediaItem) => {
    await navigator.clipboard.writeText(item.url);
    setCopied(item.id); setTimeout(() => setCopied(null), 1500);
  };

  const filtered = useMemo(() => media.filter(m => {
    const q = search.toLowerCase();
    const matches = !q || m.title?.toLowerCase().includes(q) || m.alt_text?.toLowerCase().includes(q) || m.file_name?.toLowerCase().includes(q);
    if (!matches) return false;
    if (filter === 'missing-alt') return !m.alt_text?.trim();
    if (filter === 'unused') { const u = usage[m.id]; return u ? u.posts.length + u.products.length === 0 : false; }
    return true;
  }), [media, search, filter, usage]);

  const missingAlt = media.filter(m => !m.alt_text?.trim()).length;
  const totalBytes = media.reduce((s, m) => s + (m.file_size || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-2xl text-gray-900">Media Library</h1>
          <p className="text-gray-500 text-sm mt-1">{media.length} files · {fmtSize(totalBytes)} of the 1 GB free Storage tier · images are compressed in your browser before upload</p>
        </div>
        <button onClick={() => fileInputRef.current?.click()} disabled={!!uploading} className="inline-flex items-center gap-2 bg-bronze text-white px-4 py-2.5 rounded text-sm font-medium hover:bg-bronze-dark disabled:opacity-50">
          <Upload size={16} /> {uploading || 'Upload'}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files) handleUpload(e.target.files); }} />
      </div>

      {missingAlt > 0 && (
        <button onClick={() => setFilter('missing-alt')} className="mb-4 w-full text-left flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2.5 rounded">
          <AlertTriangle size={14} /> {missingAlt} image{missingAlt > 1 ? 's are' : ' is'} missing alt text — click to review.
        </button>
      )}

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={16} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search media..." className="w-full bg-white border border-gray-200 pl-10 pr-4 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="bg-white border border-gray-200 px-3 py-2.5 rounded text-sm">
          <option value="all">All files</option>
          <option value="missing-alt">Missing alt text</option>
          <option value="unused">Unused</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center"><p className="text-gray-500 text-sm">No images match.</p></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map(item => {
            const u = usage[item.id]; const uses = u ? u.posts.length + u.products.length : null;
            return (
              <div key={item.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden group">
                <div className="aspect-square overflow-hidden bg-gray-100 relative">
                  <img src={item.url} alt={item.alt_text || ''} loading="lazy" className="w-full h-full object-cover" />
                  {!item.alt_text?.trim() && <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded">No alt</span>}
                  {uses !== null && <span className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded ${uses ? 'bg-black/60 text-white' : 'bg-gray-200 text-gray-600'}`}><Link2 size={9} className="inline mr-0.5" />{uses}</span>}
                  <div className="absolute inset-0 bg-black/25 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 hover-reveal">
                    <button onClick={() => setEditing(item)} className="bg-white p-2 rounded text-gray-700 hover:text-bronze" title="Edit"><Pencil size={14} /></button>
                    <button onClick={() => copyUrl(item)} className="bg-white p-2 rounded text-gray-700 hover:text-bronze" title="Copy URL">{copied === item.id ? <Check size={14} /> : <Copy size={14} />}</button>
                    <button onClick={() => handleDelete(item)} className="bg-white p-2 rounded text-gray-700 hover:text-red-600" title="Delete"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-xs text-gray-700 truncate">{item.title || item.file_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{item.width && item.height ? `${item.width}×${item.height} · ` : ''}{fmtSize(item.file_size)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditing(null)}>
          <div role="dialog" aria-modal="true" className="bg-white rounded-lg max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-medium text-gray-900">Edit media</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400" aria-label="Close"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <img src={editing.url} alt={editing.alt_text || ''} className="w-full rounded" />
              <div>
                <label className="block text-xs text-gray-500 mb-1">Alt text <span className="text-red-500">*</span></label>
                <input type="text" value={editing.alt_text || ''} onChange={e => setEditing({ ...editing, alt_text: e.target.value })} className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Title</label>
                <input type="text" value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Caption</label>
                <input type="text" value={editing.caption || ''} onChange={e => setEditing({ ...editing, caption: e.target.value })} className="w-full border border-gray-200 px-3 py-2 rounded text-sm focus:outline-none focus:border-bronze" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">URL</label>
                <div className="flex gap-2"><input readOnly value={editing.url} className="flex-1 border border-gray-200 px-3 py-2 rounded text-xs bg-gray-50" /><button onClick={() => copyUrl(editing)} className="px-3 border border-gray-200 rounded text-xs">{copied === editing.id ? 'Copied' : 'Copy'}</button></div>
              </div>
              {usage[editing.id] && (
                <div className="text-xs text-gray-600">
                  <p className="font-medium text-gray-800 mb-1">Used in</p>
                  {usage[editing.id].posts.length + usage[editing.id].products.length === 0 ? <p className="text-gray-400">Not referenced by any article or product.</p> : (
                    <ul className="list-disc ml-4 space-y-0.5">{usage[editing.id].posts.map(t => <li key={`p-${t}`}>Article: {t}</li>)}{usage[editing.id].products.map(t => <li key={`x-${t}`}>Product: {t}</li>)}</ul>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs text-gray-600 rounded">Cancel</button>
                <button
                  onClick={async () => {
                    if (!editing.alt_text?.trim()) { alert('Alt text is required.'); return; }
                    await updateMedia(editing.id, { alt_text: editing.alt_text.trim(), title: editing.title, caption: editing.caption });
                    setEditing(null);
                  }}
                  className="px-4 py-1.5 text-xs bg-bronze text-white rounded"
                >Save changes</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
