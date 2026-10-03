import { useEffect } from 'react';
import { useShopProducts, useShopCategories } from '../../hooks/useCommerce';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { ProductCard } from './ShopPage';
import { Helmet } from 'react-helmet-async';

export default function ShopCategoryPage({ slug }: { slug: string }) {
  const { products, loading } = useShopProducts(slug);
  const { categories } = useShopCategories();
  const { addItem } = useCart();
  const { toggleItem, hasItem } = useWishlist();

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  const category = categories.find(c => c.slug === slug);

  return (
    <main>
      <Helmet>
        <title>{category ? `${category.name} | Shop | Lixxon Studio` : 'Shop | Lixxon Studio'}</title>
        <meta name="description" content={category?.description || `Browse ${category?.name || slug} products at Lixxon Studio.`} />
      </Helmet>

      <section className="container-wide pt-12 pb-8">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Shop Category</p>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light">
          {category?.name || slug}
        </h1>
        {category?.description && (
          <p className="text-charcoal-muted text-lg mt-4 max-w-xl leading-relaxed">{category.description}</p>
        )}
      </section>

      <section className="container-wide py-8">
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex flex-col">
                <div className="skeleton aspect-square rounded-sm" />
                <div className="mt-4 space-y-3">
                  <div className="skeleton h-3 w-1/2" />
                  <div className="skeleton h-5 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-20">
            <p className="font-serif text-2xl text-charcoal font-light">No products in this category yet</p>
            <p className="text-charcoal-muted text-sm mt-3">Check back soon for new arrivals.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {products.map(product => (
              <ProductCard key={product.id} product={product} onAddToCart={addItem} onToggleWishlist={toggleItem} isWishlisted={hasItem(product.id)} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
