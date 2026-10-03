import {ShoppingBag} from 'lucide-react';

import {useArticleProducts} from '../hooks/useCommerce';
import { useCart } from '../context/CartContext';
import { ProductCard } from './shop/ShopPage';
import { useWishlist } from '../context/WishlistContext';

export default function ShopThisArticle({ postId }: { postId: string }) {
  const { products, loading } = useArticleProducts(postId);
  const { addItem } = useCart();
  const { toggleItem, hasItem } = useWishlist();

  if (loading || products.length === 0) return null;

  const hasSponsored = products.some(p => p.is_sponsored);

  return (
    <section className="mt-12 pt-10 border-t border-taupe/50">
      <div className="flex items-center gap-3 mb-6">
        <ShoppingBag size={16} strokeWidth={1.5} className="text-bronze" />
        <div>
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Recommended for This Guide</p>
          <h3 className="font-serif text-xl text-charcoal font-light">Shop This Article</h3>
        </div>
        <div className="flex-1 h-[1px] bg-taupe" />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map(product => (
          <ProductCard key={product.id} product={product} onAddToCart={addItem} onToggleWishlist={toggleItem} isWishlisted={hasItem(product.id)} />
        ))}
      </div>

      {hasSponsored && (
        <p className="text-xs text-charcoal-muted mt-6 italic">
          Some products in this section are sponsored. Sponsored items are clearly labeled and never affect our editorial recommendations.
        </p>
      )}
    </section>
  );
}
