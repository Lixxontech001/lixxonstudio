/**
 * Money formatting + multi-currency *display*.
 * Charges always happen in the checkout currency (USD); other currencies are informational,
 * converted with rates cached in `currency_rates` (refreshed daily by the free FX edge function).
 */
const SYMBOLS: Record<string, string> = { USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', GHS: 'GH₵', KES: 'KSh', ZAR: 'R' };

/** Currencies the site never offers to readers, whatever the rates table holds. Charges and prices stay in USD. */
export const HIDDEN_DISPLAY_CURRENCIES: readonly string[] = ['NGN'];

export function isShownCurrency(code: string): boolean {
  return !HIDDEN_DISPLAY_CURRENCIES.includes(String(code).toUpperCase());
}

/** The codes a reader can pick: USD first, then the other shown codes from the rates, sorted. */
export function displayCurrencyCodes(rates: Record<string, number>): string[] {
  return ['USD', ...Object.keys(rates).filter((code) => code !== 'USD' && isShownCurrency(code)).sort()];
}

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
  try {
    const saved = localStorage.getItem(KEY) || 'USD';
    return isShownCurrency(saved) ? saved : 'USD';
  } catch { return 'USD'; }
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
