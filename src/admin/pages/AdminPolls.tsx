import { useState } from 'react';
import { BarChart3, Trash2, Power, Plus, Loader2 } from 'lucide-react';
import { useAdminPolls } from '../../hooks/usePlatform';
import { supabase } from '../../lib/supabaseClient';

export default function AdminPolls() {
  const { polls, loading, toggle, remove, create, refetch } = useAdminPolls();
  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [postId, setPostId] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOptions = options.map(o => o.trim()).filter(Boolean);
    if (!question.trim() || !postId.trim() || cleanOptions.length < 2) return;
    setSaving(true);
    const ok = await create(postId.trim(), question, cleanOptions);
    setSaving(false);
    if (ok) { setShowForm(false); setQuestion(''); setOptions(['', '']); setPostId(''); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal">Article Polls</h1>
          <p className="text-sm text-charcoal-muted mt-1">Manage reader polls attached to articles.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-sm rounded-sm hover:bg-bronze transition-all">
          <Plus size={14} /> New Poll
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-sm p-6 border border-taupe/30 mb-6 space-y-4">
          <div>
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Post ID</label>
            <input value={postId} onChange={e => setPostId(e.target.value)} placeholder="UUID of the article" required className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
          </div>
          <div>
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Question</label>
            <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="What do you think about..." required className="w-full mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
          </div>
          <div>
            <label className="text-xs text-charcoal-muted uppercase tracking-wide">Options</label>
            <div className="space-y-2 mt-1">
              {options.map((opt, i) => (
                <div key={i} className="flex gap-2">
                  <input value={opt} onChange={e => setOptions(prev => prev.map((o, j) => j === i ? e.target.value : o))} placeholder={`Option ${i + 1}`} className="flex-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
                  {options.length > 2 && <button type="button" onClick={() => setOptions(prev => prev.filter((_, j) => j !== i))} className="text-charcoal-muted hover:text-red-500"><Trash2 size={14} /></button>}
                </div>
              ))}
              <button type="button" onClick={() => setOptions(prev => [...prev, ''])} className="text-xs text-bronze hover:text-bronze-dark">+ Add option</button>
            </div>
          </div>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-sm rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create Poll
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : polls.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No polls yet.</div>
      ) : (
        <div className="space-y-3">
          {polls.map(p => (
            <div key={p.id} className="bg-white rounded-sm border border-taupe/30 p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 size={14} className="text-bronze" />
                    <span className="text-sm font-medium text-charcoal">{p.question}</span>
                  </div>
                  <p className="text-xs text-charcoal-muted ml-5">On: {p.post?.title || 'Unknown article'}</p>
                  <div className="flex flex-wrap gap-2 mt-2 ml-5">
                    {p.options.map((o, i) => <span key={i} className="text-xs bg-taupe-light/60 px-2 py-1 rounded-full text-charcoal-muted">{o}</span>)}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <span className={`text-xs ${p.is_active ? 'text-green-600' : 'text-charcoal-muted'}`}>{p.is_active ? 'Active' : 'Inactive'}</span>
                  <button onClick={() => toggle(p.id, !p.is_active)} className="text-charcoal-muted hover:text-bronze"><Power size={14} /></button>
                  <button onClick={() => remove(p.id)} className="text-charcoal-muted hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
