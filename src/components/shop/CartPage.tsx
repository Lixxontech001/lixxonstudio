import { displayImageUrl } from '../../lib/images';
import { useEffect } from 'react';
import { Plus, Minus, Trash2, ShoppingBag, ArrowRight } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { Link, useNavigation } from '../../context/NavigationContext';
import { Helmet } from 'react-helmet-async';

export default function CartPage() {
  const { items, removeItem, updateQuantity, subtotal, count } = useCart();
  const { navigate } = useNavigation();

  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <main>
      <Helmet>
        <title>Cart | Lixxon Studio Shop</title>
        <meta name="robots" content="noindex, follow" />
      </Helmet>

      <section className="container-wide pt-12 pb-8">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Your Cart</p>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light">
          {count > 0 ? `${count} ${count === 1 ? 'item' : 'items'}` : 'Your cart is empty'}
        </h1>
      </section>

      {items.length === 0 ? (
        <section className="container-narrow py-16 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-8">
            <ShoppingBag size={24} strokeWidth={1.5} className="text-bronze" />
          </div>
          <p className="text-charcoal-muted text-base max-w-md mx-auto leading-relaxed">
            Browse the shop to find digital guides and curated essentials.
          </p>
          <Link to={{ name: 'shop' }} className="inline-flex items-center gap-3 mt-8 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm">
            Browse Shop <ArrowRight size={14} />
          </Link>
        </section>
      ) : (
        <section className="container-wide pb-16">
          <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
            {/* Items */}
            <div className="lg:col-span-2 space-y-4">
              {items.map(item => (
                <div key={item.id} className="flex gap-4 p-5 bg-white rounded-sm luxury-shadow">
                  <div className="w-24 h-24 rounded-sm overflow-hidden bg-taupe-light flex-shrink-0">
                    {item.image_url && <img src={displayImageUrl(item.image_url)} alt={item.name} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link to={{ name: 'shop-product', slug: item.slug }}>
                      <h3 className="font-serif text-lg text-charcoal hover:text-bronze transition-colors">{item.name}</h3>
                    </Link>
                    <p className="text-sm text-charcoal-muted mt-1">${item.price.toFixed(2)}</p>
                    {item.is_digital && <p className="text-xs text-bronze mt-1">Digital product</p>}
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-8 h-8 rounded-sm border border-taupe flex items-center justify-center text-charcoal hover:border-bronze transition-colors" aria-label="Decrease quantity">
                        <Minus size={12} />
                      </button>
                      <span className="text-sm text-charcoal w-8 text-center">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-8 h-8 rounded-sm border border-taupe flex items-center justify-center text-charcoal hover:border-bronze transition-colors" aria-label="Increase quantity">
                        <Plus size={12} />
                      </button>
                      <button onClick={() => removeItem(item.id)} className="ml-auto text-charcoal-muted hover:text-red-600 transition-colors flex items-center gap-1.5 text-xs" aria-label="Remove item">
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  </div>
                  <p className="font-serif text-xl text-charcoal flex-shrink-0">${(item.price * item.quantity).toFixed(2)}</p>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="lg:col-span-1">
              <div className="bg-taupe-light/40 rounded-sm p-6 border border-taupe/30 sticky top-24">
                <h3 className="font-serif text-xl text-charcoal mb-4">Order Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-charcoal-muted">
                    <span>Subtotal</span>
                    <span>${subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-charcoal-muted">
                    <span>Taxes</span>
                    <span>Calculated at checkout</span>
                  </div>
                  <div className="border-t border-taupe/50 pt-3 mt-3 flex justify-between">
                    <span className="font-serif text-lg text-charcoal">Total</span>
                    <span className="font-serif text-xl text-charcoal">${subtotal.toFixed(2)}</span>
                  </div>
                </div>
                <button
                  onClick={() => navigate({ name: 'checkout' })}
                  className="w-full mt-6 inline-flex items-center justify-center gap-3 px-8 py-4 bg-bronze text-white text-sm tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 rounded-sm"
                >
                  Proceed to Checkout <ArrowRight size={14} />
                </button>
                <Link to={{ name: 'shop' }} className="block text-center text-xs text-charcoal-muted hover:text-charcoal transition-colors tracking-editorial uppercase mt-4">
                  Continue Shopping
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
