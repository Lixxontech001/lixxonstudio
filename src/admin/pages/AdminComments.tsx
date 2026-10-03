import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAdminComments } from '../../hooks/useSupabase';
import { useNavigation } from '../../context/NavigationContext';
import { Check, X, Trash2, MessageSquare, Eye } from 'lucide-react';

export default function AdminComments() {
  const { navigate } = useNavigation();
  const [page, setPage] = useState(1);
  const { comments, total, totalPages, loading } = useAdminComments(page);

  const handleApprove = async (id: string) => {
    await supabase.from('comments').update({ is_approved: true, is_visible: true }).eq('id', id);
    window.location.reload();
  };

  const handleHide = async (id: string) => {
    await supabase.from('comments').update({ is_approved: false, is_visible: false }).eq('id', id);
    window.location.reload();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this comment permanently?')) return;
    await supabase.from('comments').delete().eq('id', id);
    window.location.reload();
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-2xl text-gray-900">Comments</h1>
        <p className="text-gray-500 text-sm mt-1">{total} total comments · moderate and review reader responses</p>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : comments.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <MessageSquare size={32} strokeWidth={1} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No comments yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment: any) => (
            <div key={comment.id} className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-sm text-gray-900">{comment.author_name}</span>
                    <span className="text-xs text-gray-400">{comment.author_email}</span>
                    <span className="text-xs text-gray-400">· {new Date(comment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{comment.content}</p>
                  {comment.post && (
                    <button
                      onClick={() => navigate({ name: 'article', slug: comment.post.slug })}
                      className="text-xs text-bronze hover:underline mt-2 flex items-center gap-1"
                    >
                      <Eye size={12} /> On: {comment.post.title}
                    </button>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    {comment.is_approved ? (
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">Approved</span>
                    ) : (
                      <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">Pending</span>
                    )}
                    {!comment.is_visible && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Hidden</span>}
                    {comment.admin_reply && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">Admin Reply</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  {!comment.is_approved && (
                    <button onClick={() => handleApprove(comment.id)} className="p-1.5 text-gray-400 hover:text-green-600" title="Approve">
                      <Check size={16} />
                    </button>
                  )}
                  {comment.is_visible && (
                    <button onClick={() => handleHide(comment.id)} className="p-1.5 text-gray-400 hover:text-amber-600" title="Hide">
                      <X size={16} />
                    </button>
                  )}
                  <button onClick={() => handleDelete(comment.id)} className="p-1.5 text-gray-400 hover:text-red-600" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 text-sm border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50">Previous</button>
          <span className="text-sm text-gray-600 px-2">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-4 py-2 text-sm border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
        </div>
      )}
    </div>
  );
}
