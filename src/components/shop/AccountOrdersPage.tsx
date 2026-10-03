import { useEffect, useState } from 'react';
import { ArrowRight, Package } from 'lucide-react';
import { Link, useNavigation } from '../../context/NavigationContext';
import { useCustomerOrders } from '../../hooks/useCommerce';
import { Helmet } from 'react-helmet-async';

export default function AccountOrdersPage() {
  const [email] = useState(() => localStorage.getItem('lixxon_customer_email') || '');
  const { orders, loading } = useCustomerOrders(email || null);
  const { navigate } = useNavigation();

  useEffect(() => { window.scrollTo(0, 0); }, []);

  if (!email) {
    navigate({ name: 'account' });
    return null;
  }

  return (
    <main>
      <Helmet><title>My Orders | Lixxon Studio</title><meta name="robots" content="noindex, nofollow" /></Helmet>

      <section className="container-wide pt-12 pb-8">
        <Link to={{ name: 'account' }} className="text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors">← Back to Account</Link>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light mt-6">My Orders</h1>
      </section>

      <section className="container-wide pb-16">
        {loading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => <div key={i} className="skeleton h-24 rounded-sm" />)}
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-6">
              <Package size={24} strokeWidth={1.5} className="text-bronze" />
            </div>
            <h2 className="font-serif text-2xl text-charcoal font-light">No orders yet</h2>
            <p className="text-charcoal-muted text-sm mt-3">Your orders will appear here after checkout.</p>
            <Link to={{ name: 'shop' }} className="inline-flex items-center gap-3 mt-6 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm">
              Browse Shop <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map(order => (
              <div key={order.id} className="bg-white rounded-sm luxury-shadow p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                  <div>
                    <p className="font-serif text-lg text-charcoal">{order.order_number}</p>
                    <p className="text-xs text-charcoal-muted">{new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-serif text-xl text-charcoal">${order.amount.toFixed(2)}</p>
                    <span className={`text-xs px-2.5 py-1 rounded-full ${order.payment_status === 'paid' ? 'bg-green-50 text-green-700' : order.payment_status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-taupe-light text-charcoal-muted'}`}>
                      {order.payment_status}
                    </span>
                  </div>
                </div>
                <div className="border-t border-taupe/30 pt-4 space-y-2">
                  {(order.items || []).map(item => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <span className="text-charcoal">{item.product_name} × {item.quantity}</span>
                      <span className="text-charcoal-muted">${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
