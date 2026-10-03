import { Star, Trash2, Check, X, Loader2 } from 'lucide-react';
import { useAdminProductReviews } from '../../hooks/usePlatform';

export default function AdminReviews() {
  const { reviews, loading, approve, remove } = useAdminProductReviews();

  return (
    <div>
      <h1 className="font-serif text-2xl text-charcoal mb-1">Product Reviews</h1>
      <p className="text-sm text-charcoal-muted mb-6">Moderate customer reviews.</p>

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No reviews yet.</div>
      ) : (
        <div className="space-y-4">
          {reviews.map(r => (
            <div key={r.id} className="bg-white rounded-sm border border-taupe/30 p-5">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="text-sm font-medium text-charcoal">{r.author_name}</span>
                  <span className="text-xs text-charcoal-muted ml-2">on {r.product?.name || 'Unknown product'}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${r.is_approved ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                  {r.is_approved ? 'Approved' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center gap-0.5 mb-2">
                {[1, 2, 3, 4, 5].map(n => <Star key={n} size={12} fill={n <= r.rating ? 'currentColor' : 'none'} className="text-bronze" />)}
              </div>
              {r.content && <p className="text-sm text-charcoal-muted leading-relaxed mb-3">{r.content}</p>}
              <p className="text-xs text-charcoal-muted mb-3">{new Date(r.created_at).toLocaleDateString()}</p>
              <div className="flex items-center gap-3">
                {!r.is_approved ? (
                  <button onClick={() => approve(r.id, true)} className="inline-flex items-center gap-1.5 text-xs text-green-600 hover:text-green-700"><Check size={12} /> Approve</button>
                ) : (
                  <button onClick={() => approve(r.id, false)} className="inline-flex items-center gap-1.5 text-xs text-charcoal-muted hover:text-amber-600"><X size={12} /> Unapprove</button>
                )}
                <button onClick={() => remove(r.id)} className="inline-flex items-center gap-1.5 text-xs text-charcoal-muted hover:text-red-500"><Trash2 size={12} /> Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
