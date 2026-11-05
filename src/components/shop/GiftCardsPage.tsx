import { useState, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { Gift, ShieldCheck, Mail, ArrowRight, User, Sparkles } from 'lucide-react';
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
    <main className="container-narrow py-16 md:py-24 text-charcoal dark:text-gray-100 transition-colors">
      <Helmet>
        <title>Gift Cards | Lixxon Studio</title>
        <meta name="description" content="Give the gift of considered beauty — Lixxon Studio digital gift cards, delivered by email." />
      </Helmet>
      
      <header className="text-center mb-12">
        <p className="text-[11px] tracking-editorial uppercase text-bronze dark:text-bronze-light mb-3">Gift cards</p>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal dark:text-white mb-4">Give the gift of considered beauty</h1>
        <p className="text-charcoal-light dark:text-gray-300 max-w-xl mx-auto">
          Delivered by email within minutes of purchase. Redeemable on any digital guide in the shop. Never expires.
        </p>
      </header>

      <form onSubmit={submit} className="grid md:grid-cols-5 gap-10 items-start">
        <div className="md:col-span-3 space-y-8">
          <fieldset>
            <legend className="text-[11px] tracking-editorial uppercase text-charcoal-muted dark:text-gray-400 mb-3 font-medium">
              Amount (USD)
            </legend>
            <div className="grid grid-cols-4 gap-3">
              {PRESETS.map(p => (
                <button
                  type="button"
                  key={p}
                  onClick={() => { setAmount(p); setCustom(''); }}
                  className={`py-4 border rounded-sm font-serif text-xl transition-all ${
                    !custom && amount === p
                      ? 'border-bronze bg-bronze text-white shadow-sm'
                      : 'border-taupe dark:border-white/15 text-charcoal dark:text-gray-200 dark:bg-[#161616] hover:border-bronze dark:hover:border-bronze'
                  }`}
                >
                  ${p}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={5}
              max={500}
              step={1}
              value={custom}
              onChange={e => setCustom(e.target.value)}
              placeholder="Or enter a custom amount ($5 – $500)"
              className="mt-3 w-full px-4 py-3 border border-taupe dark:border-white/15 rounded-sm text-sm bg-white dark:bg-[#161616] text-charcoal dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-bronze transition-colors"
            />
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-[11px] tracking-editorial uppercase text-charcoal-muted dark:text-gray-400 mb-3 font-medium">
              Recipient &amp; Delivery
            </legend>
            <div>
              <label htmlFor="gift-recipient-name" className="sr-only">Recipient's name</label>
              <input
                id="gift-recipient-name"
                value={form.recipient_name}
                onChange={e => setForm(f => ({ ...f, recipient_name: e.target.value }))}
                maxLength={80}
                placeholder="Recipient's name (e.g. Clara Devereux)"
                className="w-full px-4 py-3 border border-taupe dark:border-white/15 rounded-sm text-sm bg-white dark:bg-[#161616] text-charcoal dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-bronze transition-colors"
              />
            </div>
            <div>
              <label htmlFor="gift-recipient-email" className="sr-only">Recipient's email</label>
              <input
                id="gift-recipient-email"
                required
                type="email"
                value={form.recipient_email}
                onChange={e => setForm(f => ({ ...f, recipient_email: e.target.value }))}
                placeholder="Recipient's email (e.g. clara@example.com)"
                className="w-full px-4 py-3 border border-taupe dark:border-white/15 rounded-sm text-sm bg-white dark:bg-[#161616] text-charcoal dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-bronze transition-colors"
              />
            </div>
            <div>
              <label htmlFor="gift-recipient-message" className="sr-only">A personal message</label>
              <textarea
                id="gift-recipient-message"
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                maxLength={300}
                rows={3}
                placeholder="A personal message (optional)..."
                className="w-full px-4 py-3 border border-taupe dark:border-white/15 rounded-sm text-sm bg-white dark:bg-[#161616] text-charcoal dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-bronze transition-colors resize-none"
              />
            </div>
          </fieldset>

          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>}
          
          <button className="inline-flex items-center justify-center gap-3 w-full sm:w-auto px-8 py-4 bg-bronze text-white text-sm tracking-editorial uppercase rounded-sm hover:bg-bronze-dark transition-all shadow-sm">
            <span>Continue to checkout</span> <ArrowRight size={16} />
          </button>
          
          <p className="flex items-center gap-2 text-[11px] text-charcoal-muted dark:text-gray-400">
            <ShieldCheck size={14} className="text-bronze flex-shrink-0" />
            <span>Amount and recipient are re-validated on our servers before payment.</span>
          </p>
        </div>

        {/* Live Luxury Digital Gift Card Preview */}
        <aside className="md:col-span-2">
          <div className="sticky top-28 space-y-3">
            <p className="text-[11px] uppercase tracking-editorial font-semibold text-charcoal-muted dark:text-gray-400 flex items-center gap-1.5">
              <Sparkles size={13} className="text-bronze" /> Live Card Preview
            </p>

            <div
              className="relative aspect-[1.6/1] rounded-md text-cream p-6 flex flex-col justify-between shadow-2xl overflow-hidden border border-amber-500/30 group"
              style={{
                background: 'linear-gradient(135deg, #161616 0%, #2A2016 50%, #3D2D1B 100%)',
              }}
            >
              {/* Subtle gold foil sheen effect */}
              <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_top_right,rgba(212,175,55,0.4),transparent_70%)]" />

              {/* Card Header */}
              <div className="relative z-10 flex items-center justify-between">
                <span className="text-[10px] tracking-ultra-wide uppercase font-bold text-amber-300/90">
                  Lixxon Studio · Digital Gift
                </span>
                <div className="p-1.5 rounded-full bg-white/10 text-amber-300">
                  <Gift size={16} />
                </div>
              </div>

              {/* Card Body: Amount & Recipient */}
              <div className="relative z-10 space-y-1">
                <p className="font-serif text-3xl sm:text-4xl text-white font-light tracking-tight">
                  {formatMoney(value >= 5 && value <= 500 ? value : 0, 'USD')}
                </p>

                <div className="pt-2 border-t border-white/10 space-y-1">
                  <p className="text-xs font-medium text-amber-200/95 flex items-center gap-1.5">
                    <User size={12} className="text-amber-400/80" />
                    <span>{form.recipient_name.trim() || 'Valued Recipient'}</span>
                  </p>
                  <p className="text-[11px] text-cream/70 flex items-center gap-1.5 truncate">
                    <Mail size={11} className="text-cream/50 flex-shrink-0" />
                    <span className="truncate">{form.recipient_email.trim() || 'recipient@email.com'}</span>
                  </p>
                </div>
              </div>

              {/* Card Footer: Message Preview */}
              <div className="relative z-10 pt-2 border-t border-white/10">
                <p className="text-[11px] italic text-cream/80 line-clamp-2 leading-relaxed font-light">
                  "{form.message.trim() || 'Wishing you the gift of considered beauty and mindful daily rituals.'}"
                </p>
              </div>
            </div>

            <p className="text-[10px] text-charcoal-muted dark:text-gray-500 text-center">
              Delivered instantly to recipient upon completed checkout.
            </p>
          </div>
        </aside>
      </form>
    </main>
  );
}
