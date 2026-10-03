import { useState, useEffect } from 'react';
import { Star, MessageSquare, Send, Loader2 } from 'lucide-react';
import { useProductReviews, useSubmitReview } from '../../hooks/useFeatures';
import ReviewHelpfulness from '../ReviewHelpfulness';

export default function ProductReviews({ productId }: { productId: string }) {
  const { reviews, loading, avgRating } = useProductReviews(productId);
  const { submit, submitting, error, success } = useSubmitReview();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [refetchKey, setRefetchKey] = useState(0);

  const customerEmail = localStorage.getItem('lixxon_customer_email') || '';

  useEffect(() => {
    if (customerEmail) setEmail(customerEmail);
  }, [customerEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await submit(productId, email, name, rating, content);
    if (ok) {
      setContent('');
      setShowForm(false);
      setRefetchKey(k => k + 1);
    }
  };

  return (
    <section className="mt-12 pt-10 border-t border-taupe/30">
      <div className="flex items-center gap-3 mb-6">
        <MessageSquare size={18} strokeWidth={1.5} className="text-bronze" />
        <h3 className="font-serif text-xl text-charcoal font-light">
          Reviews {reviews.length > 0 && `(${reviews.length})`}
        </h3>
      </div>

      {/* Rating summary */}
      {reviews.length > 0 && (
        <div className="flex items-center gap-4 mb-6 p-4 bg-taupe-light/40 rounded-sm border border-taupe/30">
          <div className="text-center">
            <p className="font-serif text-3xl text-charcoal">{avgRating.toFixed(1)}</p>
            <div className="flex items-center gap-0.5 mt-1">
              {[1, 2, 3, 4, 5].map(n => (
                <Star key={n} size={12} strokeWidth={1.5} fill={n <= Math.round(avgRating) ? 'currentColor' : 'none'} className="text-bronze" />
              ))}
            </div>
          </div>
          <div className="h-10 w-[1px] bg-taupe" />
          <p className="text-sm text-charcoal-muted">{reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}</p>
        </div>
      )}

      {/* Reviews list */}
      {!loading && reviews.length > 0 && (
        <div className="space-y-5 mb-8" key={refetchKey}>
          {reviews.map(review => (
            <div key={review.id} className="border border-taupe/30 rounded-sm p-5 bg-white">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-charcoal">{review.author_name}</span>
                <span className="text-xs text-charcoal-muted">{new Date(review.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
              <div className="flex items-center gap-0.5 mb-3">
                {[1, 2, 3, 4, 5].map(n => (
                  <Star key={n} size={12} strokeWidth={1.5} fill={n <= review.rating ? 'currentColor' : 'none'} className="text-bronze" />
                ))}
              </div>
              {review.content && <p className="text-sm text-charcoal-muted leading-relaxed">{review.content}</p>}
              <ReviewHelpfulness reviewId={review.id} />
            </div>
          ))}
        </div>
      )}

      {/* Write a review */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-6 py-3 border border-taupe text-charcoal text-sm rounded-sm hover:border-bronze transition-all"
        >
          <MessageSquare size={14} strokeWidth={1.5} /> Write a Review
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 p-6 bg-taupe-light/40 rounded-sm border border-taupe/30">
          <div className="grid sm:grid-cols-2 gap-3">
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
              placeholder="Your email (not shown)"
              required
              className="bg-white border border-taupe px-4 py-3 text-sm text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-charcoal-muted">Your rating:</span>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`Rate ${n} stars`}
              >
                <Star size={20} strokeWidth={1.5} fill={n <= rating ? 'currentColor' : 'none'} className={n <= rating ? 'text-bronze' : 'text-taupe'} />
              </button>
            ))}
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Share your experience with this product..."
            rows={4}
            maxLength={1000}
            className="w-full bg-white border border-taupe px-4 py-3 text-sm text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm resize-none"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">Your review has been posted.</p>}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-60"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Submit Review
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2.5 text-xs text-charcoal-muted hover:text-charcoal transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
