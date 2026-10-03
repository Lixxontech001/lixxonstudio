import { useEffect, useState } from 'react';
import { MessageCircleQuestion, Loader2, Eye, EyeOff, Trash2 } from 'lucide-react';
import { supabase, rows } from '../../lib/supabaseClient';
import type { ArticleQuestion } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';

type Q = ArticleQuestion & { post: { title: string; slug: string } | null };

export default function AdminQuestions() {
  const { email } = useAuth();
  const [items, setItems] = useState<Q[]>([]);
  const [filter, setFilter] = useState<'unanswered' | 'answered' | 'all'>('unanswered');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    let q = supabase.from('admin_questions').select('*, post:posts(title, slug)').order('created_at', { ascending: false }).limit(200);
    if (filter === 'unanswered') q = q.is('answer', null); if (filter === 'answered') q = q.not('answer', 'is', null);
    const { data } = await q; setItems(rows(data)); setLoading(false);
  };
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const answer = async (q: Q, publish: boolean) => {
    const text = (drafts[q.id] ?? q.answer ?? '').trim(); if (!text) return;
    setBusy(q.id);
    await supabase.from('article_questions').update({ answer: text, answered_by: email?.split('@')[0] || 'Editor', answered_at: new Date().toISOString(), is_public: publish }).eq('id', q.id);
    setBusy(null); load();
  };
  const toggle = async (q: Q) => { await supabase.from('article_questions').update({ is_public: !q.is_public }).eq('id', q.id); load(); };
  const remove = async (q: Q) => { if (!confirm('Delete this question?')) return; await supabase.from('article_questions').delete().eq('id', q.id); load(); };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div><h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><MessageCircleQuestion size={20} className="text-bronze" /> Reader questions</h1><p className="text-sm text-charcoal-muted mt-1">Answer the good ones — published answers appear under the article.</p></div>
        <div className="flex gap-1 bg-white border border-taupe/40 rounded-sm p-1 text-xs">{(['unanswered', 'answered', 'all'] as const).map(f => <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-sm capitalize ${filter === f ? 'bg-charcoal text-white' : 'text-charcoal-muted hover:text-charcoal'}`}>{f}</button>)}</div>
      </div>
      {loading ? <div className="skeleton h-40 rounded-sm" /> : items.length === 0 ? <p className="p-10 text-center text-sm text-charcoal-muted bg-white border border-taupe/30 rounded-sm">Nothing here.</p> : (
        <div className="space-y-4">
          {items.map(q => (
            <div key={q.id} className="bg-white rounded-sm border border-taupe/30 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <p className="text-xs text-charcoal-muted">{q.author_name} · {q.author_email} · {new Date(q.created_at).toLocaleString()} {q.post && <>· on <a href={`/blog/${q.post.slug}`} target="_blank" rel="noreferrer" className="text-bronze hover:underline">{q.post.title}</a></>}</p>
                <div className="flex items-center gap-1">
                  {q.answer && <button onClick={() => toggle(q)} className={`p-1.5 ${q.is_public ? 'text-green-600' : 'text-charcoal-muted'}`} title={q.is_public ? 'Public — click to hide' : 'Hidden — click to publish'}>{q.is_public ? <Eye size={14} /> : <EyeOff size={14} />}</button>}
                  <button onClick={() => remove(q)} className="p-1.5 text-charcoal-muted hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
              <p className="text-charcoal font-medium mb-3">{q.question}</p>
              <textarea rows={3} value={drafts[q.id] ?? q.answer ?? ''} onChange={e => setDrafts(d => ({ ...d, [q.id]: e.target.value }))} placeholder="Write an answer…" className="w-full border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => answer(q, true)} disabled={busy === q.id} className="px-4 py-2 bg-bronze text-white text-xs rounded-sm disabled:opacity-60">{busy === q.id ? <Loader2 size={12} className="animate-spin" /> : 'Answer & publish'}</button>
                <button onClick={() => answer(q, false)} disabled={busy === q.id} className="px-4 py-2 border border-taupe/50 text-xs rounded-sm">Save privately</button>
                {q.upvotes > 0 && <span className="ml-auto text-xs text-charcoal-muted self-center">{q.upvotes} found helpful</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
