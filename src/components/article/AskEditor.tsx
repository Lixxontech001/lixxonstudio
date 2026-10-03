import { useState, type FormEvent } from 'react';
import { MessageCircleQuestion, ThumbsUp, Loader2, Check } from 'lucide-react';
import { useArticleQuestions } from '../../hooks/useV3';
import { submitForm, ApiError } from '../../lib/api';
import { supabase } from '../../lib/supabaseClient';
import { getFingerprint } from '../../hooks/useFeatures';

/** Reader Q&A — questions go through the edge function, editors answer in the admin. */
export default function AskEditor({ postId }: { postId: string }) {
  const { questions } = useArticleQuestions(postId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ author_name: '', author_email: '', question: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [voted, setVoted] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('lixxon_q_votes') || '[]')); } catch { return new Set(); }
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('sending'); setMessage('');
    try {
      const res = await submitForm('question', { post_id: postId, ...form });
      setMessage(res.message || 'Question received.');
      setStatus('done');
      setForm({ author_name: '', author_email: '', question: '' });
    } catch (err) {
      setMessage((err as ApiError).message || 'Could not send your question.');
      setStatus('error');
    }
  };

  const upvote = async (id: string) => {
    if (voted.has(id)) return;
    const { data } = await supabase.rpc('upvote_question', { p_question_id: id, p_fingerprint: getFingerprint() });
    if (typeof data === 'number') setVotes(v => ({ ...v, [id]: data }));
    const next = new Set(voted); next.add(id); setVoted(next);
    localStorage.setItem('lixxon_q_votes', JSON.stringify([...next]));
  };

  return (
    <section aria-labelledby="ask-editor" className="my-12 print:hidden">
      <div className="flex items-center justify-between gap-4 mb-5">
        <h2 id="ask-editor" className="flex items-center gap-2 font-serif text-2xl text-charcoal"><MessageCircleQuestion size={20} strokeWidth={1.5} className="text-bronze" /> Ask the editor</h2>
        <button onClick={() => setOpen(o => !o)} className="text-xs tracking-editorial uppercase text-bronze hover:underline">{open ? 'Close' : 'Ask a question'}</button>
      </div>

      {open && (
        <form onSubmit={submit} className="mb-8 p-6 border border-taupe/50 rounded-sm bg-white/60 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <input required maxLength={80} value={form.author_name} onChange={e => setForm(f => ({ ...f, author_name: e.target.value }))} placeholder="Your name" className="w-full px-4 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze" />
            <input required type="email" value={form.author_email} onChange={e => setForm(f => ({ ...f, author_email: e.target.value }))} placeholder="Email (never shown)" className="w-full px-4 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze" />
          </div>
          <textarea required minLength={5} maxLength={1500} rows={3} value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))} placeholder="What would you like to know about this topic?" className="w-full px-4 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze" />
          <div className="flex items-center gap-4">
            <button disabled={status === 'sending'} className="inline-flex items-center gap-2 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze transition-colors disabled:opacity-60">
              {status === 'sending' ? <Loader2 size={14} className="animate-spin" /> : status === 'done' ? <Check size={14} /> : null} Send question
            </button>
            {message && <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-green-700'}`} role="status">{message}</p>}
          </div>
        </form>
      )}

      {questions.length === 0 ? (
        <p className="text-sm text-charcoal-muted">No answered questions yet. Be the first to ask.</p>
      ) : (
        <ul className="space-y-6">
          {questions.map(q => (
            <li key={q.id} className="border-b border-taupe/40 pb-6 last:border-0">
              <p className="font-medium text-charcoal">{q.question}</p>
              <p className="text-xs text-charcoal-muted mt-1">Asked by {q.author_name}</p>
              {q.answer && (
                <div className="mt-3 pl-4 border-l-2 border-bronze/60">
                  <p className="text-[15px] leading-relaxed text-charcoal-light whitespace-pre-line">{q.answer}</p>
                  <p className="text-xs text-bronze mt-2">— {q.answered_by || 'The editors'}</p>
                </div>
              )}
              <button onClick={() => upvote(q.id)} disabled={voted.has(q.id)} className={`mt-3 inline-flex items-center gap-1.5 text-xs ${voted.has(q.id) ? 'text-bronze' : 'text-charcoal-muted hover:text-bronze'}`} aria-label="Helpful question">
                <ThumbsUp size={13} /> {votes[q.id] ?? q.upvotes} found this helpful
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
