import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Reply, Send, Loader2, Heart, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Comment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_name: string;
  author_email: string;
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
  const [liked, setLiked] = useState(false);

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyName.trim() || !replyContent.trim() || !replyEmail.includes('@')) return;
    setSubmitting(true);
    const { error } = await supabase.from('comments').insert({
      post_id: postId,
      parent_id: comment.id,
      author_name: replyName.trim(),
      author_email: replyEmail.trim(),
      content: replyContent.trim(),
      is_visible: true,
    });
    if (!error) {
      setReplyContent('');
      setShowReplyForm(false);
      onReply();
    }
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
          <button
            onClick={() => setLiked(!liked)}
            className="flex items-center gap-1.5 text-xs text-charcoal-muted hover:text-bronze transition-colors"
          >
            <Heart size={13} strokeWidth={1.5} fill={liked ? 'currentColor' : 'none'} className={liked ? 'text-bronze' : ''} />
            {liked ? '1' : '0'}
          </button>
          <button
            onClick={() => setShowReplyForm(!showReplyForm)}
            className="flex items-center gap-1.5 text-xs text-charcoal-muted hover:text-bronze transition-colors"
          >
            <Reply size={13} strokeWidth={1.5} /> Reply
          </button>
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

  const fetchComments = useCallback(async () => {
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .eq('post_id', postId)
      .eq('is_visible', true)
      .order('created_at', { ascending: false });

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
    const { error: insertError } = await supabase.from('comments').insert({
      post_id: postId,
      parent_id: null,
      author_name: name.trim(),
      author_email: email.trim(),
      content: content.trim(),
      is_visible: true,
    });

    setSubmitting(false);

    if (insertError) {
      setError('Could not post your comment. Please try again.');
      return;
    }

    setContent('');
    setSuccess(true);
    setTimeout(() => setSuccess(false), 4000);
    fetchComments();
  };

  return (
    <section className="border-t border-taupe/30 pt-12 mt-12">
      <div className="flex items-center gap-3 mb-8">
        <MessageCircle size={20} strokeWidth={1.5} className="text-bronze" />
        <h3 className="font-serif text-2xl text-charcoal font-light">
          {totalComments} {totalComments === 1 ? 'Comment' : 'Comments'}
        </h3>
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
            <MessageCircle size={14} /> Your comment has been posted. Thank you for joining the conversation!
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
