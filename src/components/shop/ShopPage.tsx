import SmartImage from '../SmartImage';
import { useState, useEffect, useMemo } from 'react';
import { ShoppingBag, Search, Heart, ArrowRight, ExternalLink, ArrowUpDown, X, Sparkles } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import { useShopProducts, useShopCategories, useFeaturedShopProducts } from '../../hooks/useCommerce';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import RecentlyViewedProducts from './RecentlyViewedProducts';
import { CompareButton } from './ProductExtras';
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
  const [typeFilter, setTypeFilter] = useState<'all' | 'digital' | 'affiliate'>('all');
  const [sortBy, setSortBy] = useState<'featured' | 'price-asc' | 'price-desc' | 'name'>('featured');

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const filtered = useMemo(() => {
    let list = products.filter(p => {
      if (activeCat && p.shop_category_id !== activeCat) return false;
      if (typeFilter === 'digital' && !(p.product_type === 'digital' || p.is_digital)) return false;
      if (typeFilter === 'affiliate' && (p.product_type === 'digital' || p.is_digital)) return false;
      if (search) {
        const q = search.toLowerCase();
        return p.name?.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q);
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortBy === 'price-asc') {
        return (parseFloat(a.price || '0') || 0) - (parseFloat(b.price || '0') || 0);
      }
      if (sortBy === 'price-desc') {
        return (parseFloat(b.price || '0') || 0) - (parseFloat(a.price || '0') || 0);
      }
      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (a.is_featured && !b.is_featured) return -1;
      if (!a.is_featured && b.is_featured) return 1;
      return 0;
    });

    return list;
  }, [products, activeCat, typeFilter, search, sortBy]);

  const digitalProducts = filtered.filter(p => p.product_type === 'digital' || p.is_digital);
  const affiliateProducts = filtered.filter(p => p.product_type === 'affiliate' || (!p.is_digital && p.product_type !== 'digital'));

  const hasActiveFilters = Boolean(search || activeCat || typeFilter !== 'all' || sortBy !== 'featured');
  const clearFilters = () => {
    setSearch('');
    setActiveCat(null);
    setTypeFilter('all');
    setSortBy('featured');
  };

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
      {!featLoading && featured.length > 0 && !hasActiveFilters && (
        <section className="container-wide pb-12">
          <div className="flex items-center gap-3 mb-8">
            <span className="flex items-center gap-1.5 text-[10px] tracking-ultra-wide uppercase text-bronze">
              <Sparkles size={12} /> Featured Essentials
            </span>
            <div className="flex-1 h-[1px] bg-taupe" />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            {featured.map(product => (
              <ProductCard key={product.id} product={product} onAddToCart={addItem} onToggleWishlist={toggleItem} isWishlisted={hasItem(product.id)} />
            ))}
          </div>
        </section>
      )}

      {/* Filter & Search Bar */}
      <section className="container-wide pb-6">
        <div className="bg-white border border-taupe/40 p-4 rounded-sm space-y-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search size={16} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-charcoal-muted" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search products, brands, ingredients..."
                aria-label="Search products"
                className="w-full bg-taupe-light/30 border border-taupe/40 pl-10 pr-4 py-2.5 text-xs text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-charcoal-muted hover:text-charcoal"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Controls: Type tabs and Sort */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex bg-taupe-light/50 p-1 rounded-sm border border-taupe/40 text-xs">
                <button
                  type="button"
                  onClick={() => setTypeFilter('all')}
                  className={`px-3 py-1 rounded-sm font-medium transition-colors ${typeFilter === 'all' ? 'bg-white text-charcoal shadow-xs' : 'text-charcoal-muted hover:text-charcoal'}`}
                >
                  All Formats
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('digital')}
                  className={`px-3 py-1 rounded-sm font-medium transition-colors ${typeFilter === 'digital' ? 'bg-white text-charcoal shadow-xs' : 'text-charcoal-muted hover:text-charcoal'}`}
                >
                  Digital Guides
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('affiliate')}
                  className={`px-3 py-1 rounded-sm font-medium transition-colors ${typeFilter === 'affiliate' ? 'bg-white text-charcoal shadow-xs' : 'text-charcoal-muted hover:text-charcoal'}`}
                >
                  Editor's Shelf
                </button>
              </div>

              {/* Sort Dropdown */}
              <div className="flex items-center gap-1.5 bg-taupe-light/50 px-3 py-1.5 rounded-sm border border-taupe/40 text-xs">
                <ArrowUpDown size={13} className="text-charcoal-muted" />
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as typeof sortBy)}
                  className="bg-transparent font-medium text-charcoal focus:outline-none cursor-pointer"
                  aria-label="Sort products"
                >
                  <option value="featured">Featured Order</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="name">Name (A-Z)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Category Filter Pills */}
          {categories.length > 0 && (
            <div className="flex items-center gap-2 pt-2 border-t border-taupe/30 overflow-x-auto scrollbar-hide">
              <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted font-medium flex-shrink-0 mr-1">
                Categories:
              </span>
              <button
                type="button"
                onClick={() => setActiveCat(null)}
                className={`flex-shrink-0 px-3 py-1 text-[11px] uppercase tracking-editorial font-medium rounded-full transition-all border ${!activeCat ? 'bg-charcoal text-white border-charcoal' : 'bg-white text-charcoal-muted border-taupe/40 hover:border-bronze hover:text-charcoal'}`}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  type="button"
                  key={cat.id}
                  onClick={() => setActiveCat(cat.id)}
                  className={`flex-shrink-0 px-3 py-1 text-[11px] uppercase tracking-editorial font-medium rounded-full transition-all border ${activeCat === cat.id ? 'bg-charcoal text-white border-charcoal' : 'bg-white text-charcoal-muted border-taupe/40 hover:border-bronze hover:text-charcoal'}`}
                >
                  {cat.name}
                </button>
              ))}

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="ml-auto flex items-center gap-1 text-[11px] text-bronze hover:underline font-medium flex-shrink-0 pl-2"
                >
                  <X size={12} /> Clear all filters
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Digital products */}
      {(typeFilter === 'all' || typeFilter === 'digital') && digitalProducts.length > 0 && (
        <section className="container-wide py-8">
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
        </section>
      )}

      {/* Affiliate/recommended products */}
      {(typeFilter === 'all' || typeFilter === 'affiliate') && affiliateProducts.length > 0 && (
        <section className="bg-taupe-light/40 py-16">
          <div className="container-wide">
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
          </div>
        </section>
      )}

      {/* Recently viewed */}
      <RecentlyViewedProducts />

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <section className="container-narrow py-24 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-8">
            <ShoppingBag size={24} strokeWidth={1.5} className="text-bronze" />
          </div>
          <h3 className="font-serif text-3xl text-charcoal font-light">
            {hasActiveFilters ? 'No products matched your filters' : 'New digital guides are coming soon'}
          </h3>
          <p className="text-charcoal-muted text-base mt-4 max-w-md mx-auto leading-relaxed">
            {hasActiveFilters
              ? 'Try adjusting your search terms or clearing category filters to explore the catalog.'
              : 'We are carefully crafting our first digital products. In the meantime, explore our editorial recommendations.'}
          </p>
          {hasActiveFilters ? (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-2 mt-8 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all rounded-sm"
            >
              Reset Filters
            </button>
          ) : (
            <Link to={{ name: 'home', page: 1 }} className="inline-flex items-center gap-3 mt-8 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm">
              Explore the Magazine <ArrowRight size={14} />
            </Link>
          )}
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
            <SmartImage src={product.image_url} alt={product.name} className="w-full h-full object-cover" sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" aspectRatio="1/1" />
          )}
          {product.is_sponsored && (
            <span className="absolute top-3 left-3 text-[9px] tracking-editorial uppercase text-white bg-charcoal/70 backdrop-blur-md px-2.5 py-1 rounded-full">
              Sponsored
            </span>
          )}
          {isDigital && (
            <span className="absolute top-3 right-3 text-[9px] tracking-editorial uppercase text-white bg-bronze/90 backdrop-blur-md px-2 py-0.5 rounded-full">
              Digital Guide
            </span>
          )}
        </div>
      </Link>
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          {product.brand ? (
            <p className="text-[10px] tracking-editorial uppercase text-bronze">{product.brand}</p>
          ) : <span />}
          <div className="flex-shrink-0">
            <CompareButton product={product} />
          </div>
        </div>
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
