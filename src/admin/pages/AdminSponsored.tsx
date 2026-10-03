import { useState, useEffect } from 'react';
import { Plus, Trash2, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import type { SponsoredContent, Post } from '../../lib/types';

export default function AdminSponsored() {
  const [sponsored, setSponsored] = useState<(SponsoredContent & { post?: Post })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [articleSearch, setArticleSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Post[]>([]);
  const [form, setForm] = useState({ post_id: '', sponsor_name: '', campaign_name: '', start_date: '', end_date: '' });

  useEffect(() => {
    fetchSponsored();
  }, []);

  const fetchSponsored = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('sponsored_content')
      .select('*, post:posts(*)')
      .order('created_at', { ascending: false });
    setSponsored((data || []) as (SponsoredContent & { post?: Post })[]);
    setLoading(false);
  };

  const searchArticles = async (q: string) => {
    setArticleSearch(q);
    if (q.length < 2) { setSearchResults([]); return; }
    const { data } = await supabase.from('posts').select('id, title, slug').ilike('title', `%${q}%`).limit(10);
    setSearchResults((data || []) as Post[]);
  };

  const handleCreate = async () => {
    if (!form.post_id || !form.sponsor_name) return;
    await supabase.from('sponsored_content').insert({
      post_id: form.post_id,
      sponsor_name: form.sponsor_name,
      campaign_name: form.campaign_name || null,
      start_date: form.start_date ? new Date(form.start_date).toISOString() : null,
      end_date: form.end_date ? new Date(form.end_date).toISOString() : null,
      is_active: true,
    });
    setForm({ post_id: '', sponsor_name: '', campaign_name: '', start_date: '', end_date: '' });
    setShowForm(false); setArticleSearch(''); setSearchResults([]);
    fetchSponsored();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this sponsored content entry?')) return;
    await supabase.from('sponsored_content').delete().eq('id', id);
    setSponsored(prev => prev.filter(s => s.id !== id));
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from('sponsored_content').update({ is_active: !current }).eq('id', id);
    setSponsored(prev => prev.map(s => s.id === id ? { ...s, is_active: !current } : s));
  };

  const inputClass = "w-full bg-white border border-taupe/50 px-3 py-2.5 text-sm text-charcoal rounded-sm focus:outline-none focus:border-bronze transition-colors";
  const labelClass = "block text-[10px] tracking-editorial uppercase text-charcoal-muted mb-1.5";

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-charcoal font-light">Sponsored Content</h1>
          <p className="text-sm text-charcoal-muted mt-1">Manage paid placements and sponsor relationships</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all">
          <Plus size={16} /> Add Sponsored
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-sm border border-taupe/30 p-6 mb-6 space-y-4">
          <div>
            <label className={labelClass}>Article</label>
            <div className="relative">
              <input type="text" value={articleSearch} onChange={e => searchArticles(e.target.value)} placeholder="Search for an article..." className={inputClass} />
              {searchResults.length > 0 && (
                <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-taupe/50 rounded-sm shadow-lg max-h-48 overflow-y-auto">
                  {searchResults.map(p => (
                    <button key={p.id} onClick={() => { setForm(f => ({ ...f, post_id: p.id })); setArticleSearch(p.title); setSearchResults([]); }} className="w-full text-left px-3 py-2 text-sm text-charcoal hover:bg-taupe-light/40">
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div><label className={labelClass}>Sponsor Name</label><input className={inputClass} value={form.sponsor_name} onChange={e => setForm(f => ({ ...f, sponsor_name: e.target.value }))} /></div>
          <div><label className={labelClass}>Campaign Name / Reference</label><input className={inputClass} value={form.campaign_name} onChange={e => setForm(f => ({ ...f, campaign_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelClass}>Start Date</label><input type="date" className={inputClass} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
            <div><label className={labelClass}>End Date</label><input type="date" className={inputClass} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
          </div>
          <button onClick={handleCreate} disabled={!form.post_id || !form.sponsor_name} className="inline-flex items-center gap-2 px-4 py-2.5 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all disabled:opacity-50">
            Create Entry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[...Array(2)].map((_, i) => <div key={i} className="skeleton h-20 rounded-sm" />)}</div>
      ) : sponsored.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-sm border border-taupe/30">
          <ShieldCheck size={32} strokeWidth={1.5} className="text-charcoal-muted mx-auto mb-4" />
          <p className="text-charcoal-muted">No sponsored content configured.</p>
          <p className="text-xs text-charcoal-muted mt-2">Sponsored placements will only appear when you create them here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sponsored.map(s => (
            <div key={s.id} className="bg-white rounded-sm border border-taupe/30 p-5 flex items-start gap-4">
              <div className="flex-1">
                <p className="font-serif text-lg text-charcoal">{s.post?.title || 'Article removed'}</p>
                <p className="text-sm text-charcoal-muted mt-1">Sponsor: {s.sponsor_name}</p>
                {s.campaign_name && <p className="text-xs text-charcoal-muted">Campaign: {s.campaign_name}</p>}
                <div className="flex items-center gap-3 mt-2 text-xs text-charcoal-muted">
                  {s.start_date && <span>From: {new Date(s.start_date).toLocaleDateString()}</span>}
                  {s.end_date && <span>Until: {new Date(s.end_date).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => toggleActive(s.id, s.is_active)} className={`text-xs px-3 py-1.5 rounded-full ${s.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {s.is_active ? 'Active' : 'Inactive'}
                </button>
                <button onClick={() => handleDelete(s.id)} className="text-charcoal-muted hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
