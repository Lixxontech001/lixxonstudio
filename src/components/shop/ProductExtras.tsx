import { useState, type FormEvent } from 'react';
import { Bell, Check, Loader2, Scale, Package } from 'lucide-react';
import type { Product } from '../../lib/types';
import { submitForm, ApiError } from '../../lib/api';
import { useBundlesForProduct, useCurrencyRates } from '../../hooks/useV3';
import { formatMoney, convert, getDisplayCurrency } from '../../lib/money';
import { useCart } from '../../context/CartContext';
import { Link } from '../../context/NavigationContext';
import { parsePrice } from '../../lib/money';

export const COMPARE_KEY = 'lixxon_compare';
export function getCompareIds(): string[] { try { return JSON.parse(localStorage.getItem(COMPARE_KEY) || '[]'); } catch { return []; } }
export function setCompareIds(ids: string[]) { localStorage.setItem(COMPARE_KEY, JSON.stringify(ids.slice(0, 3))); window.dispatchEvent(new Event('lixxon:compare')); }

/** Price in the reader's display currency (USD is what we charge). */
export function DisplayPrice({ usd, className = '' }: { usd: number; className?: string }) {
  const rates = useCurrencyRates();
  const [code, setCode] = useState(getDisplayCurrency());
  useState(() => { const h = (e: Event) => setCode((e as CustomEvent<string>).detail); window.addEventListener('lixxon:currency', h); return () => window.removeEventListener('lixxon:currency', h); });
  if (code === 'USD' || !rates[code]) return null;
  return <span className={className}>≈ {formatMoney(convert(usd, code, rates), code)}</span>;
}

/** Stock state + "notify me" (out of stock / coming soon). */
export function StockNotice({ product }: { product: Product }) {
  const [email, setEmail] = useState(() => localStorage.getItem('lixxon_customer_email') || '');
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const st = product.stock_status || 'in_stock';
  const emailId = `restock-email-${product.id}`;
  const consentId = `restock-consent-${product.id}`;
  if (st === 'in_stock') return null;
  if (st === 'low') return <p className="mt-3 text-xs text-amber-700">Only a few left.</p>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!consent) { setState('error'); setMsg('Please agree to receive one email for this product.'); return; }
    setState('busy'); setMsg('');
    try {
      await submitForm('restock_notify', { product_id: product.id, email, consent: true });
      setState('done');
      setMsg('We will send one email when this product is available. This does not subscribe you to the newsletter.');
    } catch (err) { setState('error'); setMsg((err as ApiError).message); }
  };
  return (
    <form onSubmit={submit} className="mt-6 p-4 border border-taupe/50 rounded-sm bg-white/60">
      <p className="flex items-center gap-2 text-sm font-medium text-charcoal"><Bell size={14} className="text-bronze" /> {st === 'coming_soon' ? 'Coming soon' : 'Currently unavailable'} — get notified</p>
      <div className="mt-3">
        <label htmlFor={emailId} className="sr-only">Email address</label>
        <input id={emailId} required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" className="w-full min-h-11 px-3 py-3 border border-taupe rounded-sm text-sm bg-white focus:outline-none focus:border-bronze" />
      </div>
      <label htmlFor={consentId} className="mt-3 flex min-h-11 items-start gap-3 text-xs text-charcoal-muted">
        <input id={consentId} type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-bronze" />
        <span>Send me one email for this product when it is available. This alert will not sign me up for the newsletter.</span>
      </label>
      <button type="submit" aria-label={state === 'busy' ? 'Saving alert' : state === 'done' ? 'Alert saved' : 'Notify me'} disabled={state === 'busy' || state === 'done' || !consent} className="mt-3 min-h-11 px-4 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60">{state === 'busy' ? <Loader2 size={14} className="animate-spin" /> : state === 'done' ? <Check size={14} /> : 'Notify me'}</button>
      {msg && <p role={state === 'error' ? 'alert' : 'status'} aria-live={state === 'error' ? 'assertive' : 'polite'} className={`mt-2 text-xs ${state === 'error' ? 'text-red-600' : 'text-green-700'}`}>{msg}</p>}
    </form>
  );
}

/** Pay-what-you-want control (floor enforced server-side too). */
export function PayWhatYouWant({ product, value, onChange }: { product: Product; value: number; onChange: (n: number) => void }) {
  if (!product.pay_what_you_want) return null;
  const floor = (product.min_price_cents ?? product.price_cents ?? Math.round(parsePrice(product.price) * 100)) / 100;
  const tiers = [floor, Math.max(floor + 5, Math.round(floor * 1.5)), Math.max(floor + 10, floor * 2)].map(n => Math.round(n));
  return (
    <div className="mt-6">
      <p className="text-[10px] tracking-editorial uppercase text-bronze mb-2">Pay what you want · minimum {formatMoney(floor, 'USD')}</p>
      <div className="flex flex-wrap gap-2 items-center">
        {tiers.map(t => <button type="button" key={t} onClick={() => onChange(t)} className={`px-4 py-2 border rounded-sm text-sm ${value === t ? 'border-bronze bg-bronze text-white' : 'border-taupe hover:border-bronze'}`}>${t}</button>)}
        <div className="flex items-center border border-taupe rounded-sm px-3"><span className="text-sm text-charcoal-muted">$</span><input type="number" min={floor} max={1000} step={1} value={value} onChange={e => onChange(Math.max(floor, Number(e.target.value) || floor))} className="w-20 py-2 pl-1 text-sm bg-transparent focus:outline-none" aria-label="Custom amount" /></div>
      </div>
      <p className="mt-2 text-xs text-charcoal-muted">Paying more directly supports independent, ad-light beauty journalism.</p>
    </div>
  );
}

export function CompareButton({ product }: { product: Product }) {
  const [ids, setIds] = useState(getCompareIds);
  const on = ids.includes(product.id);
  const toggle = () => {
    const next = on ? ids.filter(i => i !== product.id) : [...ids, product.id].slice(-3);
    setCompareIds(next); setIds(next);
  };
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={toggle} aria-pressed={on} className={`inline-flex items-center gap-2 text-xs ${on ? 'text-bronze' : 'text-charcoal-muted hover:text-bronze'}`}><Scale size={14} /> {on ? 'In comparison' : 'Compare'}</button>
      {ids.length >= 2 && <Link to={{ name: 'product-comparison' }} className="text-xs text-bronze hover:underline">Compare {ids.length} →</Link>}
    </div>
  );
}

export function BundleOffers({ product }: { product: Product }) {
  const { bundles } = useBundlesForProduct(product.id);
  const { addItem, openCart } = useCart();
  if (!bundles.length) return null;
  return (
    <section className="mt-10" aria-labelledby="bundles-h">
      <h2 id="bundles-h" className="flex items-center gap-2 text-[10px] tracking-editorial uppercase text-bronze mb-4"><Package size={14} /> Better together</h2>
      <div className="space-y-4">
        {bundles.map(b => {
          const items = (b.items || []).map(i => i.product).filter(Boolean);
          const full = items.reduce((s, p) => s + parsePrice(p.price), 0);
          const saving = Math.max(0, full - Number(b.bundle_price));
          return (
            <div key={b.id} className="p-5 border border-taupe/50 rounded-sm bg-white/60">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-serif text-xl text-charcoal">{b.name}</h3>
                <p className="text-sm"><span className="font-medium text-charcoal">{formatMoney(Number(b.bundle_price), 'USD')}</span> {saving > 0 && <span className="text-charcoal-muted line-through ml-2">{formatMoney(full, 'USD')}</span>} {saving > 0 && <span className="ml-2 text-green-700">save {formatMoney(saving, 'USD')}</span>}</p>
              </div>
              {b.description && <p className="text-sm text-charcoal-light mt-1">{b.description}</p>}
              <ul className="mt-3 flex flex-wrap gap-2 text-xs text-charcoal-muted">{items.map(p => <li key={p.id} className="px-2 py-1 bg-taupe-light/60 rounded-sm">{p.name}</li>)}</ul>
              <button onClick={() => { items.forEach(p => addItem({ id: p.id, name: p.name, slug: p.slug || p.id, price: parsePrice(p.price), image_url: p.image_url, is_digital: true })); openCart(); }} className="mt-4 px-5 py-2.5 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze transition-colors">Add all to cart</button>
              <p className="mt-2 text-[11px] text-charcoal-muted">Bundle pricing is applied automatically at checkout.</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
