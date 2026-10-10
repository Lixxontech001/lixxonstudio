import { displayImageUrl } from '../../lib/images';
import {useEffect} from 'react';
import { Heart, ShoppingBag, ArrowRight, Trash2 } from 'lucide-react';
import { useWishlist } from '../../context/WishlistContext';
import { useCart } from '../../context/CartContext';
import { Link } from '../../context/NavigationContext';
import { Helmet } from 'react-helmet-async';

export default function WishlistPage() {
  const { items, removeItem } = useWishlist();
  const { addItem } = useCart();

  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <main>
      <Helmet>
        <title>Wishlist | Lixxon Studio Shop</title>
        <meta name="robots" content="noindex, follow" />
      </Helmet>

      <section className="container-wide pt-12 pb-8">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Wishlist</p>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light">
          {items.length > 0 ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : 'Your wishlist is empty'}
        </h1>
      </section>

      {items.length === 0 ? (
        <section className="container-narrow py-16 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-8">
            <Heart size={24} strokeWidth={1.5} className="text-bronze" />
          </div>
          <p className="text-charcoal-muted text-base max-w-md mx-auto leading-relaxed">
            Save products you love to your wishlist for easy access later.
          </p>
          <Link to={{ name: 'shop' }} className="inline-flex items-center gap-3 mt-8 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm">
            Browse Shop <ArrowRight size={14} />
          </Link>
        </section>
      ) : (
        <section className="container-wide pb-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {items.map(item => (
              <div key={item.id} className="group bg-white rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500 flex flex-col">
                <Link to={{ name: 'shop-product', slug: item.slug }} className="block">
                  <div className="img-zoom aspect-square bg-taupe-light">
                    {item.image_url && <img src={displayImageUrl(item.image_url)} alt={item.name} className="w-full h-full object-cover" loading="lazy" />}
                  </div>
                </Link>
                <div className="p-5 flex flex-col flex-1">
                  <Link to={{ name: 'shop-product', slug: item.slug }}>
                    <h3 className="font-serif text-lg text-charcoal group-hover:text-bronze transition-colors duration-300 line-clamp-2">{item.name}</h3>
                  </Link>
                  <p className="font-serif text-xl text-charcoal mt-2">${item.price.toFixed(2)}</p>
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-taupe/30">
                    {item.price > 0 && (
                      <button
                        onClick={() => addItem({ id: item.id, name: item.name, slug: item.slug, price: item.price, image_url: item.image_url, is_digital: true })}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all"
                      >
                        <ShoppingBag size={12} /> Move to Cart
                      </button>
                    )}
                    <button
                      onClick={() => removeItem(item.id)}
                      className="ml-auto text-charcoal-muted hover:text-red-600 transition-colors flex items-center gap-1.5 text-xs"
                      aria-label="Remove from wishlist"
                    >
                      <Trash2 size={14} /> Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
