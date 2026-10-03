import { useEffect } from 'react';
import { ArrowLeft, ExternalLink, Heart, Check, ShoppingBag, Download, FileText, BookOpen } from 'lucide-react';
import { Link, useNavigation } from '../../context/NavigationContext';
import { useShopProduct, useShopProducts, trackProductClick } from '../../hooks/useCommerce';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { ProductCard } from './ShopPage';
import { HeroSkeleton } from '../Skeletons';
import EmptyState from '../EmptyState';
import ProductReviews from './ProductReviews';
import RecentlyViewedProducts from './RecentlyViewedProducts';
import { trackProductView } from '../../hooks/useFeatures';
import { Helmet } from 'react-helmet-async';

const getPublicStorageUrl = (filePath: string, bucket = 'previews') => {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }
  
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const cleanPath = filePath.replace(/^\/+/, '');
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${cleanPath}`;
};

export default function ShopProductPage({ slug }: { slug: string }) {
  const { product, loading } = useShopProduct(slug);
  const { products } = useShopProducts();
  const { addItem } = useCart();
  const { toggleItem, hasItem } = useWishlist();
  const { navigate } = useNavigation();

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  useEffect(() => {
    if (product) {
      trackProductView(product.id, product.name, product.slug || product.id, product.image_url);
    }
  }, [product]);

  if (loading) return <HeroSkeleton />;
  if (!product) return <EmptyState message="Product not found" />;

  const isDigital = product.product_type === 'digital' || product.is_digital;
  const isAffiliate = product.product_type === 'affiliate' || (!isDigital && product.affiliate_url && product.affiliate_url !== '#');
  const hasAffiliate = product.affiliate_url && product.affiliate_url !== '#';
  const priceNum = parseFloat(product.price || '0');
  const isWishlisted = hasItem(product.id);

  const relatedProducts = products
    .filter(p => {
      if (p.id === product.id) return false;
      if (p.product_type !== product.product_type) return false;
      const productTags = product.tags || [];
      const pTags = p.tags || [];
      if (productTags.length > 0 && pTags.length > 0) {
        return productTags.some(t => pTags.includes(t));
      }
      return true;
    })
    .slice(0, 3);

  const handleAddToCart = () => {
    if (isDigital && priceNum > 0) {
      addItem({
        id: product.id,
        name: product.name,
        slug: product.slug || product.id,
        price: priceNum,
        image_url: product.image_url,
        is_digital: true,
      });
    }
  };

//   const getPublicStorageUrl = (filePath: string, bucket = 'digital-products') => {
//   if (!filePath) return '';
//   if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
//     return filePath; // Already a full URL
//   }
  
//   const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
//   const cleanPath = filePath.replace(/^\/+/, ''); // Remove leading slashes
//   return `${supabaseUrl}/storage/v1/object/public/${bucket}/${cleanPath}`;
// };
  
  const handleAffiliateClick = () => {
    trackProductClick(product.id, 'product_detail');
    if (product.affiliate_url) {
      window.open(product.affiliate_url, '_blank', 'noopener,noreferrer');
    }
  };

  // Build natural affiliate description from available fields
  const hasAffiliateDetails = product.what_it_is || product.what_its_used_for || product.why_we_recommend || product.key_ingredients;
  const affiliateSections: { title: string; body: string }[] = [];
  if (product.what_it_is) affiliateSections.push({ title: 'Overview', body: product.what_it_is });
  if (product.what_its_used_for) affiliateSections.push({ title: 'How It Fits Into Your Routine', body: product.what_its_used_for });
  if (product.key_ingredients) affiliateSections.push({ title: 'What Makes It Work', body: product.key_ingredients });
  if (product.why_we_recommend) affiliateSections.push({ title: 'Our Take', body: product.why_we_recommend });

  return (
    <article>
      <Helmet>
        <title>{product.name} | Lixxon Studio Shop</title>
        <meta name="description" content={product.seo_description || product.description || `An in-depth look at ${product.name}`} />
        <link rel="canonical" href={`${window.location.origin}/shop/product/${product.slug}`} />
        <meta property="og:title" content={`${product.name} | Lixxon Studio`} />
        <meta property="og:description" content={product.description || ''} />
        <meta property="og:type" content="product" />
        {product.image_url && <meta property="og:image" content={product.image_url} />}
      </Helmet>

      <div className="container-wide pt-12 pb-8">
        <button onClick={() => navigate({ name: 'shop' })} className="inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors mb-8">
          <ArrowLeft size={14} strokeWidth={1.5} /> Back to Shop
        </button>

        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
          {/* Image */}
          <div className="rounded-sm overflow-hidden luxury-shadow-lg aspect-square bg-taupe-light">
            {product.image_url && (
              <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col">
            <div className="flex items-center gap-3 mb-3">
              {isDigital && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-bronze/10 text-bronze text-[10px] tracking-editorial uppercase rounded-full">
                  <Download size={10} /> Digital Product
                </span>
              )}
              {isAffiliate && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-taupe-light text-charcoal-muted text-[10px] tracking-editorial uppercase rounded-full">
                  <ExternalLink size={10} /> Recommended
                </span>
              )}
              {product.is_sponsored && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-charcoal/10 text-charcoal text-[10px] tracking-editorial uppercase rounded-full">
                  Sponsored
                </span>
              )}
            </div>

            {product.brand && (
              <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">{product.brand}</p>
            )}
            <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light leading-[1.05] text-balance">
              {product.name}
            </h1>

            {product.price && (
              <p className="font-serif text-3xl text-charcoal mt-5">
                {priceNum > 0 ? `$${priceNum.toFixed(2)} ${product.currency || 'USD'}` : product.price}
              </p>
            )}

            {product.is_sponsored && product.sponsor_name && (
              <div className="mt-4 bg-taupe-light/60 border border-taupe/40 rounded-sm px-4 py-3">
                <p className="text-xs text-charcoal-muted">
                  <strong className="text-charcoal">Sponsored</strong> — brought to you by {product.sponsor_name}
                  {product.disclosure_text && <span className="block mt-1">{product.disclosure_text}</span>}
                </p>
              </div>
            )}

            {product.description && (
              <p className="text-charcoal-muted text-lg leading-relaxed mt-6">{product.description}</p>
            )}

            {/* What's included (digital only) */}
            {isDigital && product.what_is_included && (
              <div className="mt-6 bg-taupe-light/40 rounded-sm p-5 border border-taupe/30">
                <div className="flex items-center gap-2 mb-2">
                  <Check size={14} strokeWidth={1.5} className="text-bronze" />
                  <p className="text-[10px] tracking-editorial uppercase text-bronze">What's Included</p>
                </div>
                <p className="text-sm text-charcoal leading-relaxed whitespace-pre-wrap">{product.what_is_included}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 mt-8">
              {/* Digital product: Add to Cart only, no vendor button */}
              {isDigital && priceNum > 0 && (
                <button
                  onClick={handleAddToCart}
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-bronze text-white text-sm tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 rounded-sm flex-1 lg:flex-none"
                >
                  <ShoppingBag size={16} strokeWidth={1.5} /> Add to Cart
                </button>
              )}
              {/* Digital product: preview */}
              {isDigital && product.preview_file_path && (
                <a
                  href={getPublicStorageUrl(product.preview_file_path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-6 py-4 border border-charcoal text-charcoal text-sm tracking-editorial uppercase font-medium hover:bg-charcoal hover:text-white transition-all duration-500 rounded-sm"
                >
                  <Download size={16} strokeWidth={1.5} /> Preview
                </a>
              )}
              {/* Affiliate product: Shop Now button */}
              {hasAffiliate && !isDigital && (
                <button
                  onClick={handleAffiliateClick}
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-bronze text-white text-sm tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 rounded-sm flex-1 lg:flex-none"
                >
                  Shop Now <ExternalLink size={16} strokeWidth={1.5} />
                </button>
              )}
              <button
                onClick={() => toggleItem({ id: product.id, name: product.name, slug: product.slug || product.id, price: priceNum, image_url: product.image_url })}
                className="w-12 h-12 rounded-sm border border-taupe flex items-center justify-center text-charcoal-muted hover:text-bronze hover:border-bronze transition-all"
                aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
              >
                <Heart size={18} strokeWidth={1.5} fill={isWishlisted ? 'currentColor' : 'none'} className={isWishlisted ? 'text-bronze' : ''} />
              </button>
            </div>

            {/* Affiliate disclosure */}
            {hasAffiliate && !isDigital && (
              <p className="text-xs text-charcoal-muted mt-4 italic">
                Some links may be affiliate links. We only recommend products we genuinely use and love.
              </p>
            )}

            {/* Digital product delivery info */}
            {isDigital && (
              <div className="mt-6 flex items-start gap-3 text-sm text-charcoal-muted bg-taupe-light/30 rounded-sm p-4 border border-taupe/20">
                <Download size={16} className="text-bronze flex-shrink-0 mt-0.5" />
                <p>Instant download after checkout. Your download link will also be emailed to you automatically after payment.</p>
              </div>
            )}
          </div>
        </div>

        {/* {/* Detailed sections — different for digital vs affiliate */}
        <div className="container-narrow mt-16">
          {isDigital ? (
            /* Digital product: show as clean editorial sections */
            <>
              {product.what_it_is && (
                <div className="mb-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-bronze/10 flex items-center justify-center">
                      <BookOpen size={16} strokeWidth={1.5} className="text-bronze" />
                    </div>
                    <h2 className="font-serif text-2xl text-charcoal font-light">About This Guide</h2>
                  </div>
                  <p className="text-charcoal-muted text-lg leading-[1.8]">{product.what_it_is}</p>
                </div>
              )}
              {product.what_its_used_for && (
                <div className="mb-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-bronze/10 flex items-center justify-center">
                      <FileText size={16} strokeWidth={1.5} className="text-bronze" />
                    </div>
                    <h2 className="font-serif text-2xl text-charcoal font-light">What You'll Learn</h2>
                  </div>
                  <p className="text-charcoal-muted text-lg leading-[1.8]">{product.what_its_used_for}</p>
                </div>
              )}
              {product.why_we_recommend && (
                <div className="mb-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-bronze/10 flex items-center justify-center">
                      <Heart size={16} strokeWidth={1.5} className="text-bronze" />
                    </div>
                    <h2 className="font-serif text-2xl text-charcoal font-light">Why You'll Love It</h2>
                  </div>
                  <p className="text-charcoal-muted text-lg leading-[1.8]">{product.why_we_recommend}</p>
                </div>
              )}
            </>
          ) : (
            /* Affiliate product: natural flowing editorial sections */
            hasAffiliateDetails ? (
              <div className="article-prose">
                {/* Write a natural intro paragraph from what_it_is if it reads like prose */}
                {affiliateSections.map((section, i) => (
                  <div key={i} className="mb-8">
                    <h2 className="font-serif text-2xl text-charcoal font-light mb-3">{section.title}</h2>
                    <p className="text-charcoal-muted text-lg leading-[1.8]">{section.body}</p>
                  </div>
                ))}
              </div>
            ) : null
          )}
          {/* {hasAffiliate && (
        <div className="mt-12 pt-8 border-t border-taupe/30 text-center flex flex-col items-center">
          <p className="text-sm text-charcoal-muted mb-4">
            Ready to explore or purchase directly from the brand?
          </p>
          <button
            onClick={handleAffiliateClick}
            className="inline-flex items-center justify-center gap-3 px-10 py-4 bg-bronze text-white text-sm tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 rounded-sm shadow-md"
          >
            Shop on Vendor Site <ExternalLink size={16} strokeWidth={1.5} />
          </button>
        </div>
      )} */}
        </div>

        {/* Related products */}
        {relatedProducts.length > 0 && (
          <section className="bg-taupe-light/40 py-16 mt-12">
            <div className="container-wide">
              <div className="flex items-center gap-3 mb-8">
                <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">You Might Also Like</p>
                <div className="flex-1 h-[1px] bg-taupe" />
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                {relatedProducts.map(p => (
                  <ProductCard key={p.id} product={p} onAddToCart={addItem} onToggleWishlist={toggleItem} isWishlisted={hasItem(p.id)} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Product Reviews */}
        <div className="container-narrow mt-12">
          <ProductReviews productId={product.id} />
        </div>

        {/* Recently Viewed Products */}
        <RecentlyViewedProducts excludeId={product.id} />
      </div>
    </article>
  );
}
