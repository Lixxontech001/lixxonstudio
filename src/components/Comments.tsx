import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Reply, Send, Loader2, AlertCircle, ArrowUpDown, Flag } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { submitForm, ApiError } from '../lib/api';
import { getFingerprint } from '../hooks/useFeatures';
import CommentLikeButton from './CommentLikeButton';

interface Comment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_name: string;
  author_email?: string;
  content: string;
  is_visible: boolean;
  created_at: string;
  replies?: Comment[];
}

interface CommentsProps {
  postId: string;
}

function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

const avatarColors = ['bg-bronze', 'bg-charcoal', 'bg-taupe-dark', 'bg-olive', 'bg-slate'];
function getAvatarColor(name: string): string {
  const hash = name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return avatarColors[hash % avatarColors.length];
}

function rememberMyComment(id?: string) {
  if (!id) return;
  const ids = JSON.parse(localStorage.getItem('lx_my_comments') || '[]') as string[];
  localStorage.setItem('lx_my_comments', JSON.stringify([...ids, id].slice(-50)));
}

function EditButton({ comment }: { comment: Comment }) {
  const mine = (JSON.parse(localStorage.getItem('lx_my_comments') || '[]') as string[]).includes(comment.id);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(comment.content);
  const [saved, setSaved] = useState<string | null>(null);
  const [left, setLeft] = useState(() => Math.max(0, 15 * 60 * 1000 - (Date.now() - new Date(comment.created_at).getTime())));
  useEffect(() => { if (!mine || left <= 0) return; const t = setInterval(() => setLeft(l => Math.max(0, l - 1000)), 1000); return () => clearInterval(t); }, [mine, left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mine || left <= 0) return saved ? <span className="text-xs text-charcoal-muted italic">edited</span> : null;
  const save = async () => {
    try { await submitForm('comment_edit', { comment_id: comment.id, content: text.trim(), fingerprint: getFingerprint() }); comment.content = text.trim(); setSaved(text.trim()); setOpen(false); }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Could not save edit.'); }
  };
  return (
    <>
      <button onClick={() => setOpen(o => !o)} className="text-xs text-charcoal-muted hover:text-bronze transition-colors">Edit ({Math.ceil(left / 60000)}m left)</button>
      {open && (
        <div className="w-full mt-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} className="w-full bg-white border border-taupe px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
          <div className="flex gap-3 mt-1"><button onClick={save} className="text-xs text-bronze">Save</button><button onClick={() => setOpen(false)} className="text-xs text-charcoal-muted">Cancel</button></div>
        </div>
      )}
    </>
  );
}

function ReportButton({ commentId }: { commentId: string }) {
  const [done, setDone] = useState(() => localStorage.getItem(`reported_${commentId}`) === '1');
  const report = async () => {
    const reason = window.prompt('Why are you reporting this comment? (optional)') ;
    if (reason === null) return;
    try { await submitForm('comment_report', { comment_id: commentId, reason }); } catch { /* ignore */ }
    localStorage.setItem(`reported_${commentId}`, '1'); setDone(true);
  };
  return <button onClick={report} disabled={done} className="flex items-center gap-1.5 text-xs text-charcoal-muted hover:text-red-600 disabled:opacity-60 transition-colors"><Flag size={12} strokeWidth={1.5} /> {done ? 'Reported' : 'Report'}</button>;
}

function CommentItem({ comment, postId, onReply }: {
  comment: Comment;
  postId: string;
  onReply: () => void;
}) {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyName, setReplyName] = useState('');
  const [replyEmail, setReplyEmail] = useState('');
  const [replyContent, setReplyContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyName.trim() || !replyContent.trim() || !replyEmail.includes('@')) return;
    setSubmitting(true);
    try {
      const res = await submitForm<{ id?: string }>('comment', { post_id: postId, parent_id: comment.id, author_name: replyName.trim(), author_email: replyEmail.trim(), content: replyContent.trim(), fingerprint: getFingerprint() });
      rememberMyComment(res?.id);
      setReplyContent('');
      setShowReplyForm(false);
      onReply();
    } catch { /* keep the form open so the reader can retry */ }
    setSubmitting(false);
  };

  return (
    <div className="flex gap-4">
      <div className={`flex-shrink-0 w-10 h-10 rounded-full ${getAvatarColor(comment.author_name)} flex items-center justify-center text-white text-xs font-medium`}>
        {getInitials(comment.author_name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-taupe-light/40 rounded-sm px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-charcoal">{comment.author_name}</span>
            <span className="text-xs text-charcoal-muted">{timeAgo(comment.created_at)}</span>
          </div>
          <p className="text-charcoal-muted text-sm leading-relaxed whitespace-pre-wrap">{comment.content}</p>
        </div>
        <div className="flex items-center gap-4 mt-2 ml-2">
          <CommentLikeButton commentId={comment.id} />
          <button
            onClick={() => setShowReplyForm(!showReplyForm)}
            className="flex items-center gap-1.5 text-xs text-charcoal-muted hover:text-bronze transition-colors"
          >
            <Reply size={13} strokeWidth={1.5} /> Reply
          </button>
          <ReportButton commentId={comment.id} />
          <EditButton comment={comment} />
        </div>

        {showReplyForm && (
          <form onSubmit={handleReplySubmit} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={replyName}
                onChange={e => setReplyName(e.target.value)}
                placeholder="Your name"
                required
                className="bg-white border border-taupe px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
              />
              <input
                type="email"
                value={replyEmail}
                onChange={e => setReplyEmail(e.target.value)}
                placeholder="Your email (not shown)"
                required
                className="bg-white border border-taupe px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
              />
            </div>
            <textarea
              value={replyContent}
              onChange={e => setReplyContent(e.target.value)}
              placeholder={`Reply to ${comment.author_name}...`}
              required
              rows={2}
              className="w-full bg-white border border-taupe px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm resize-none"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting || !replyName.trim() || !replyContent.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-bronze text-white text-xs font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50"
              >
                {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                Post Reply
              </button>
              <button
                type="button"
                onClick={() => setShowReplyForm(false)}
                className="px-4 py-2 text-xs text-charcoal-muted hover:text-charcoal transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {comment.replies && comment.replies.length > 0 && (
          <div className="mt-4 space-y-4 pl-4 border-l-2 border-taupe/30">
            {comment.replies.map(reply => (
              <CommentItem key={reply.id} comment={reply} postId={postId} onReply={onReply} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Comments({ postId }: CommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  const fetchComments = useCallback(async () => {
    const { data, error } = await supabase
      .from('comments')
      .select('id, post_id, parent_id, author_name, content, created_at, edited_at, is_pinned, is_approved, is_visible, admin_reply, report_count')
      .eq('post_id', postId)
      .eq('is_visible', true)
      .order('created_at', { ascending: sortOrder === 'oldest' });

    if (error) {
      setLoading(false);
      return;
    }

    const flat = (data || []) as Comment[];
    const parents = flat.filter(c => !c.parent_id);
    const buildReplies = (parentId: string): Comment[] =>
      flat.filter(c => c.parent_id === parentId).map(c => ({ ...c, replies: buildReplies(c.id) }));
    const nested = parents.map(c => ({ ...c, replies: buildReplies(c.id) }));
    setComments(nested);
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const countAllComments = (list: Comment[]): number => {
    return list.reduce((acc, c) => acc + 1 + (c.replies ? countAllComments(c.replies) : 0), 0);
  };

  const totalComments = countAllComments(comments);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !content.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (!email.includes('@') || email.length < 5) {
      setError('Please enter a valid email address.');
      return;
    }
    if (content.trim().length < 3) {
      setError('Comment is too short.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitForm<{ id?: string }>('comment', { post_id: postId, parent_id: null, author_name: name.trim(), author_email: email.trim(), content: content.trim(), fingerprint: getFingerprint() });
      rememberMyComment(res?.id);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof ApiError ? err.message : 'Could not post your comment. Please try again.');
      return;
    }
    setSubmitting(false);
    setContent('');
    setSuccess(true);
    setTimeout(() => setSuccess(false), 8000);
    fetchComments();
  };

  return (
    <section className="border-t border-taupe/30 pt-12 mt-12">
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div className="flex items-center gap-3">
          <MessageCircle size={20} strokeWidth={1.5} className="text-bronze" />
          <h3 className="font-serif text-2xl text-charcoal font-light">
            {totalComments} {totalComments === 1 ? 'Comment' : 'Comments'}
          </h3>
        </div>
        {comments.length > 1 && (
          <button
            onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
            className="inline-flex items-center gap-1.5 text-xs text-charcoal-muted hover:text-bronze transition-colors"
          >
            <ArrowUpDown size={12} /> {sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
          </button>
        )}
      </div>

      {/* Comment Form */}
      <form onSubmit={handleSubmit} className="mb-10 bg-taupe-light/30 rounded-sm p-6 md:p-8 border border-taupe/30">
        <p className="text-sm text-charcoal font-medium mb-4">Join the conversation</p>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
            required
            maxLength={50}
            className="bg-white border border-taupe px-4 py-3 text-sm text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
          />
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Your email (not shown publicly)"
            required
            className="bg-white border border-taupe px-4 py-3 text-sm text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
          />
        </div>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Share your thoughts..."
          required
          maxLength={1000}
          rows={4}
          className="w-full bg-white border border-taupe px-4 py-3 text-sm text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm resize-none"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-charcoal-muted">{content.length}/1000</span>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all duration-500 disabled:opacity-60"
          >
            {submitting ? (
              <><Loader2 size={14} className="animate-spin" /> Posting...</>
            ) : (
              <><Send size={14} /> Post Comment</>
            )}
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-2 mt-4 text-sm text-red-600">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 mt-4 text-sm text-green-600">
            <MessageCircle size={14} /> Thank you! Your comment is awaiting moderation and will appear shortly.
          </div>
        )}
      </form>

      {/* Comments List */}
      {loading ? (
        <div className="space-y-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="skeleton w-10 h-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-32 rounded-sm" />
                <div className="skeleton h-16 w-full rounded-sm" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="text-center py-12">
          <MessageCircle size={32} strokeWidth={1} className="text-taupe mx-auto mb-3" />
          <p className="text-charcoal-muted text-sm">Be the first to share your thoughts.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {comments.map(comment => (
            <CommentItem key={comment.id} comment={comment} postId={postId} onReply={fetchComments} />
          ))}
        </div>
      )}
    </section>
  );
}
