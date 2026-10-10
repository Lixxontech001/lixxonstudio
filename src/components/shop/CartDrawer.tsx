import { displayImageUrl } from '../../lib/images';
import { X, ShoppingBag, Plus, Minus, Trash2 } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useNavigation, Link } from '../../context/NavigationContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export default function CartDrawer() {
  const { items, isOpen, closeCart, removeItem, updateQuantity, subtotal, count } = useCart();
  const { navigate } = useNavigation();
  const panelRef = useFocusTrap<HTMLDivElement>(isOpen, closeCart);

  const handleCheckout = () => {
    closeCart();
    navigate({ name: 'checkout' });
  };

  return (
    <div className={`fixed inset-0 z-[70] ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-charcoal/40 backdrop-blur-sm transition-opacity duration-400 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={closeCart}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        aria-hidden={!isOpen}
        tabIndex={-1}
        className={`absolute top-0 right-0 bottom-0 w-full max-w-md bg-porcelain flex flex-col transition-transform duration-400 outline-none ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between p-6 border-b border-taupe/40">
          <div className="flex items-center gap-2">
            <ShoppingBag size={18} strokeWidth={1.5} className="text-bronze" />
            <h2 className="font-serif text-xl text-charcoal">Your Cart</h2>
            {count > 0 && <span className="text-xs text-charcoal-muted">({count})</span>}
          </div>
          <button onClick={closeCart} className="text-charcoal-muted hover:text-charcoal transition-colors" aria-label="Close cart">
            <X size={22} strokeWidth={1.5} />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-6">
              <ShoppingBag size={24} strokeWidth={1.5} className="text-bronze" />
            </div>
            <h3 className="font-serif text-xl text-charcoal font-light">Your cart is empty</h3>
            <p className="text-charcoal-muted text-sm mt-2 leading-relaxed">
              Browse the shop to find digital guides and curated essentials.
            </p>
            <Link to={{ name: 'shop' }} onClick={closeCart} className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all">
              Browse Shop
            </Link>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {items.map(item => (
                <div key={item.id} className="flex gap-4 pb-4 border-b border-taupe/30 last:border-0">
                  <div className="w-20 h-20 rounded-sm overflow-hidden bg-taupe-light flex-shrink-0">
                    {item.image_url && <img src={displayImageUrl(item.image_url)} alt={item.name} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link to={{ name: 'shop-product', slug: item.slug }} onClick={closeCart}>
                      <h4 className="font-serif text-sm text-charcoal leading-snug hover:text-bronze transition-colors line-clamp-2">{item.name}</h4>
                    </Link>
                    <p className="text-sm text-charcoal-muted mt-1">${item.price.toFixed(2)}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-7 h-7 rounded-sm border border-taupe flex items-center justify-center text-charcoal hover:border-bronze transition-colors" aria-label="Decrease quantity">
                        <Minus size={12} />
                      </button>
                      <span className="text-sm text-charcoal w-6 text-center">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-7 h-7 rounded-sm border border-taupe flex items-center justify-center text-charcoal hover:border-bronze transition-colors" aria-label="Increase quantity">
                        <Plus size={12} />
                      </button>
                      <button onClick={() => removeItem(item.id)} className="ml-auto text-charcoal-muted hover:text-red-600 transition-colors" aria-label="Remove item">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="font-serif text-sm text-charcoal flex-shrink-0">${(item.price * item.quantity).toFixed(2)}</p>
                </div>
              ))}
            </div>

            <div className="p-6 border-t border-taupe/40 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-charcoal-muted">Subtotal</span>
                <span className="font-serif text-2xl text-charcoal">${subtotal.toFixed(2)}</span>
              </div>
              <button
                onClick={handleCheckout}
                className="w-full inline-flex items-center justify-center gap-3 px-8 py-4 bg-bronze text-white text-sm tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 rounded-sm"
              >
                Checkout
              </button>
              <button
                onClick={closeCart}
                className="w-full text-center text-xs text-charcoal-muted hover:text-charcoal transition-colors tracking-editorial uppercase"
              >
                Continue Shopping
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
