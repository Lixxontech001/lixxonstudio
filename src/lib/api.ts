/**
 * Typed client for the hardened edge functions.
 * Every public write (orders, forms, downloads) goes through here — never direct table writes.
 */
import { supabase, supabaseUrl, supabaseAnonKey } from './supabaseClient';
import { fetchWithRetry, TimeoutError } from './fetchWithTimeout';

const BASE = `${supabaseUrl}/functions/v1`;
const ANON = supabaseAnonKey as string;

export class ApiError extends Error {
  status: number;
  field?: string;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

async function authHeader(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    return `Bearer ${data.session?.access_token || ANON}`;
  } catch {
    return `Bearer ${ANON}`;
  }
}

export async function callFn<T = Record<string, unknown>>(name: string, body: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
  try {
    const res = await fetchWithRetry(`${BASE}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await authHeader(), apikey: ANON },
      body: JSON.stringify(body ?? {}),
    }, opts.timeoutMs ?? 12_000);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(String(data.error || `Request failed (${res.status})`), res.status, data.field as string | undefined);
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof TimeoutError) throw new ApiError('The request timed out. Please try again.', 408);
    throw new ApiError('Network error. Check your connection and try again.', 0);
  }
}

// ---------------------------------------------------------------- commerce
export interface QuoteItem { id: string | null; name: string; slug: string; unit_price: number; quantity: number; line_total: number }
export interface Quote {
  currency: string; subtotal: number; discount: number; gift_card_amount: number; amount: number;
  promo: { code: string; discount_type: string; discount_value: number } | null;
  bundle?: { id: string; name: string; saving: number } | null;
  items: QuoteItem[];
}
export interface CartLineInput { id: string; quantity: number; pwyw_price?: number }
export interface GiftCardInput { amount: number; recipient_email: string; recipient_name?: string; message?: string }

export function quoteOrder(input: { items: CartLineInput[]; promo_code?: string; gift_card_code?: string; gift_card?: GiftCardInput }) {
  return callFn<{ ok: true; quote: Quote }>('create-order', { mode: 'quote', ...input });
}
export function createOrder(input: { items: CartLineInput[]; promo_code?: string; gift_card_code?: string; gift_card?: GiftCardInput; email: string; name: string }) {
  return callFn<{ ok: true; order_id: string; order_number: string; amount: number; currency: string; fully_covered: boolean; entitlements: Entitlement[]; quote: Quote }>('create-order', { mode: 'create', ...input });
}
export interface Entitlement { product_id: string; product_name: string; download_token: string }
export function verifyPayment(input: { transaction_id: string | number; order_id: string }) {
  return callFn<{ verified: boolean; status?: string; order_number?: string; customer_email?: string; entitlements?: Entitlement[]; error?: string }>('verify-payment', input, { timeoutMs: 45000 });
}
export function requestDownload(token: string) {
  return callFn<{ ok: true; url: string; product_name: string | null; remaining: number }>('download-file', { token });
}
export function lookupOrder(order_number: string, email: string) {
  return callFn<{ ok: true; order: { order_number: string; status: string; payment_status: string; amount: number; currency: string; created_at: string; paid_at: string | null; items: { product_name: string; quantity: number }[] } }>('order-status', { order_number, email });
}

// ---------------------------------------------------------------- forms
type FormKind = 'comment' | 'review' | 'contact' | 'feedback' | 'newsletter' | 'newsletter_confirm' | 'newsletter_unsubscribe' | 'newsletter_prefs' | 'question' | 'restock_notify' | 'comment_report' | 'comment_edit';
export function submitForm<T = { ok: true; message?: string; pending?: boolean; confirmed?: boolean; already?: boolean; id?: string; email?: string }>(kind: FormKind, fields: Record<string, unknown>) {
  // `website` is the honeypot; real users never fill it
  return callFn<T>('submit-form', { kind, website: '', ...fields });
}
