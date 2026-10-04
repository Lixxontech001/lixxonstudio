import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAdminAuthors } from '../../hooks/useSupabase';
import { Plus, Pencil, X } from 'lucide-react';
import type { Author } from '../../lib/types';
import { MarkdownField } from '../components/AdminEditorKit';

export default function AdminAuthors() {
  const { authors, loading } = useAdminAuthors();
  const [editing, setEditing] = useState<Author | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [role, setRole] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [twitter, setTwitter] = useState('');
  const [instagram, setInstagram] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [website, setWebsite] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (a: Author) => {
    setEditing(a);
    setName(a.name); setSlug(a.slug); setBio(a.bio || ''); setAvatarUrl(a.avatar_url || '');
    setRole(a.role || ''); setIsActive(a.is_active);
    setTwitter(a.social_links?.twitter || '');
    setInstagram(a.social_links?.instagram || '');
    setLinkedin(a.social_links?.linkedin || '');
    setWebsite(a.social_links?.website || '');
    setShowForm(true);
  };

  const startNew = () => {
    setEditing(null);
    setName(''); setSlug(''); setBio(''); setAvatarUrl(''); setRole(''); setIsActive(true);
    setTwitter(''); setInstagram(''); setLinkedin(''); setWebsite('');
    setShowForm(true);
  };

  const save = async () => {
    setSaving(true);
    const payload = {
      name: name.trim(),
      slug: slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') || name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      bio: bio || null,
      avatar_url: avatarUrl || null,
      role: role || null,
      is_active: isActive,
      social_links: { twitter: twitter || null, instagram: instagram || null, linkedin: linkedin || null, website: website || null },
    };

    if (editing) {
      await supabase.from('authors').update(payload).eq('id', editing.id);
    } else {
      await supabase.from('authors').insert(payload);
    }
    setSaving(false);
    setShowForm(false);
    window.location.reload();
  };

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-gray-900">Authors</h1>
          <p className="text-gray-500 text-sm mt-1">Manage editorial profiles</p>
        </div>
        <button onClick={startNew} className="inline-flex items-center gap-2 bg-bronze text-white px-4 py-2.5 rounded text-sm font-medium hover:bg-bronze-dark">
          <Plus size={16} /> New Author
        </button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {authors.map(a => (
          <div key={a.id} className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-start gap-3">
              {a.avatar_url ? (
                <img src={a.avatar_url} alt={a.name} className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-medium text-sm">
                  {a.name.charAt(0)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900 truncate">{a.name}</h3>
                <p className="text-xs text-gray-500">{a.role || 'Contributor'}</p>
                {!a.is_active && <span className="text-xs text-red-500">Inactive</span>}
              </div>
              <button onClick={() => startEdit(a)} className="p-1.5 text-gray-400 hover:text-bronze"><Pencil size={14} /></button>
            </div>
            {a.bio && <p className="text-sm text-gray-600 mt-3 line-clamp-3">{a.bio}</p>}
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-medium text-gray-900">{editing ? 'Edit Author' : 'New Author'}</h3>
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
              <div>
                <label className="block text-xs text-gray-500 mb-1">Role</label>
                <input type="text" value={role} onChange={e => setRole(e.target.value)} placeholder="Editor, Writer, etc." className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
              </div>
              <MarkdownField
                label="Bio"
                value={bio}
                onChange={setBio}
                rows={4}
                max={900}
                hint="A concise editorial bio. It appears on the author page and article header."
              />
              <div>
                <label className="block text-xs text-gray-500 mb-1">Avatar URL</label>
                <input type="text" value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} placeholder="https://..." className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Twitter</label>
                  <input type="text" value={twitter} onChange={e => setTwitter(e.target.value)} className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Instagram</label>
                  <input type="text" value={instagram} onChange={e => setInstagram(e.target.value)} className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">LinkedIn</label>
                  <input type="text" value={linkedin} onChange={e => setLinkedin(e.target.value)} className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Website</label>
                  <input type="text" value={website} onChange={e => setWebsite(e.target.value)} className="w-full border border-gray-200 px-3 py-2.5 rounded text-sm focus:outline-none focus:border-bronze" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                Active (visible publicly)
              </label>
              <button onClick={save} disabled={saving} className="w-full bg-bronze text-white py-2.5 rounded text-sm font-medium hover:bg-bronze-dark disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Author'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
