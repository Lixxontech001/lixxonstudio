import { useState, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { Gift, ShieldCheck, Mail, ArrowRight } from 'lucide-react';
import { useNavigation } from '../../context/NavigationContext';
import { formatMoney } from '../../lib/money';

const PRESETS = [10, 25, 50, 100];

/** Gift card storefront: amount + recipient → handed to the secure checkout (server validates). */
export default function GiftCardsPage() {
  const { navigate } = useNavigation();
  const [amount, setAmount] = useState(25);
  const [custom, setCustom] = useState('');
  const [form, setForm] = useState({ recipient_name: '', recipient_email: '', message: '' });
  const [error, setError] = useState('');

  const value = custom ? Number(custom) : amount;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!(value >= 5 && value <= 500)) { setError('Gift cards can be between $5 and $500.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.recipient_email)) { setError('Please enter a valid recipient email.'); return; }
    sessionStorage.setItem('lixxon_gift_card', JSON.stringify({ amount: Math.round(value * 100) / 100, ...form }));
    navigate({ name: 'checkout' });
  };

  return (
    <main className="container-narrow py-16 md:py-24">
      <Helmet><title>Gift Cards | Lixxon Studio</title><meta name="description" content="Give the gift of considered beauty — Lixxon Studio digital gift cards, delivered by email." /></Helmet>
      <header className="text-center mb-12">
        <p className="text-[11px] tracking-editorial uppercase text-bronze mb-3">Gift cards</p>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal mb-4">Give the gift of considered beauty</h1>
        <p className="text-charcoal-light max-w-xl mx-auto">Delivered by email within minutes of purchase. Redeemable on any digital guide in the shop. Never expires.</p>
      </header>

      <form onSubmit={submit} className="grid md:grid-cols-5 gap-10">
        <div className="md:col-span-3 space-y-8">
          <fieldset>
            <legend className="text-[11px] tracking-editorial uppercase text-charcoal-muted mb-3">Amount (USD)</legend>
            <div className="grid grid-cols-4 gap-3">
              {PRESETS.map(p => (
                <button type="button" key={p} onClick={() => { setAmount(p); setCustom(''); }} className={`py-4 border rounded-sm font-serif text-xl transition-colors ${!custom && amount === p ? 'border-bronze bg-bronze text-white' : 'border-taupe text-charcoal hover:border-bronze'}`}>${p}</button>
              ))}
            </div>
            <input type="number" min={5} max={500} step={1} value={custom} onChange={e => setCustom(e.target.value)} placeholder="Or enter a custom amount ($5 – $500)" className="mt-3 w-full px-4 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze" />
          </fieldset>
          <fieldset className="space-y-4">
            <legend className="text-[11px] tracking-editorial uppercase text-charcoal-muted mb-3">Recipient</legend>
            <input value={form.recipient_name} onChange={e => setForm(f => ({ ...f, recipient_name: e.target.value }))} maxLength={80} placeholder="Recipient's name" className="w-full px-4 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze" />
            <input required type="email" value={form.recipient_email} onChange={e => setForm(f => ({ ...f, recipient_email: e.target.value }))} placeholder="Recipient's email" className="w-full px-4 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze" />
            <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} maxLength={300} rows={3} placeholder="A personal message (optional)" className="w-full px-4 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze" />
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button className="inline-flex items-center gap-3 px-8 py-4 bg-bronze text-white text-sm tracking-editorial uppercase rounded-sm hover:bg-bronze-dark transition-colors">
            Continue to checkout <ArrowRight size={16} />
          </button>
          <p className="flex items-center gap-2 text-[11px] text-charcoal-muted"><ShieldCheck size={13} className="text-bronze" /> Amount and recipient are re-validated on our servers before payment.</p>
        </div>

        <aside className="md:col-span-2">
          <div className="sticky top-28 aspect-[1.6/1] rounded-sm bg-charcoal text-cream p-6 flex flex-col justify-between shadow-xl" style={{ background: 'linear-gradient(135deg,#1A1A1A 0%,#3a2f22 100%)' }}>
            <div className="flex items-center justify-between"><span className="text-[10px] tracking-editorial uppercase text-bronze">Lixxon Studio</span><Gift size={18} className="text-bronze" /></div>
            <div>
              <p className="font-serif text-4xl">{formatMoney(value >= 5 && value <= 500 ? value : 0, 'USD')}</p>
              <p className="text-xs text-cream/70 mt-2 flex items-center gap-1.5"><Mail size={12} /> {form.recipient_email || 'recipient@email.com'}</p>
            </div>
            <p className="text-[11px] italic text-cream/80 line-clamp-2">{form.message || 'Your message will appear here.'}</p>
          </div>
        </aside>
      </form>
    </main>
  );
}
