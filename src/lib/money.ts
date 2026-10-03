/**
 * Money formatting + multi-currency *display*.
 * Charges always happen in the checkout currency (USD); other currencies are informational,
 * converted with rates cached in `currency_rates` (refreshed daily by the free FX edge function).
 */
const SYMBOLS: Record<string, string> = { USD: '$', NGN: '₦', GBP: '£', EUR: '€', CAD: 'CA$', GHS: 'GH₵', KES: 'KSh', ZAR: 'R' };

export function formatMoney(amount: number, currency = 'USD', locale?: string): string {
  try {
    return new Intl.NumberFormat(locale || undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${SYMBOLS[currency] || currency + ' '}${amount.toFixed(2)}`;
  }
}

export function parsePrice(price: string | number | null | undefined): number {
  if (typeof price === 'number') return price;
  const n = parseFloat(String(price || '0').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const KEY = 'lixxon_display_currency';
export function getDisplayCurrency(): string {
  try { return localStorage.getItem(KEY) || 'USD'; } catch { return 'USD'; }
}
export function setDisplayCurrency(code: string) {
  try { localStorage.setItem(KEY, code); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('lixxon:currency', { detail: code }));
}

/** Convert USD → display currency using a rates map (1 USD = rate × code). */
export function convert(amountUsd: number, code: string, rates: Record<string, number>): number {
  const r = rates[code];
  return r && r > 0 ? amountUsd * r : amountUsd;
}
