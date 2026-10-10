import { displayImageUrl } from '../lib/images';
import type { Product } from '../lib/types';
import { ExternalLink, ArrowRight, Download } from 'lucide-react';
import { useShopProducts } from '../hooks/useCommerce';
import { Link } from '../context/NavigationContext';

export default function ProductGrid() {
  const { products, loading } = useShopProducts();

  if (loading) {
    return (
      <section className="container-wide py-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex flex-col">
              <div className="skeleton aspect-square rounded-sm" />
              <div className="mt-4 space-y-3">
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-5 w-full" />
                <div className="skeleton h-4 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const digitalGuides = products.filter(p => p.product_type === 'digital' || p.is_digital);
  const affiliateProducts = products.filter(p => p.product_type === 'affiliate' || (!p.is_digital && p.product_type !== 'digital'));

  if (products.length === 0) return null;

  return (
    <section className="bg-taupe-light/40 py-20">
      <div className="container-wide">
        {/* Digital Guides section */}
        {digitalGuides.length > 0 && (
          <div className="mb-16">
            <div className="flex items-center justify-between mb-8">
              <div>
                <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-2">Digital Guides</p>
                <h2 className="font-serif text-3xl md:text-4xl font-light text-charcoal">Guides & Resources</h2>
              </div>
              <Link to={{ name: 'shop' }} className="hidden md:inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors">
                View All <ArrowRight size={14} />
              </Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
              {digitalGuides.slice(0, 3).map(product => (
                <ProductMiniCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        )}

        {/* Affiliate / Editor's Shelf */}
        {affiliateProducts.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-8">
              <div>
                <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-2">Editor's Shelf</p>
                <h2 className="font-serif text-3xl md:text-4xl font-light text-charcoal">Recommended Products</h2>
              </div>
              <Link to={{ name: 'shop' }} className="hidden md:inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors">
                View All <ArrowRight size={14} />
              </Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
              {affiliateProducts.slice(0, 6).map(product => (
                <ProductMiniCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-charcoal-muted mt-12 italic">
          Some links may be affiliate links. We only recommend products we genuinely love.
        </p>
      </div>
    </section>
  );
}

function ProductMiniCard({ product }: { product: Product }) {
  const isDigital = product.product_type === 'digital' || product.is_digital;
  const priceNum = parseFloat(product.price || '0');

  return (
    <Link
      to={product.slug ? { name: 'shop-product', slug: product.slug } : { name: 'shop' }}
      className="group bg-white rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500 text-left flex flex-col"
    >
      <div className="img-zoom aspect-square bg-taupe-light relative">
        {product.image_url && (
          <img src={displayImageUrl(product.image_url)} alt={product.name} className="w-full h-full object-cover" loading="lazy" />
        )}
        {isDigital && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 text-[9px] tracking-editorial uppercase text-white bg-bronze/80 backdrop-blur-sm px-2.5 py-1 rounded-full">
            <Download size={10} /> Digital
          </span>
        )}
      </div>
      <div className="p-5 flex flex-col flex-1">
        {product.brand && (
          <p className="text-[10px] tracking-editorial uppercase text-bronze mb-1.5">{product.brand}</p>
        )}
        <h3 className="font-serif text-lg text-charcoal leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-2">
          {product.name}
        </h3>
        {product.description && (
          <p className="text-charcoal-muted text-sm mt-2 leading-relaxed line-clamp-2 flex-1">{product.description}</p>
        )}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-taupe/30">
          {product.price && (
            <span className="font-serif text-xl text-charcoal">
              {priceNum > 0 ? `$${priceNum.toFixed(2)}` : product.price}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs tracking-wider uppercase text-charcoal-muted group-hover:text-bronze transition-colors">
            {isDigital ? 'Details' : 'Details'} <ExternalLink size={12} strokeWidth={1.5} />
          </span>
        </div>
      </div>
    </Link>
  );
}
