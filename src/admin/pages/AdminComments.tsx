import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAdminComments } from '../../hooks/useSupabase';
import { Check, X, Trash2, MessageSquare, ExternalLink, Reply, ShieldCheck, Clock, EyeOff, Send } from 'lucide-react';

export default function AdminComments() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'hidden'>('all');
  const { comments, total, totalPages, loading, refetch, setComments } = useAdminComments(page, filter);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [savingReply, setSavingReply] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleApprove = async (id: string) => {
    await supabase.from('comments').update({ is_approved: true, is_visible: true }).eq('id', id);
    setComments(prev => prev.map(c => c.id === id ? { ...c, is_approved: true, is_visible: true } : c));
  };

  const handleHide = async (id: string) => {
    await supabase.from('comments').update({ is_approved: false, is_visible: false }).eq('id', id);
    setComments(prev => prev.map(c => c.id === id ? { ...c, is_approved: false, is_visible: false } : c));
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this reader comment permanently?')) return;
    await supabase.from('comments').delete().eq('id', id);
    setComments(prev => prev.filter(c => c.id !== id));
  };

  const handleSendReply = async (commentId: string) => {
    if (!replyText.trim()) return;
    setSavingReply(true);
    try {
      await supabase.from('comments').update({
        admin_reply: replyText.trim(),
        admin_replied_at: new Date().toISOString(),
      }).eq('id', commentId);
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, admin_reply: replyText.trim() } : c));
      setReplyingId(null);
      setReplyText('');
    } finally {
      setSavingReply(false);
    }
  };

  const handleBulkApprove = async () => {
    const pending = comments.filter(c => !c.is_approved);
    if (!pending.length) return;
    if (!confirm(`Approve all ${pending.length} pending comments?`)) return;
    setBulkBusy(true);
    try {
      await supabase.from('comments').update({ is_approved: true, is_visible: true }).in('id', pending.map(c => c.id));
      await refetch();
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-charcoal font-light">Reader Comments</h1>
          <p className="text-sm text-charcoal-muted mt-1">
            Moderate community discussions and reply directly to readers ({total} total)
          </p>
        </div>

        {filter === 'pending' && comments.length > 0 && (
          <button
            onClick={handleBulkApprove}
            disabled={bulkBusy}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-emerald-700 transition-all disabled:opacity-50"
          >
            <ShieldCheck size={15} /> {bulkBusy ? 'Approving…' : 'Approve All Visible'}
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex border-b border-taupe/30 gap-6 text-xs uppercase tracking-editorial">
        {(['all', 'pending', 'approved', 'hidden'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { setFilter(tab); setPage(1); }}
            className={`pb-3 font-medium transition-colors border-b-2 -mb-[2px] ${
              filter === tab
                ? 'border-bronze text-bronze'
                : 'border-transparent text-charcoal-muted hover:text-charcoal'
            }`}
          >
            {tab === 'all' ? 'All Comments' : tab === 'pending' ? 'Pending Review' : tab === 'approved' ? 'Approved' : 'Hidden / Spam'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="skeleton h-24 rounded-sm bg-taupe/15" />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="bg-white border border-taupe/30 rounded-sm p-12 text-center">
          <MessageSquare size={36} strokeWidth={1.2} className="text-bronze/60 mx-auto mb-3" />
          <h3 className="font-serif text-lg text-charcoal font-normal mb-1">No comments found in this view</h3>
          <p className="text-charcoal-muted text-xs">
            {filter === 'pending' ? 'All comments have been moderated.' : 'Reader comments will appear here once submitted.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {comments.map(comment => (
            <div
              key={comment.id}
              className={`bg-white border rounded-sm p-5 transition-all shadow-xs ${
                !comment.is_approved ? 'border-amber-200 bg-amber-50/20' : 'border-taupe/30 hover:border-bronze/30'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="font-medium text-sm text-charcoal">{comment.author_name}</span>
                    {comment.author_email && (
                      <span className="text-xs text-charcoal-muted font-mono">{comment.author_email}</span>
                    )}
                    <span className="text-xs text-charcoal-muted">
                      · {new Date(comment.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <p className="text-sm text-charcoal leading-relaxed whitespace-pre-wrap">{comment.content}</p>

                  {comment.post && (
                    <div className="mt-2.5">
                      <a
                        href={`/article/${comment.post.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-bronze hover:underline font-medium"
                      >
                        <ExternalLink size={12} /> On: {comment.post.title}
                      </a>
                    </div>
                  )}

                  {/* Existing Admin Reply */}
                  {comment.admin_reply && (
                    <div className="mt-3 p-3 bg-taupe-light/30 border-l-2 border-bronze rounded-r-sm text-xs space-y-1">
                      <span className="font-medium text-bronze tracking-editorial uppercase text-[10px] block">
                        Editorial Team Reply:
                      </span>
                      <p className="text-charcoal">{comment.admin_reply}</p>
                    </div>
                  )}

                  {/* Inline Reply Form */}
                  {replyingId === comment.id && (
                    <div className="mt-4 p-4 border border-bronze/30 bg-taupe-light/20 rounded-sm space-y-3">
                      <label className="block text-[11px] font-medium tracking-editorial uppercase text-charcoal-muted">
                        Reply to {comment.author_name}
                      </label>
                      <textarea
                        rows={3}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        placeholder="Type your response from the editorial desk…"
                        className="w-full bg-white border border-taupe/60 p-2.5 text-xs rounded-sm focus:outline-none focus:border-bronze"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSendReply(comment.id)}
                          disabled={savingReply || !replyText.trim()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bronze text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50"
                        >
                          <Send size={12} /> {savingReply ? 'Posting…' : 'Publish Reply'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setReplyingId(null); setReplyText(''); }}
                          className="text-xs text-charcoal-muted hover:text-charcoal px-2 py-1"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 mt-3.5">
                    {comment.is_approved ? (
                      <span className="text-[10px] tracking-editorial uppercase font-medium bg-green-50 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Check size={10} /> Approved
                      </span>
                    ) : (
                      <span className="text-[10px] tracking-editorial uppercase font-medium bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Clock size={10} /> Pending Approval
                      </span>
                    )}
                    {!comment.is_visible && (
                      <span className="text-[10px] tracking-editorial uppercase font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <EyeOff size={10} /> Hidden
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingId(replyingId === comment.id ? null : comment.id);
                        setReplyText(comment.admin_reply || '');
                      }}
                      className="text-xs text-charcoal-muted hover:text-bronze flex items-center gap-1 ml-2 transition-colors"
                    >
                      <Reply size={13} /> {comment.admin_reply ? 'Edit Reply' : 'Reply'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {!comment.is_approved && (
                    <button
                      onClick={() => handleApprove(comment.id)}
                      className="p-1.5 text-charcoal-muted hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                      title="Approve Comment"
                    >
                      <Check size={16} />
                    </button>
                  )}
                  {comment.is_visible ? (
                    <button
                      onClick={() => handleHide(comment.id)}
                      className="p-1.5 text-charcoal-muted hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                      title="Hide from article"
                    >
                      <EyeOff size={15} />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleApprove(comment.id)}
                      className="p-1.5 text-charcoal-muted hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                      title="Unhide and Approve"
                    >
                      <Check size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="p-1.5 text-charcoal-muted hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Delete permanently"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 text-xs uppercase tracking-editorial border border-taupe/40 rounded-sm disabled:opacity-30 hover:bg-taupe-light/30 transition-colors"
          >
            Previous
          </button>
          <span className="text-xs text-charcoal-muted px-2">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 text-xs uppercase tracking-editorial border border-taupe/40 rounded-sm disabled:opacity-30 hover:bg-taupe-light/30 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
