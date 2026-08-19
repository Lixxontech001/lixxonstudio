import { ExternalLink } from 'lucide-react';
import { useProducts } from '../hooks/useSupabase';
import { useNavigation } from '../context/NavigationContext';

export default function ProductGrid() {
  const { products, loading } = useProducts();
  const { navigate } = useNavigation();

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

  const categories = [...new Set(products.map(p => p.category).filter(Boolean))] as string[];
  const categoryLabels: Record<string, string> = {
    skincare: 'Skincare Essentials',
    wellness: 'Wellness Picks',
    style: 'Style Essentials',
  };

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

        {categories.map(cat => {
          const catProducts = products.filter(p => p.category === cat);
          if (catProducts.length === 0) return null;
          return (
            <div key={cat} className="mb-12 last:mb-0">
              <div className="flex items-center gap-3 mb-6">
                <h3 className="font-serif text-xl text-charcoal font-light">{categoryLabels[cat] || cat}</h3>
                <div className="flex-1 h-[1px] bg-taupe" />
                <span className="text-xs text-charcoal-muted">{catProducts.length} {catProducts.length === 1 ? 'item' : 'items'}</span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
                {catProducts.map(product => (
                  <button
                    key={product.id}
                    onClick={() => product.slug && navigate({ name: 'product', slug: product.slug })}
                    className="group bg-white rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500 text-left"
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
                          Details <ExternalLink size={12} strokeWidth={1.5} />
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        <p className="text-center text-xs text-charcoal-muted mt-10 italic">
          Some links may be affiliate links. We only recommend products we genuinely love.
        </p>
      </div>
    </section>
  );
}
