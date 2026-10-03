import { useEffect, useState } from 'react';
import { useCurrencyRates } from '../hooks/useV3';
import { getDisplayCurrency, setDisplayCurrency } from '../lib/money';

/** Display-currency switcher (rates cached daily in `currency_rates`; charges stay in USD). */
export default function CurrencySelector({ className = '' }: { className?: string }) {
  const rates = useCurrencyRates();
  const [code, setCode] = useState(getDisplayCurrency());
  useEffect(() => { const h = (e: Event) => setCode((e as CustomEvent<string>).detail); window.addEventListener('lixxon:currency', h); return () => window.removeEventListener('lixxon:currency', h); }, []);
  const codes = ['USD', ...Object.keys(rates).filter(c => c !== 'USD').sort()];
  if (codes.length < 2) return null;
  return (
    <label className={`inline-flex items-center gap-2 text-xs text-white/40 ${className}`}>
      <span className="sr-only">Display currency</span>
      <select value={code} onChange={e => { setCode(e.target.value); setDisplayCurrency(e.target.value); }} className="bg-transparent border border-white/15 rounded-sm px-2 py-1 text-white/60 text-xs focus:outline-none focus:border-bronze">
        {codes.map(c => <option key={c} value={c} className="text-charcoal">{c}</option>)}
      </select>
    </label>
  );
}
