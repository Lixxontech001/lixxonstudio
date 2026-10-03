import { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, AlertCircle, Download, ShoppingBag, Mail, FileText, Tag, Gift, X, ShieldCheck } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { useCart } from '../../context/CartContext';
import { useNavigation, Link } from '../../context/NavigationContext';
import { useAuth } from '../../context/AuthContext';
import { quoteOrder, createOrder, verifyPayment, ApiError, type Quote, type Entitlement, type GiftCardInput } from '../../lib/api';
import { useDownload } from '../../hooks/useDownload';
import { escapeHtml } from '../../lib/sanitize';
import { formatMoney } from '../../lib/money';

type CheckoutStatus = 'form' | 'processing' | 'awaiting' | 'success' | 'error';

interface OrderResult {
  orderNumber: string;
  customerEmail: string;
  customerName: string;
  downloads: Entitlement[];
  quote: Quote;
}

declare global {
  interface Window {
    FlutterwaveCheckout?: (config: Record<string, unknown>) => { close?: () => void } | void;
  }
}

function loadFlutterwave(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window.FlutterwaveCheckout === 'function') return resolve();
    const existing = document.querySelector<HTMLScriptElement>('script[data-flw]');
    if (existing) { existing.addEventListener('load', () => resolve()); existing.addEventListener('error', () => reject(new Error('load'))); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.flutterwave.com/v3.js';
    s.async = true;
    s.dataset.flw = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('load'));
    document.head.appendChild(s);
  });
}

const GIFT_KEY = 'lixxon_gift_card';
function readGiftPurchase(): GiftCardInput | null {
  try {
    const raw = sessionStorage.getItem(GIFT_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw);
    return g && typeof g.amount === 'number' && typeof g.recipient_email === 'string' ? g : null;
  } catch { return null; }
}

export default function CheckoutPage() {
  const { items, clearCart } = useCart();
  const { navigate } = useNavigation();
  const { email: sessionEmail, signInWithMagicLink } = useAuth();
  const { download, busyToken } = useDownload();

  const [status, setStatus] = useState<CheckoutStatus>('form');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [form, setForm] = useState({ name: '', email: sessionEmail || '' });
  const [promoInput, setPromoInput] = useState('');
  const [giftInput, setGiftInput] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [giftCode, setGiftCode] = useState('');
  const [showPromo, setShowPromo] = useState(false);
  const [showGift, setShowGift] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  const flutterwavePublicKey = import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY as string | undefined;
  // optional gift-card purchase handed over by /shop/gift-cards (validated again server-side)
  const [giftPurchase, setGiftPurchase] = useState<GiftCardInput | null>(() => readGiftPurchase());
  const hasOrder = items.length > 0 || !!giftPurchase;
  const cartKey = items.map(i => `${i.id}:${i.quantity}:${i.pwyw_price ?? ''}`).join('|');
  const quoteReq = useRef(0);

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => { if (sessionEmail && !form.email) setForm(p => ({ ...p, email: sessionEmail })); }, [sessionEmail, form.email]);

  // ---- authoritative quote from the server whenever cart / codes change
  const refreshQuote = useCallback(async () => {
    if (!hasOrder) { setQuote(null); return; }
    const id = ++quoteReq.current;
    setQuoting(true);
    setQuoteError('');
    try {
      const res = await quoteOrder({
        items: items.map(i => ({ id: i.id, quantity: i.quantity, pwyw_price: i.pwyw_price })),
        promo_code: promoCode || undefined,
        gift_card_code: giftCode || undefined,
        gift_card: giftPurchase || undefined,
      });
      if (id === quoteReq.current) setQuote(res.quote);
    } catch (e) {
      if (id !== quoteReq.current) return;
      const err = e as ApiError;
      if (err.field === 'promo_code') { setPromoCode(''); setQuoteError(err.message); }
      else if (err.field === 'gift_card_code') { setGiftCode(''); setQuoteError(err.message); }
      else setQuoteError(err.message || 'Could not price your cart.');
    } finally {
      if (id === quoteReq.current) setQuoting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey, promoCode, giftCode, giftPurchase]);

  useEffect(() => { refreshQuote(); }, [refreshQuote]);

  const total = quote?.amount ?? 0;
  const currency = quote?.currency || 'USD';

  const finish = useCallback((result: OrderResult) => {
    localStorage.setItem('lixxon_customer_email', result.customerEmail);
    clearCart();
    sessionStorage.removeItem(GIFT_KEY);
    setGiftPurchase(null);
    setOrderResult(result);
    setStatus('success');
    window.scrollTo(0, 0);
  }, [clearCart]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setFieldError(undefined);
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name) { setFieldError('name'); setError('Please enter your name.'); setStatus('error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError('email'); setError('Please enter a valid email address.'); setStatus('error'); return; }
    if (!quote) { setError('Please wait for your order total.'); setStatus('error'); return; }
    if (quote.amount > 0 && !flutterwavePublicKey) { setError('Card payments are not configured yet. Please contact us to complete this order.'); setStatus('error'); return; }

    setStatus('processing');
    try {
      // 1. server creates the order with authoritative pricing
      const order = await createOrder({
        items: items.map(i => ({ id: i.id, quantity: i.quantity, pwyw_price: i.pwyw_price })),
        promo_code: promoCode || undefined,
        gift_card_code: giftCode || undefined,
        gift_card: giftPurchase || undefined,
        email, name,
      });

      // 2. fully covered by promo/gift card → done
      if (order.fully_covered) {
        finish({ orderNumber: order.order_number, customerEmail: email, customerName: name, downloads: order.entitlements || [], quote: order.quote });
        return;
      }

      // 3. otherwise collect payment
      await loadFlutterwave();
      if (typeof window.FlutterwaveCheckout !== 'function') throw new ApiError('Payment window failed to load. Disable ad blockers and try again.', 0);
      setStatus('awaiting');
      let settled = false;
      window.FlutterwaveCheckout({
        public_key: flutterwavePublicKey,
        tx_ref: order.order_number,
        amount: order.amount,
        currency: order.currency,
        payment_options: 'card,banktransfer,ussd,account',
        customer: { email, name },
        customizations: { title: 'Lixxon Studio', description: `Order ${order.order_number}`, logo: `${window.location.origin}/assets/images/Lixxon_Studio..png` },
        callback: async (response: { transaction_id: string | number; status: string }) => {
          settled = true;
          setStatus('processing');
          try {
            const v = await verifyPayment({ transaction_id: response.transaction_id, order_id: order.order_id });
            if (v.verified) finish({ orderNumber: order.order_number, customerEmail: email, customerName: name, downloads: v.entitlements || [], quote: order.quote });
            else { setError(v.error || 'Payment could not be verified. If you were charged, contact us with your order number.'); setStatus('error'); }
          } catch (err) {
            setError(`${(err as Error).message} Your order number is ${order.order_number} — if you were charged we'll reconcile it automatically.`);
            setStatus('error');
          }
        },
        onclose: () => {
          if (!settled) { setError('Payment was closed before completion. Your cart is still here when you are ready.'); setStatus('error'); }
        },
      });
    } catch (err) {
      const e2 = err as ApiError;
      setFieldError(e2.field);
      setError(e2.message || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  const applyPromo = (e: React.FormEvent) => { e.preventDefault(); setQuoteError(''); setPromoCode(promoInput.trim().toUpperCase()); };
  const applyGift = (e: React.FormEvent) => { e.preventDefault(); setQuoteError(''); setGiftCode(giftInput.trim().toUpperCase()); };

  const sendLink = async () => {
    if (!orderResult) return;
    const { error: err } = await signInWithMagicLink(orderResult.customerEmail, `${window.location.origin}/account/downloads`);
    if (!err) setLinkSent(true);
  };

  if (!hasOrder && status !== 'success') {
    return (
      <main>
        <Helmet><title>Checkout | Lixxon Studio</title><meta name="robots" content="noindex, nofollow" /></Helmet>
        <section className="container-narrow py-24 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-8">
            <ShoppingBag size={24} strokeWidth={1.5} className="text-bronze" />
          </div>
          <h1 className="font-serif text-3xl text-charcoal font-light">Your cart is empty</h1>
          <p className="text-charcoal-muted text-base mt-4">Add items to your cart before checking out.</p>
          <Link to={{ name: 'shop' }} className="inline-flex items-center gap-3 mt-8 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm">
            Browse Shop <ArrowRight size={14} />
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main>
      <Helmet><title>Checkout | Lixxon Studio</title><meta name="robots" content="noindex, nofollow" /></Helmet>

      {status === 'success' && orderResult ? (
        <section className="container-narrow py-16 md:py-24">
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-50 border border-green-200 mb-8">
              <Check size={36} strokeWidth={1.5} className="text-green-600" />
            </div>
            <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Order Confirmed</p>
            <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light">Thank you for your purchase</h1>
            <p className="text-charcoal-muted text-lg mt-5 max-w-md mx-auto leading-relaxed">
              Your order <strong className="text-charcoal">{orderResult.orderNumber}</strong> has been confirmed.
            </p>
          </div>

          <div className="max-w-2xl mx-auto mb-8">
            <button onClick={() => downloadReceipt(orderResult)} className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 border border-charcoal text-charcoal text-sm hover:bg-charcoal hover:text-white transition-all rounded-sm">
              <FileText size={16} strokeWidth={1.5} /> Download Receipt (PDF)
            </button>
          </div>

          <div className="bg-taupe-light/40 border border-taupe/30 rounded-sm p-5 mb-8 flex items-start gap-4 max-w-2xl mx-auto">
            <Mail size={20} className="text-bronze flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-charcoal font-medium">A receipt{orderResult.downloads.length ? ' and your download links' : ''} went to {orderResult.customerEmail}</p>
              <p className="text-xs text-charcoal-muted mt-1">Didn't get it? Check spam, or sign in below to access your purchases any time.</p>
              {!sessionEmail && (
                linkSent
                  ? <p className="text-xs text-green-700 mt-2 inline-flex items-center gap-1"><Check size={12} /> Sign-in link sent — check your inbox.</p>
                  : <button onClick={sendLink} className="text-xs text-bronze hover:underline mt-2 tracking-editorial uppercase">Email me a sign-in link</button>
              )}
            </div>
          </div>

          {orderResult.downloads.length > 0 && (
            <div className="max-w-2xl mx-auto">
              <h2 className="font-serif text-2xl text-charcoal font-light mb-6">Your Downloads</h2>
              <div className="space-y-4">
                {orderResult.downloads.map((dl) => (
                  <div key={dl.download_token} className="bg-white border border-taupe/30 rounded-sm p-5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-sm bg-bronze/10 flex items-center justify-center flex-shrink-0"><Download size={20} className="text-bronze" /></div>
                      <p className="font-serif text-base text-charcoal truncate">{dl.product_name}</p>
                    </div>
                    <button onClick={() => download(dl.download_token)} disabled={busyToken === dl.download_token} className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all whitespace-nowrap flex-shrink-0 disabled:opacity-60">
                      {busyToken === dl.download_token ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link to={{ name: 'account-downloads' }} className="inline-flex items-center justify-center gap-3 px-8 py-4 border border-charcoal text-charcoal text-xs tracking-editorial uppercase font-medium hover:bg-charcoal hover:text-white transition-all duration-500 rounded-sm">Go to My Downloads</Link>
            <Link to={{ name: 'shop' }} className="inline-flex items-center justify-center gap-3 px-8 py-4 border border-charcoal text-charcoal text-xs tracking-editorial uppercase font-medium hover:bg-charcoal hover:text-white transition-all duration-500 rounded-sm">Continue Shopping</Link>
          </div>
        </section>
      ) : (
        <section className="container-wide pt-12 pb-16">
          <button onClick={() => navigate({ name: 'cart' })} className="inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors mb-8">
            <ArrowLeft size={14} strokeWidth={1.5} /> Back to Cart
          </button>
          <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light mb-12">Checkout</h1>

          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16">
            <div>
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div>
                  <label htmlFor="checkout-name" className="block text-[10px] tracking-editorial uppercase text-charcoal-muted mb-2">Full Name</label>
                  <input id="checkout-name" type="text" autoComplete="name" value={form.name} onChange={e => { setForm(p => ({ ...p, name: e.target.value })); if (status === 'error') setStatus('form'); }} placeholder="Your full name"
                    aria-invalid={fieldError === 'name'} className={`w-full bg-white border px-4 py-3.5 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm ${fieldError === 'name' ? 'border-red-400' : 'border-taupe/50'}`} />
                </div>
                <div>
                  <label htmlFor="checkout-email" className="block text-[10px] tracking-editorial uppercase text-charcoal-muted mb-2">Email Address</label>
                  <input id="checkout-email" type="email" autoComplete="email" value={form.email} onChange={e => { setForm(p => ({ ...p, email: e.target.value })); if (status === 'error') setStatus('form'); }} placeholder="your@email.com"
                    aria-invalid={fieldError === 'email'} className={`w-full bg-white border px-4 py-3.5 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm ${fieldError === 'email' ? 'border-red-400' : 'border-taupe/50'}`} />
                  <p className="text-xs text-charcoal-muted mt-2">Receipt and downloads go here. Sign in later with this email — no password needed.</p>
                </div>

                {status === 'error' && (
                  <div role="alert" className="flex items-start gap-3 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-sm">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
                  </div>
                )}
                {status === 'awaiting' && (
                  <div className="flex items-start gap-3 text-sm text-charcoal bg-taupe-light/60 border border-taupe/40 px-4 py-3 rounded-sm">
                    <Loader2 size={16} className="flex-shrink-0 mt-0.5 animate-spin" /><span>Complete the payment in the secure Flutterwave window…</span>
                  </div>
                )}

                <button type="submit" disabled={status === 'processing' || status === 'awaiting' || quoting || !quote}
                  className="w-full inline-flex items-center justify-center gap-3 px-8 py-4 bg-bronze text-white text-sm tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 rounded-sm disabled:opacity-60">
                  {status === 'processing' ? <><Loader2 size={16} className="animate-spin" /> Processing…</>
                    : quoting || !quote ? <><Loader2 size={16} className="animate-spin" /> Calculating…</>
                    : total === 0 ? <>Complete Order — Free</>
                    : <>Pay {formatMoney(total, currency)}</>}
                </button>
                <p className="flex items-center justify-center gap-2 text-[11px] text-charcoal-muted"><ShieldCheck size={13} className="text-bronze" /> Prices are verified server-side · Payments secured by Flutterwave</p>
              </form>
            </div>

            <div>
              <div className="bg-taupe-light/40 rounded-sm p-6 border border-taupe/30">
                <h3 className="font-serif text-xl text-charcoal mb-4">Order Summary</h3>
                <div className="space-y-3 mb-4">
                  {items.map(item => {
                    const q = quote?.items.find(qi => qi.id === item.id);
                    return (
                      <div key={item.id} className="flex gap-3 pb-3 border-b border-taupe/30 last:border-0">
                        <div className="w-14 h-14 rounded-sm overflow-hidden bg-taupe-light flex-shrink-0">
                          {item.image_url && <img src={item.image_url} alt="" className="w-full h-full object-cover" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-charcoal font-medium line-clamp-2">{item.name}</p>
                          <p className="text-xs text-charcoal-muted">Qty: {item.quantity}</p>
                        </div>
                        <p className="text-sm text-charcoal flex-shrink-0">{q ? formatMoney(q.line_total, currency) : '—'}</p>
                      </div>
                    );
                  })}
                  {giftPurchase && (
                    <div className="flex gap-3 pb-3 border-b border-taupe/30 last:border-0">
                      <div className="w-14 h-14 rounded-sm bg-bronze/10 flex items-center justify-center flex-shrink-0 text-bronze font-serif text-lg">🎁</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-charcoal font-medium">Gift card for {giftPurchase.recipient_name || giftPurchase.recipient_email}</p>
                        <button type="button" onClick={() => { sessionStorage.removeItem(GIFT_KEY); setGiftPurchase(null); }} className="text-xs text-charcoal-muted hover:text-red-600">Remove</button>
                      </div>
                      <p className="text-sm text-charcoal flex-shrink-0">{formatMoney(giftPurchase.amount, currency)}</p>
                    </div>
                  )}
                </div>

                <div className="border-t border-taupe/50 pt-4 space-y-2">
                  <div className="flex justify-between text-sm text-charcoal-muted"><span>Subtotal</span><span>{quote ? formatMoney(quote.subtotal, currency) : '—'}</span></div>
                  {quote && quote.discount > 0 && (
                    <div className="flex justify-between text-sm text-green-700"><span>Discount{quote.promo ? ` (${quote.promo.code})` : ''}</span><span>−{formatMoney(quote.discount, currency)}</span></div>
                  )}
                  {quote?.bundle && quote.bundle.saving > 0 && (
                    <div className="flex justify-between text-sm text-green-700"><span>Bundle: {quote.bundle.name}</span><span>−{formatMoney(quote.bundle.saving, currency)}</span></div>
                  )}
                  {quote && quote.gift_card_amount > 0 && (
                    <div className="flex justify-between text-sm text-green-700"><span>Gift card</span><span>−{formatMoney(quote.gift_card_amount, currency)}</span></div>
                  )}

                  {/* promo */}
                  <div className="pt-2">
                    {promoCode ? (
                      <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-sm">
                        <Check size={16} className="text-green-600 flex-shrink-0" />
                        <p className="flex-1 text-sm text-green-800 font-medium">{promoCode} applied</p>
                        <button type="button" onClick={() => { setPromoCode(''); setPromoInput(''); }} aria-label="Remove promo code" className="text-green-600 hover:text-green-800"><X size={16} /></button>
                      </div>
                    ) : !showPromo ? (
                      <button type="button" onClick={() => setShowPromo(true)} className="inline-flex items-center gap-2 text-xs text-charcoal-muted hover:text-bronze transition-colors"><Tag size={12} strokeWidth={1.5} /> Have a promo code?</button>
                    ) : (
                      <form onSubmit={applyPromo} className="flex gap-2">
                        <input value={promoInput} onChange={e => setPromoInput(e.target.value.toUpperCase())} placeholder="ENTER CODE" aria-label="Promo code" className="flex-1 border border-taupe/50 px-3 py-2.5 text-sm uppercase tracking-wide rounded-sm focus:outline-none focus:border-bronze" />
                        <button type="submit" disabled={quoting || !promoInput.trim()} className="px-4 py-2.5 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze disabled:opacity-50">{quoting ? <Loader2 size={12} className="animate-spin" /> : 'Apply'}</button>
                      </form>
                    )}
                  </div>
                  {/* gift card */}
                  <div>
                    {giftCode ? (
                      <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-sm">
                        <Gift size={16} className="text-green-600 flex-shrink-0" />
                        <p className="flex-1 text-sm text-green-800 font-medium">Gift card applied</p>
                        <button type="button" onClick={() => { setGiftCode(''); setGiftInput(''); }} aria-label="Remove gift card" className="text-green-600 hover:text-green-800"><X size={16} /></button>
                      </div>
                    ) : !showGift ? (
                      <button type="button" onClick={() => setShowGift(true)} className="inline-flex items-center gap-2 text-xs text-charcoal-muted hover:text-bronze transition-colors"><Gift size={12} strokeWidth={1.5} /> Redeem a gift card</button>
                    ) : (
                      <form onSubmit={applyGift} className="flex gap-2">
                        <input value={giftInput} onChange={e => setGiftInput(e.target.value.toUpperCase())} placeholder="LXG-XXXX-XXXX-XXXX" aria-label="Gift card code" className="flex-1 border border-taupe/50 px-3 py-2.5 text-sm uppercase tracking-wide rounded-sm focus:outline-none focus:border-bronze" />
                        <button type="submit" disabled={quoting || !giftInput.trim()} className="px-4 py-2.5 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze disabled:opacity-50">{quoting ? <Loader2 size={12} className="animate-spin" /> : 'Apply'}</button>
                      </form>
                    )}
                  </div>
                  {quoteError && <p className="text-xs text-red-600">{quoteError}</p>}

                  <div className="flex justify-between pt-3 border-t border-taupe/40">
                    <span className="font-serif text-lg text-charcoal">Total</span>
                    <span className="font-serif text-xl text-charcoal">{quote ? formatMoney(total, currency) : '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function downloadReceipt(order: OrderResult) {
  const q = order.quote;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const win = window.open('', '_blank');
  if (!win) return;
  const row = (l: string, r: string, style = '') => `<div style="display:flex;justify-content:space-between;padding:6px 0;${style}"><span>${l}</span><span>${r}</span></div>`;
  const itemsHtml = q.items.map(i => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;">${escapeHtml(i.name)}</td><td style="padding:10px 0;border-bottom:1px solid #eee;text-align:center;">${i.quantity}</td><td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;">${formatMoney(i.line_total, q.currency)}</td></tr>`).join('');
  win.document.write(`<!DOCTYPE html><html><head><title>Receipt ${escapeHtml(order.orderNumber)}</title>
  <style>body{font-family:Georgia,serif;max-width:600px;margin:40px auto;padding:20px;color:#1A1A1A}h1{font-size:28px;font-weight:300;margin-bottom:5px}.brand{color:#C48B71;font-size:11px;letter-spacing:3px;text-transform:uppercase}.info{color:#5A5A5A;font-size:14px;margin:15px 0;line-height:1.6}table{width:100%;border-collapse:collapse;margin:20px 0;font-size:14px}.footer{margin-top:40px;padding-top:20px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center}</style></head><body>
  <p class="brand">Lixxon Studio</p><h1>Receipt</h1>
  <div class="info"><strong>Order:</strong> ${escapeHtml(order.orderNumber)}<br><strong>Date:</strong> ${date}<br><strong>Customer:</strong> ${escapeHtml(order.customerName)}<br><strong>Email:</strong> ${escapeHtml(order.customerEmail)}</div>
  <table><thead><tr style="border-bottom:2px solid #1A1A1A;"><th style="text-align:left;padding-bottom:10px;">Product</th><th style="text-align:center;padding-bottom:10px;">Qty</th><th style="text-align:right;padding-bottom:10px;">Price</th></tr></thead><tbody>${itemsHtml}</tbody></table>
  <div style="font-size:14px;">${row('Subtotal', formatMoney(q.subtotal, q.currency))}${q.discount > 0 ? row('Discount' + (q.promo ? ` (${escapeHtml(q.promo.code)})` : ''), '−' + formatMoney(q.discount, q.currency), 'color:#2d8659') : ''}${q.gift_card_amount > 0 ? row('Gift card', '−' + formatMoney(q.gift_card_amount, q.currency), 'color:#2d8659') : ''}${row('Total', formatMoney(q.amount, q.currency), 'font-size:18px;font-weight:bold;border-top:2px solid #1A1A1A;padding-top:12px;margin-top:8px')}</div>
  <div class="footer">Thank you for your purchase.<br>© ${new Date().getFullYear()} Lixxon Studio. All rights reserved.</div></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}
