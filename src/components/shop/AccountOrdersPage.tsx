import { useEffect, useState } from 'react';
import { ArrowRight, Package, RotateCcw, Loader2, Check } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import { useCustomerOrders } from '../../hooks/useCommerce';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../../context/AuthContext';
import CustomerGate from './CustomerGate';
import { formatMoney } from '../../lib/money';
import { supabase } from '../../lib/supabaseClient';
import type { Order } from '../../lib/types';

export default function AccountOrdersPage() {
  return <CustomerGate title="My Orders"><OrdersInner /></CustomerGate>;
}

function RefundRequest({ order, email }: { order: Order; email: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const eligible = order.payment_status === 'paid' && Date.now() - new Date(order.created_at).getTime() < 14 * 864e5;
  if (!eligible) return null;
  if (state === 'done') return <p className="text-xs text-green-700 inline-flex items-center gap-1 mt-3"><Check size={12} /> Refund request submitted — we reply within 2 business days.</p>;
  const submit = async () => {
    if (reason.trim().length < 10) return;
    setState('busy');
    const { error } = await supabase.from('refund_requests').insert({ order_id: order.id, customer_email: email, reason: reason.trim(), status: 'pending', amount: order.amount });
    setState(error ? 'error' : 'done');
  };
  return (
    <div className="mt-3">
      {!open ? <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-charcoal-muted hover:text-bronze"><RotateCcw size={12} /> Request a refund</button> : (
        <div className="space-y-2">
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={1000} placeholder="Tell us what went wrong (min 10 characters)" className="w-full border border-taupe/50 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze" />
          <div className="flex gap-2">
            <button onClick={submit} disabled={state === 'busy' || reason.trim().length < 10} className="px-4 py-2 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm disabled:opacity-50">{state === 'busy' ? <Loader2 size={12} className="animate-spin" /> : 'Submit'}</button>
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-xs text-charcoal-muted">Cancel</button>
          </div>
          {state === 'error' && <p className="text-xs text-red-600">Could not submit. Please try again or contact us.</p>}
        </div>
      )}
    </div>
  );
}

function OrdersInner() {
  const { email } = useAuth();
  const { orders, loading } = useCustomerOrders(email);

  useEffect(() => { window.scrollTo(0, 0); }, []);

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
                    <p className="font-serif text-xl text-charcoal">{formatMoney(Number(order.amount), order.currency)}</p>
                    <span className={`text-xs px-2.5 py-1 rounded-full ${order.payment_status === 'paid' ? 'bg-green-50 text-green-700' : order.payment_status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-taupe-light text-charcoal-muted'}`}>
                      {order.payment_status}
                    </span>
                  </div>
                </div>
                <div className="border-t border-taupe/30 pt-4 space-y-2">
                  {(order.items || []).map(item => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <span className="text-charcoal">{item.product_name} × {item.quantity}</span>
                      <span className="text-charcoal-muted">{formatMoney(Number(item.price) * item.quantity, order.currency)}</span>
                    </div>
                  ))}
                  {Number(order.discount_amount) > 0 && <div className="flex items-center justify-between text-sm text-green-700"><span>Discount{order.promo_code ? ` (${order.promo_code})` : ''}</span><span>−{formatMoney(Number(order.discount_amount), order.currency)}</span></div>}
                  {Number(order.gift_card_amount) > 0 && <div className="flex items-center justify-between text-sm text-green-700"><span>Gift card</span><span>−{formatMoney(Number(order.gift_card_amount), order.currency)}</span></div>}
                </div>
                {email && <RefundRequest order={order} email={email} />}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
