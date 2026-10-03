import { useEffect, useState, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { PackageSearch, Loader2, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { lookupOrder, ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { Link } from '../../context/NavigationContext';

type Order = Awaited<ReturnType<typeof lookupOrder>>['order'];

/** Guest order lookup — order number + email verified server-side (no public reads on orders). */
export default function OrderTrackingPage({ orderNumber = '' }: { orderNumber?: string }) {
  const [number, setNumber] = useState(orderNumber);
  const [email, setEmail] = useState(() => localStorage.getItem('lixxon_customer_email') || '');
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(''); setOrder(null);
    try {
      const res = await lookupOrder(number.trim().toUpperCase(), email.trim().toLowerCase());
      setOrder(res.order);
    } catch (err) {
      setError((err as ApiError).message || 'We could not find that order.');
    } finally { setBusy(false); }
  };

  const steps = order ? [
    { label: 'Order placed', done: true, at: order.created_at },
    { label: 'Payment', done: order.payment_status === 'paid', failed: order.payment_status === 'failed', at: order.paid_at },
    { label: order.status === 'completed' ? 'Delivered' : 'Processing', done: order.status === 'completed', failed: order.status === 'cancelled' || order.status === 'refunded' },
  ] : [];

  return (
    <main className="container-narrow py-16 md:py-24">
      <Helmet><title>Track your order | Lixxon Studio</title></Helmet>
      <header className="text-center mb-10">
        <PackageSearch size={28} strokeWidth={1.25} className="mx-auto text-bronze mb-4" />
        <h1 className="font-serif text-4xl text-charcoal mb-3">Track your order</h1>
        <p className="text-charcoal-light">Enter your order number and the email you used at checkout.</p>
      </header>
      <form onSubmit={submit} className="max-w-md mx-auto grid gap-3">
        <input required value={number} onChange={e => setNumber(e.target.value)} placeholder="Order number (e.g. LX-2026-ABCD12)" className="w-full px-4 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze uppercase" />
        <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" className="w-full px-4 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze" />
        <button disabled={busy} className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze transition-colors disabled:opacity-60">{busy && <Loader2 size={14} className="animate-spin" />} Find order</button>
        {error && <p role="alert" className="text-sm text-red-600 text-center">{error}</p>}
      </form>

      {order && (
        <section className="max-w-xl mx-auto mt-12 border border-taupe/50 rounded-sm bg-white/70 p-6 md:p-8" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-6">
            <h2 className="font-serif text-2xl text-charcoal">{order.order_number}</h2>
            <span className="text-sm text-charcoal-muted">{new Date(order.created_at).toLocaleString()}</span>
          </div>
          <ol className="relative border-l border-taupe ml-3 space-y-6 mb-8">
            {steps.map((s, i) => (
              <li key={i} className="ml-6">
                <span className={`absolute -left-3 w-6 h-6 rounded-full flex items-center justify-center ${s.failed ? 'bg-red-100 text-red-600' : s.done ? 'bg-green-100 text-green-700' : 'bg-taupe-light text-charcoal-muted'}`}>
                  {s.failed ? <XCircle size={14} /> : s.done ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                </span>
                <p className="text-sm font-medium text-charcoal">{s.label}</p>
                {s.at && <p className="text-xs text-charcoal-muted">{new Date(s.at).toLocaleString()}</p>}
              </li>
            ))}
          </ol>
          <ul className="divide-y divide-taupe/40 text-sm">
            {order.items.map((it, i) => <li key={i} className="py-2 flex justify-between"><span>{it.product_name}</span><span className="text-charcoal-muted">×{it.quantity}</span></li>)}
          </ul>
          <p className="mt-4 flex justify-between font-medium text-charcoal"><span>Total</span><span>{formatMoney(Number(order.amount), order.currency)}</span></p>
          <p className="mt-6 text-xs text-charcoal-muted">Digital downloads are available in <Link to={{ name: 'account-downloads' }} className="text-bronze hover:underline">your account</Link> after signing in with this email.</p>
        </section>
      )}
    </main>
  );
}
