import { ExternalLink } from 'lucide-react';
import { useProducts } from '../hooks/useSupabase';

export default function ProductGrid() {
  const { products, loading } = useProducts();

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

  if (products.length === 0) return null;

  return (
    <section className="bg-taupe-light/40 py-20">
      <div className="container-wide">
        <div className="text-center mb-12">
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">Editor's Shelf</p>
          <h2 className="font-serif text-3xl md:text-4xl font-light text-charcoal">Recommended Products</h2>
          <p className="text-charcoal-muted text-base mt-3 max-w-md mx-auto">
            A curated selection of skincare and wellness essentials our editors use daily.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
          {products.map(product => (
            <a
              key={product.id}
              href={product.affiliate_url || '#'}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="group bg-white rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500"
            >
              <div className="img-zoom aspect-square bg-taupe-light">
                {product.image_url && (
                  <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" loading="lazy" />
                )}
              </div>
              <div className="p-6">
                {product.brand && (
                  <p className="text-[10px] tracking-editorial uppercase text-bronze mb-2">{product.brand}</p>
                )}
                <h3 className="font-serif text-lg text-charcoal leading-snug group-hover:text-bronze transition-colors duration-300">
                  {product.name}
                </h3>
                {product.description && (
                  <p className="text-charcoal-muted text-sm mt-2 leading-relaxed line-clamp-2">{product.description}</p>
                )}
                <div className="flex items-center justify-between mt-5">
                  <span className="font-serif text-xl text-charcoal">{product.price}</span>
                  <span className="flex items-center gap-1.5 text-xs tracking-wider uppercase text-charcoal-muted group-hover:text-bronze transition-colors">
                    Shop <ExternalLink size={12} strokeWidth={1.5} />
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>

        <p className="text-center text-xs text-charcoal-muted mt-10 italic">
          Some links may be affiliate links. We only recommend products we genuinely love.
        </p>
      </div>
    </section>
  );
}
