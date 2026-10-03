import { Link } from '../../context/NavigationContext';
import { useRecentlyViewedProducts } from '../../hooks/useFeatures';
import { Clock } from 'lucide-react';

export default function RecentlyViewedProducts({ excludeId }: { excludeId?: string }) {
  const products = useRecentlyViewedProducts();
  const filtered = excludeId ? products.filter(p => p.id !== excludeId) : products;

  if (filtered.length === 0) return null;

  return (
    <section className="container-wide py-12 border-t border-taupe/30">
      <div className="flex items-center gap-3 mb-6">
        <Clock size={16} strokeWidth={1.5} className="text-bronze" />
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Recently Viewed</p>
        <div className="flex-1 h-[1px] bg-taupe" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
        {filtered.slice(0, 6).map(product => (
          <Link key={product.id} to={{ name: 'shop-product', slug: product.slug }} className="group">
            <div className="aspect-square rounded-sm overflow-hidden bg-taupe-light luxury-shadow mb-3 img-zoom">
              {product.image_url && <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" loading="lazy" />}
            </div>
            <p className="text-xs text-charcoal leading-snug group-hover:text-bronze transition-colors line-clamp-2">{product.name}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
