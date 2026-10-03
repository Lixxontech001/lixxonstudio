import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, AlertCircle, Download, ShoppingBag, Mail, FileText } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useNavigation, Link } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabaseClient';
import PromoCodeInput from './PromoCodeInput';
import { Helmet } from 'react-helmet-async';

type CheckoutStatus = 'form' | 'processing' | 'success' | 'error' | 'unavailable';

interface DownloadLink {
  product_name: string;
  download_token: string;
}

interface OrderResult {
  orderNumber: string;
  customerEmail: string;
  customerName: string;
  downloads: DownloadLink[];
}

export default function CheckoutPage() {
  const { items, subtotal, clearCart } = useCart();
  const { navigate } = useNavigation();
  const [status, setStatus] = useState<CheckoutStatus>('form');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '' });
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);
  const [discount, setDiscount] = useState(0);

  const finalTotal = Math.max(0, subtotal - discount);

  const handleDiscountChange = useCallback((d: number) => {
    setDiscount(d);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const flutterwavePublicKey = import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const isPaymentAvailable = !!flutterwavePublicKey;

  const handleDownload = async (token: string) => {
    // FIX 1: Open window immediately to prevent browser popup blockers from blocking async tab creation
    const downloadWindow = window.open('about:blank', '_blank');

    try {
      const { data, error: dError } = await supabase
        .from('download_entitlements')
        .select('file_path, download_count, max_downloads')
        .eq('download_token', token)
        .maybeSingle();

      if (dError || !data) {
        downloadWindow?.close();
        alert('Download link is invalid or has expired.');
        return;
      }

      if (data.download_count >= data.max_downloads) {
        downloadWindow?.close();
        alert('You have reached the maximum number of downloads for this product.');
        return;
      }

      const { data: urlData, error: urlError } = await supabase
        .storage
        .from('digital-products')
        .createSignedUrl(data.file_path, 3600);

      if (urlError || !urlData?.signedUrl) {
        downloadWindow?.close();
        alert('Could not generate download link. Please try again.');
        return;
      }

      // Increment download count
      await supabase
        .from('download_entitlements')
        .update({ download_count: data.download_count + 1 })
        .eq('download_token', token);

      // Redirect opened tab to signed URL
      if (downloadWindow) {
        downloadWindow.location.href = urlData.signedUrl;
      }
    } catch (err) {
      downloadWindow?.close();
      console.error('Download error:', err);
      alert('An unexpected error occurred during download.');
    }
  };

   const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setError('Please fill in all fields.');
      setStatus('error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Please enter a valid email address.');
      setStatus('error');
      return;
    }

    if (!flutterwavePublicKey) {
      setError('Payment gateway public key is missing.');
      setStatus('error');
      return;
    }

    setStatus('processing');
    setError('');

    try {
      const orderNumber = `LXX-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      // 1. Upsert customer
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .upsert({ email: form.email.trim(), name: form.name.trim() }, { onConflict: 'email' })
        .select('id')
        .single();
    
      if (customerError) {
        console.warn('Customer profile upsert warning:', customerError.message);
      }

      // 2. Create order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumber,
          customer_email: form.email.trim(),
          customer_name: form.name.trim(),
          customer_id: customer?.id || null,
          status: 'pending',
          payment_status: 'pending',
          amount: finalTotal,
          currency: 'USD',
        })
        .select()
        .single();

      if (orderError || !order) {
        console.error('Order creation failed:', orderError);
        setError('Could not create your order. Please try again.');
        setStatus('error');
        return;
      }

      // 3. Create order items
      const orderItems = items.map(item => ({
        order_id: order.id,
        product_id: item.id,
        product_name: item.name,
        product_slug: item.slug,
        price: item.price,
        quantity: item.quantity,
        file_path: null,
      }));

      const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
      if (itemsError) {
        console.error('Order items insertion failed:', itemsError);
        setError('Could not save order item details. Please try again.');
        setStatus('error');
        return;
      }

      // 4. Trigger Flutterwave popup
      const triggerPayment = () => {
        const win = window as unknown as { FlutterwaveCheckout?: (config: Record<string, unknown>) => void };

        if (typeof win.FlutterwaveCheckout === 'function') {
          win.FlutterwaveCheckout({
            public_key: flutterwavePublicKey,
            tx_ref: orderNumber,
            amount: finalTotal,
            currency: 'USD',
            payment_options: 'card,banktransfer,ussd',
            customer: {
              email: form.email.trim(),
              name: form.name.trim(),
            },
            customizations: {
              title: 'Lixxon Studio',
              description: `Order ${orderNumber}`,
              logo: '/assets/images/lixxon_studio.png',
            },
            callback: async (response: { tx_ref: string; transaction_id: string; status: string }) => {
              try {
                const verifyUrl = `${supabaseUrl}/functions/v1/verify-payment`;
                const verifyResponse = await fetch(verifyUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseAnonKey}`,
                  },
                  body: JSON.stringify({
                    transaction_id: response.transaction_id,
                    tx_ref: response.tx_ref,
                    order_id: order.id,
                    expected_amount: finalTotal,
                    expected_currency: 'USD',
                  }),
                });

                const verifyData = await verifyResponse.json();

                if (verifyResponse.ok && verifyData.verified) {
                  const downloads: DownloadLink[] = (verifyData.entitlements || []).map(
                    (e: { product_name: string; download_token: string }) => ({
                      product_name: e.product_name,
                      download_token: e.download_token,
                    })
                  );

                  localStorage.setItem('lixxon_customer_email', form.email.trim());
                  clearCart();
                  setOrderResult({
                    orderNumber,
                    customerEmail: form.email.trim(),
                    customerName: form.name.trim(),
                    downloads,
                  });
                  setStatus('success');
                } else {
                  setError('Payment verification failed.');
                  setStatus('error');
                }
              } catch (err) {
                console.error('Payment verification error:', err);
                setError('Could not verify payment.');
                setStatus('error');
              }
            },
            onclose: (incomplete?: boolean) => {
              if (incomplete) {
                setError('Payment process was cancelled or closed before completion.');
                setStatus('error');
              } else {
                setStatus('form');
              }
            },
          });
        } else {
          setError('Flutterwave SDK failed to load. Please check your internet or disable ad blockers.');
          setStatus('error');
        }
      };

      const win = window as unknown as { FlutterwaveCheckout?: unknown };
      if (typeof win.FlutterwaveCheckout === 'function') {
        triggerPayment();
      } else {
        const script = document.createElement('script');
        script.src = 'https://checkout.flutterwave.com/v3.js';
        script.async = true;
        script.onload = () => triggerPayment();
        script.onerror = () => {
          setError('Failed to load Flutterwave script. Please disable any ad blockers and try again.');
          setStatus('error');
        };
        document.head.appendChild(script);
      }
    } catch (err) {
      console.error('Checkout submit error:', err);
      setError('An unexpected error occurred. Please try again.');
      setStatus('error');
    }
  };
  if (items.length === 0 && status !== 'success') {
    return (
      <main>
        <Helmet>
          <title>Checkout | Lixxon Studio</title>
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
        <section className="container-narrow py-24 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-8">
            <ShoppingBag size={24} strokeWidth={1.5} className="text-bronze" />
          </div>
          <h1 className="font-serif text-3xl text-charcoal font-light">Your cart is empty</h1>
          <p className="text-charcoal-muted text-base mt-4">Add items to your cart before checking out.</p>
          <Link
            to={{ name: 'shop' }}
            className="inline-flex items-center gap-3 mt-8 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm"
          >
            Browse Shop <ArrowRight size={14} />
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main>
      <Helmet>
        <title>Checkout | Lixxon Studio</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

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

          {/* PDF Receipt download */}
          <div className="max-w-2xl mx-auto mb-8">
            <button
              onClick={() => downloadReceipt(orderResult, items, subtotal, discount, finalTotal)}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 border border-charcoal text-charcoal text-sm hover:bg-charcoal hover:text-white transition-all rounded-sm"
            >
              <FileText size={16} strokeWidth={1.5} /> Download Receipt (PDF)
            </button>
          </div>

          {/* Email notification banner */}
          <div className="bg-taupe-light/40 border border-taupe/30 rounded-sm p-5 mb-8 flex items-start gap-4 max-w-2xl mx-auto">
            <Mail size={20} className="text-bronze flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-charcoal font-medium">We've sent your download links to {orderResult.customerEmail}</p>
              <p className="text-xs text-charcoal-muted mt-1">If you don't see the email within a few minutes, check your spam folder. You can also download your products directly below.</p>
            </div>
          </div>

          {/* Download links */}
          {orderResult.downloads.length > 0 && (
            <div className="max-w-2xl mx-auto">
              <h2 className="font-serif text-2xl text-charcoal font-light mb-6">Your Downloads</h2>
              <div className="space-y-4">
                {orderResult.downloads.map((dl, i) => (
                  <div key={i} className="bg-white border border-taupe/30 rounded-sm p-5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-sm bg-bronze/10 flex items-center justify-center flex-shrink-0">
                        <Download size={20} className="text-bronze" />
                      </div>
                      <p className="font-serif text-base text-charcoal truncate">{dl.product_name}</p>
                    </div>
                    <button
                      onClick={() => handleDownload(dl.download_token)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all whitespace-nowrap flex-shrink-0"
                    >
                      <Download size={14} /> Download
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  to={{ name: 'account-downloads' }}
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 border border-charcoal text-charcoal text-xs tracking-editorial uppercase font-medium hover:bg-charcoal hover:text-white transition-all duration-500 rounded-sm"
                >
                  Go to My Downloads
                </Link>
                <Link
                  to={{ name: 'shop' }}
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 border border-charcoal text-charcoal text-xs tracking-editorial uppercase font-medium hover:bg-charcoal hover:text-white transition-all duration-500 rounded-sm"
                >
                  Continue Shopping
                </Link>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="container-wide pt-12 pb-16">
          <button onClick={() => navigate({ name: 'cart' })} className="inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors mb-8">
            <ArrowLeft size={14} strokeWidth={1.5} /> Back to Cart
          </button>

          <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light mb-12">Checkout</h1>

          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16">
            {/* Form */}
            <div>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="checkout-name" className="block text-[10px] tracking-editorial uppercase text-charcoal-muted mb-2">Full Name</label>
                  <input
                    id="checkout-name"
                    type="text"
                    value={form.name}
                    onChange={e => { setForm(p => ({ ...p, name: e.target.value })); setStatus('form'); }}
                    placeholder="Your full name"
                    className="w-full bg-white border border-taupe/50 px-4 py-3.5 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
                  />
                </div>
                <div>
                  <label htmlFor="checkout-email" className="block text-[10px] tracking-editorial uppercase text-charcoal-muted mb-2">Email Address</label>
                  <input
                    id="checkout-email"
                    type="email"
                    value={form.email}
                    onChange={e => { setForm(p => ({ ...p, email: e.target.value })); setStatus('form'); }}
                    placeholder="your@email.com"
                    className="w-full bg-white border border-taupe/50 px-4 py-3.5 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
                  />
                  <p className="text-xs text-charcoal-muted mt-2">Your downloads will be sent to this email and linked to your account.</p>
                </div>

                {(status === 'error' || status === 'unavailable') && (
                  <div className="flex items-start gap-3 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-sm">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === 'processing'}
                  className="w-full inline-flex items-center justify-center gap-3 px-8 py-4 bg-bronze text-white text-sm tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 rounded-sm disabled:opacity-60"
                >
                  {status === 'processing' ? (
                    <><Loader2 size={16} className="animate-spin" /> Processing...</>
                  ) : (
                    <>Pay ${finalTotal.toFixed(2)}</>
                  )}
                </button>
              </form>
            </div>

            {/* Order Summary */}
            <div>
              <div className="bg-taupe-light/40 rounded-sm p-6 border border-taupe/30">
                <h3 className="font-serif text-xl text-charcoal mb-4">Order Summary</h3>
                <div className="space-y-3 mb-4">
                  {items.map(item => (
                    <div key={item.id} className="flex gap-3 pb-3 border-b border-taupe/30 last:border-0">
                      <div className="w-14 h-14 rounded-sm overflow-hidden bg-taupe-light flex-shrink-0">
                        {item.image_url && <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-charcoal font-medium line-clamp-2">{item.name}</p>
                        <p className="text-xs text-charcoal-muted">Qty: {item.quantity}</p>
                      </div>
                      <p className="text-sm text-charcoal flex-shrink-0">${(item.price * item.quantity).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-taupe/50 pt-4 space-y-2">
                  <div className="flex justify-between text-sm text-charcoal-muted">
                    <span>Subtotal</span>
                    <span>${subtotal.toFixed(2)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>Discount</span>
                      <span>-${discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="pt-2">
                    <PromoCodeInput subtotal={subtotal} onDiscountChange={handleDiscountChange} />
                  </div>
                  <div className="flex justify-between pt-2">
                    <span className="font-serif text-lg text-charcoal">Total</span>
                    <span className="font-serif text-xl text-charcoal">${finalTotal.toFixed(2)}</span>
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

function downloadReceipt(
  order: OrderResult,
  items: { id: string; name: string; price: number; quantity: number }[],
  subtotal: number,
  discount: number,
  total: number
) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const win = window.open('', '_blank');
  if (!win) return;

  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;">${item.name}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;">${(item.price * item.quantity).toFixed(2)}</td>
    </tr>
  `).join('');

  win.document.write(`<!DOCTYPE html><html><head><title>Receipt ${order.orderNumber}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 600px; margin: 40px auto; padding: 20px; color: #1A1A1A; }
    h1 { font-size: 28px; font-weight: 300; margin-bottom: 5px; }
    .brand { color: #C48B71; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; }
    .info { color: #5A5A5A; font-size: 14px; margin: 15px 0; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
    .totals { margin-top: 20px; font-size: 14px; }
    .totals div { display: flex; justify-content: space-between; padding: 6px 0; }
    .total-row { font-size: 18px; font-weight: bold; border-top: 2px solid #1A1A1A; padding-top: 12px; margin-top: 8px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center; }
  </style></head><body>
    <p class="brand">Lixxon Studio</p>
    <h1>Receipt</h1>
    <div class="info">
      <strong>Order:</strong> ${order.orderNumber}<br>
      <strong>Date:</strong> ${date}<br>
      <strong>Customer:</strong> ${order.customerName}<br>
      <strong>Email:</strong> ${order.customerEmail}
    </div>
    <table>
      <thead>
        <tr style="border-bottom: 2px solid #1A1A1A;">
          <th style="text-align:left;padding-bottom:10px;">Product</th>
          <th style="text-align:center;padding-bottom:10px;">Qty</th>
          <th style="text-align:right;padding-bottom:10px;">Price</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
      ${discount > 0 ? `<div style="color:#2d8659;"><span>Discount</span><span>-${discount.toFixed(2)}</span></div>` : ''}
      <div class="total-row"><span>Total</span><span>${total.toFixed(2)}</span></div>
    </div>
    <div class="footer">Thank you for your purchase.<br>© 2026 Lixxon Studio. All rights reserved.</div>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}