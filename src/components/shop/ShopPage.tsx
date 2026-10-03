import { useState, useEffect } from 'react';
import { ShoppingBag, Search, Heart, ArrowRight, ExternalLink } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import { useShopProducts, useShopCategories, useFeaturedShopProducts } from '../../hooks/useCommerce';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import RecentlyViewedProducts from './RecentlyViewedProducts';
import { Helmet } from 'react-helmet-async';
import type { Product } from '../../lib/types';

export default function ShopPage() {
  const { products, loading } = useShopProducts();
  const { categories } = useShopCategories();
  const { products: featured, loading: featLoading } = useFeaturedShopProducts();
  const { addItem } = useCart();
  const { toggleItem, hasItem } = useWishlist();
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const filtered = products.filter(p => {
    if (activeCat && p.shop_category_id !== activeCat) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.name?.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q);
    }
    return true;
  });

  const digitalProducts = filtered.filter(p => p.product_type === 'digital' || p.is_digital);
  const affiliateProducts = filtered.filter(p => p.product_type === 'affiliate' || (!p.is_digital && p.product_type !== 'digital'));

  return (
    <main>
      <Helmet>
        <title>Shop | Lixxon Studio</title>
        <meta name="description" content="Digital guides, curated skincare picks, and wellness essentials from Lixxon Studio." />
        <link rel="canonical" href={`${window.location.origin}/shop`} />
      </Helmet>

      {/* Shop Header */}
      <section className="container-wide pt-12 pb-8 md:pt-16 md:pb-12">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">The Shop</p>
        <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-charcoal font-light leading-[1.05] text-balance">
          Considered products for intentional living.
        </h1>
        <p className="text-charcoal-muted text-lg mt-5 max-w-xl leading-relaxed">
          Digital guides and editorially selected essentials. No filler, no noise — just what earns a place in your routine.
        </p>
      </section>

      {/* Featured products */}
      {!featLoading && featured.length > 0 && (
        <section className="container-wide pb-12">
          <div className="flex items-center gap-3 mb-8">
            <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Featured</p>
            <div className="flex-1 h-[1px] bg-taupe" />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            {featured.map(product => (
              <ProductCard key={product.id} product={product} onAddToCart={addItem} onToggleWishlist={toggleItem} isWishlisted={hasItem(product.id)} />
            ))}
          </div>
        </section>
      )}

      {/* Search + Category filter */}
      <section className="container-wide pb-6">
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center">
          <div className="relative flex-1 max-w-md">
            <Search size={16} strokeWidth={1.5} className="absolute left-4 top-1/2 -translate-y-1/2 text-charcoal-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products..."
              aria-label="Search products"
              className="w-full bg-white border border-taupe/50 pl-11 pr-4 py-3 text-sm text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
            />
          </div>
          {categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              <button
                onClick={() => setActiveCat(null)}
                className={`flex-shrink-0 px-4 py-2.5 text-xs tracking-editorial uppercase font-medium transition-all rounded-sm border ${!activeCat ? 'bg-charcoal text-white border-charcoal' : 'bg-white text-charcoal border-taupe/50 hover:border-bronze'}`}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCat(cat.id)}
                  className={`flex-shrink-0 px-4 py-2.5 text-xs tracking-editorial uppercase font-medium transition-all rounded-sm border ${activeCat === cat.id ? 'bg-charcoal text-white border-charcoal' : 'bg-white text-charcoal border-taupe/50 hover:border-bronze'}`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Digital products */}
      <section className="container-wide py-8">
        {loading ? (
          <ProductGridSkeleton />
        ) : digitalProducts.length > 0 ? (
          <>
            <div className="flex items-center gap-3 mb-8">
              <ShoppingBag size={16} strokeWidth={1.5} className="text-bronze" />
              <h2 className="font-serif text-xl text-charcoal font-light">Digital Guides</h2>
              <div className="flex-1 h-[1px] bg-taupe" />
              <span className="text-xs text-charcoal-muted">{digitalProducts.length} {digitalProducts.length === 1 ? 'item' : 'items'}</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {digitalProducts.map(product => (
                <ProductCard key={product.id} product={product} onAddToCart={addItem} onToggleWishlist={toggleItem} isWishlisted={hasItem(product.id)} />
              ))}
            </div>
          </>
        ) : null}
      </section>

      {/* Affiliate/recommended products */}
      <section className="bg-taupe-light/40 py-16">
        <div className="container-wide">
          {loading ? (
            <ProductGridSkeleton />
          ) : affiliateProducts.length > 0 ? (
            <>
              <div className="flex items-center gap-3 mb-8">
                <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Editor's Shelf</p>
                <div className="flex-1 h-[1px] bg-taupe" />
                <span className="text-xs text-charcoal-muted">{affiliateProducts.length} {affiliateProducts.length === 1 ? 'item' : 'items'}</span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                {affiliateProducts.map(product => (
                  <ProductCard key={product.id} product={product} onAddToCart={addItem} onToggleWishlist={toggleItem} isWishlisted={hasItem(product.id)} />
                ))}
              </div>
              <p className="text-center text-xs text-charcoal-muted mt-10 italic">
                Some links may be affiliate links. We only recommend products we genuinely love.
              </p>
            </>
          ) : null}
        </div>
      </section>

      {/* Recently viewed */}
      <RecentlyViewedProducts />

      {/* Empty state */}
      {!loading && products.length === 0 && (
        <section className="container-narrow py-24 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-8">
            <ShoppingBag size={24} strokeWidth={1.5} className="text-bronze" />
          </div>
          <h3 className="font-serif text-3xl text-charcoal font-light">New digital guides are coming soon</h3>
          <p className="text-charcoal-muted text-base mt-4 max-w-md mx-auto leading-relaxed">
            We are carefully crafting our first digital products. In the meantime, explore our editorial recommendations.
          </p>
          <Link to={{ name: 'home', page: 1 }} className="inline-flex items-center gap-3 mt-8 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm">
            Explore the Magazine <ArrowRight size={14} />
          </Link>
        </section>
      )}
    </main>
  );
}

export function ProductCard({ product, onAddToCart, onToggleWishlist, isWishlisted }: {
  product: Product;
  onAddToCart: (item: { id: string; name: string; slug: string; price: number; image_url: string | null; is_digital: boolean }) => void;
  onToggleWishlist: (item: { id: string; name: string; slug: string; price: number; image_url: string | null }) => void;
  isWishlisted: boolean;
}) {
  const isDigital = product.product_type === 'digital' || product.is_digital;
  const hasAffiliate = product.affiliate_url && product.affiliate_url !== '#';
  const priceNum = parseFloat(product.price || '0');

  const handleAction = () => {
    if (isDigital && priceNum > 0) {
      onAddToCart({
        id: product.id,
        name: product.name,
        slug: product.slug || product.id,
        price: priceNum,
        image_url: product.image_url,
        is_digital: true,
      });
    } else if (hasAffiliate && product.slug) {
      window.open(product.affiliate_url!, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="group bg-white rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500 flex flex-col">
      <Link to={product.slug ? { name: 'shop-product', slug: product.slug } : { name: 'shop' }} className="block">
        <div className="img-zoom aspect-square bg-taupe-light relative">
          {product.image_url && (
            <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" loading="lazy" />
          )}
          {product.is_sponsored && (
            <span className="absolute top-3 left-3 text-[9px] tracking-editorial uppercase text-white bg-charcoal/70 backdrop-blur-md px-2.5 py-1 rounded-full">
              Sponsored
            </span>
          )}
        </div>
      </Link>
      <div className="p-5 flex flex-col flex-1">
        {product.brand && (
          <p className="text-[10px] tracking-editorial uppercase text-bronze mb-1.5">{product.brand}</p>
        )}
        <Link to={product.slug ? { name: 'shop-product', slug: product.slug } : { name: 'shop' }}>
          <h3 className="font-serif text-lg text-charcoal leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-2">
            {product.name}
          </h3>
        </Link>
        {product.description && (
          <p className="text-charcoal-muted text-sm mt-2 leading-relaxed line-clamp-2 flex-1">{product.description}</p>
        )}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-taupe/30">
          {product.price && (
            <span className="font-serif text-xl text-charcoal">
              {priceNum > 0 ? `$${priceNum.toFixed(2)}` : product.price}
            </span>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleWishlist({ id: product.id, name: product.name, slug: product.slug || product.id, price: priceNum, image_url: product.image_url })}
              className="w-9 h-9 rounded-full border border-taupe flex items-center justify-center text-charcoal-muted hover:text-bronze hover:border-bronze transition-all"
              aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
            >
              <Heart size={14} strokeWidth={1.5} fill={isWishlisted ? 'currentColor' : 'none'} className={isWishlisted ? 'text-bronze' : ''} />
            </button>
            {(isDigital || hasAffiliate) && (
              <button
                onClick={handleAction}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all"
              >
                {isDigital ? <>Add to Cart</> : <>View <ExternalLink size={12} /></>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductGridSkeleton() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex flex-col">
          <div className="skeleton aspect-square rounded-sm" />
          <div className="mt-4 space-y-3">
            <div className="skeleton h-3 w-1/2" />
            <div className="skeleton h-5 w-full" />
            <div className="skeleton h-4 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
