import { useEffect, useState, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { RotateCcw, Loader2, Check } from 'lucide-react';
import CustomerGate from './CustomerGate';
import { useAuth } from '../../context/AuthContext';
import { useCustomerOrders } from '../../hooks/useCommerce';
import { supabase, rows } from '../../lib/supabaseClient';
import { formatMoney } from '../../lib/money';
import { Link } from '../../context/NavigationContext';

interface Refund { id: string; order_id: string; reason: string; status: 'pending' | 'approved' | 'denied'; amount: number | null; created_at: string; resolved_at: string | null }

function Inner() {
  const { email } = useAuth();
  const { orders } = useCustomerOrders(email);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [orderId, setOrderId] = useState('');
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const load = async () => { const { data } = await supabase.from('refund_requests').select('*').order('created_at', { ascending: false }); setRefunds(rows(data)); };
  useEffect(() => { load(); }, []);

  const eligible = orders.filter(o => o.payment_status === 'paid' && !['refunded', 'cancelled'].includes(o.status) && Date.now() - new Date(o.created_at).getTime() < 30 * 864e5 && !refunds.some(r => r.order_id === o.id && r.status !== 'denied'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!orderId || reason.trim().length < 10) { setState('error'); setMsg('Choose an order and tell us a little more (at least 10 characters).'); return; }
    setState('busy');
    const order = orders.find(o => o.id === orderId);
    const { error } = await supabase.from('refund_requests').insert({ order_id: orderId, customer_email: email, reason: reason.trim().slice(0, 1000), amount: order?.amount ?? null });
    if (error) { setState('error'); setMsg('Could not submit your request. Please try again or contact us.'); return; }
    setState('done'); setMsg('Request received. We review refunds within 3 business days and reply by email.'); setReason(''); setOrderId(''); load();
  };

  return (
    <main className="container-narrow py-16 md:py-20">
      <Helmet><title>Refunds | Lixxon Studio</title><meta name="robots" content="noindex" /></Helmet>
      <nav className="text-xs text-charcoal-muted mb-6"><Link to={{ name: 'account' }} className="hover:text-bronze">Account</Link> / Refunds</nav>
      <h1 className="flex items-center gap-3 font-serif text-3xl text-charcoal mb-2"><RotateCcw size={22} className="text-bronze" /> Request a refund</h1>
      <p className="text-sm text-charcoal-light mb-8">Digital guides can be refunded within 30 days if they were not what you expected. Tell us what went wrong — it genuinely helps us improve them.</p>

      <form onSubmit={submit} className="grid gap-4 p-6 bg-white/70 border border-taupe/40 rounded-sm">
        <label className="text-sm"><span className="block text-[11px] tracking-editorial uppercase text-charcoal-muted mb-1">Order</span>
          <select value={orderId} onChange={e => setOrderId(e.target.value)} className="w-full px-4 py-3 border border-taupe rounded-sm bg-white focus:outline-none focus:border-bronze">
            <option value="">{eligible.length ? 'Select an order…' : 'No eligible orders in the last 30 days'}</option>
            {eligible.map(o => <option key={o.id} value={o.id}>{o.order_number} · {new Date(o.created_at).toLocaleDateString()} · {formatMoney(Number(o.amount), o.currency)}</option>)}
          </select></label>
        <label className="text-sm"><span className="block text-[11px] tracking-editorial uppercase text-charcoal-muted mb-1">Reason</span><textarea value={reason} onChange={e => setReason(e.target.value)} rows={4} maxLength={1000} className="w-full px-4 py-3 border border-taupe rounded-sm bg-white focus:outline-none focus:border-bronze" /></label>
        <div className="flex items-center gap-4">
          <button disabled={state === 'busy' || !eligible.length} className="inline-flex items-center gap-2 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze disabled:opacity-60">{state === 'busy' ? <Loader2 size={14} className="animate-spin" /> : state === 'done' ? <Check size={14} /> : null} Submit request</button>
          {msg && <p className={`text-sm ${state === 'error' ? 'text-red-600' : 'text-green-700'}`} role="status">{msg}</p>}
        </div>
      </form>

      {refunds.length > 0 && (
        <section className="mt-10" aria-labelledby="past-h">
          <h2 id="past-h" className="font-serif text-xl text-charcoal mb-4">Your requests</h2>
          <ul className="divide-y divide-taupe/40 border-y border-taupe/40 text-sm">
            {refunds.map(r => { const o = orders.find(x => x.id === r.order_id); return (
              <li key={r.id} className="py-4 flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-medium text-charcoal">{o?.order_number || 'Order'} · {new Date(r.created_at).toLocaleDateString()}</p><p className="text-charcoal-muted mt-1 line-clamp-2">{r.reason}</p></div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] tracking-editorial uppercase ${r.status === 'approved' ? 'bg-green-100 text-green-700' : r.status === 'denied' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
              </li>); })}
          </ul>
        </section>
      )}
    </main>
  );
}

export default function AccountRefundsPage() {
  return <CustomerGate title="Refunds" intro="Sign in with the email you used at checkout."><Inner /></CustomerGate>;
}
