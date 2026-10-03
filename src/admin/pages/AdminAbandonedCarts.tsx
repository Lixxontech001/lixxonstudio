import { ShoppingCart, Check, Loader2 } from 'lucide-react';
import { useAdminAbandonedCarts } from '../../hooks/usePlatform';

export default function AdminAbandonedCarts() {
  const { carts, loading, markRecovered } = useAdminAbandonedCarts();

  return (
    <div>
      <h1 className="font-serif text-2xl text-charcoal mb-1">Abandoned Carts</h1>
      <p className="text-sm text-charcoal-muted mb-6">Track carts that were started but not completed.</p>

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : carts.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No abandoned carts.</div>
      ) : (
        <div className="space-y-3">
          {carts.map(c => {
            const items = (() => { try { return JSON.parse(c.cart_data) as { name: string; price: number; quantity: number }[] } catch { return [] } })();
            const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
            return (
              <div key={c.id} className="bg-white rounded-sm border border-taupe/30 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShoppingCart size={14} className="text-bronze" />
                    <span className="text-sm font-medium text-charcoal">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                    <span className="text-sm text-charcoal-muted">${total.toFixed(2)}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${c.recovered ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                    {c.recovered ? 'Recovered' : 'Abandoned'}
                  </span>
                </div>
                {items.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {items.map((item, i) => (
                      <div key={i} className="text-xs text-charcoal-muted flex justify-between">
                        <span>{item.quantity}x {item.name}</span>
                        <span>${(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-charcoal-muted">{new Date(c.updated_at).toLocaleString()}</span>
                  {!c.recovered && (
                    <button onClick={() => markRecovered(c.id)} className="inline-flex items-center gap-1.5 text-xs text-green-600 hover:text-green-700">
                      <Check size={12} /> Mark Recovered
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
