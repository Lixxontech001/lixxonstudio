import {Check, X} from 'lucide-react';
import { useAdminRefundRequests } from '../../hooks/usePlatform';

export default function AdminRefunds() {
  const { refunds, loading, updateStatus } = useAdminRefundRequests();

  return (
    <div>
      <h1 className="font-serif text-2xl text-charcoal mb-1">Refund Requests</h1>
      <p className="text-sm text-charcoal-muted mb-6">Review and process customer refund requests.</p>

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : refunds.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No refund requests.</div>
      ) : (
        <div className="space-y-4">
          {refunds.map(r => (
            <div key={r.id} className="bg-white rounded-sm border border-taupe/30 p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="text-sm font-medium text-charcoal">{r.order?.order_number || 'Unknown order'}</span>
                  <span className="text-xs text-charcoal-muted ml-2">{r.customer_email}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  r.status === 'pending' ? 'bg-amber-50 text-amber-600' :
                  r.status === 'approved' ? 'bg-green-50 text-green-600' :
                  'bg-red-50 text-red-600'
                }`}>{r.status}</span>
              </div>
              <p className="text-sm text-charcoal-muted leading-relaxed mb-2">{r.reason}</p>
              {r.amount && <p className="text-sm text-charcoal">Requested amount: ${r.amount.toFixed(2)}</p>}
              <p className="text-xs text-charcoal-muted mb-3">{new Date(r.created_at).toLocaleDateString()}</p>
              {r.status === 'pending' && (
                <div className="flex items-center gap-3">
                  <button onClick={() => updateStatus(r.id, 'approved')} className="inline-flex items-center gap-1.5 text-xs text-green-600 hover:text-green-700"><Check size={12} /> Approve</button>
                  <button onClick={() => updateStatus(r.id, 'denied')} className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600"><X size={12} /> Deny</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
