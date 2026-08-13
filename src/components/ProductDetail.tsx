import { ExternalLink, ArrowLeft, Check, Tag, Beaker, Heart, Sparkles } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import { useProducts } from '../hooks/useSupabase';
import { HeroSkeleton } from './Skeletons';
import EmptyState from './EmptyState';
import { Helmet } from 'react-helmet-async';

export default function ProductDetail({ slug }: { slug: string }) {
  const { navigate } = useNavigation();
  const { products, loading } = useProducts();

  const product = products.find(p => p.slug === slug);

  if (loading) return <HeroSkeleton />;
  if (!product) return <EmptyState message="Product not found" />;

  const categoryLabel = product.category
    ? product.category.charAt(0).toUpperCase() + product.category.slice(1)
    : 'Product';

  return (
    <>
      <Helmet>
        <title>{product.name} | Lixxon Studio</title>
        <meta name="description" content={product.description || `An in-depth look at ${product.name} by ${product.brand}`} />
        <meta property="og:title" content={`${product.name} | Lixxon Studio`} />
        <meta property="og:description" content={product.description || ''} />
        {product.image_url && <meta property="og:image" content={product.image_url} />}
      </Helmet>

      <article>
        <div className="container-narrow pt-12 pb-8">
          <button
            onClick={() => navigate({ name: 'home' })}
            className="inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors mb-8"
          >
            <ArrowLeft size={14} strokeWidth={1.5} /> Back to Magazine
          </button>

          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-5">{categoryLabel}</p>
          <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light leading-[1.05] text-balance">
            {product.name}
          </h1>
          {product.brand && (
            <p className="text-charcoal-muted text-lg mt-3">by {product.brand}</p>
          )}
        </div>

        <div className="container-wide mb-12">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            <div className="rounded-sm overflow-hidden luxury-shadow-lg aspect-square bg-taupe-light">
              {product.image_url && (
                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              )}
            </div>

            <div className="flex flex-col">
              {product.price && (
                <p className="font-serif text-3xl text-charcoal mb-6">{product.price}</p>
              )}
              {product.description && (
                <p className="text-charcoal-muted text-lg leading-relaxed mb-8">{product.description}</p>
              )}

              {product.key_ingredients && (
                <div className="bg-taupe-light/40 rounded-sm p-5 mb-8 border border-taupe/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Beaker size={14} strokeWidth={1.5} className="text-bronze" />
                    <p className="text-[10px] tracking-editorial uppercase text-bronze">Key Ingredients</p>
                  </div>
                  <p className="text-sm text-charcoal leading-relaxed">{product.key_ingredients}</p>
                </div>
              )}

              {product.affiliate_url && product.affiliate_url !== '#' && (
                <a
                  href={product.affiliate_url}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-bronze text-white text-sm tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 rounded-sm w-full lg:w-fit"
                >
                  Shop Now <ExternalLink size={16} strokeWidth={1.5} />
                </a>
              )}

              <p className="text-xs text-charcoal-muted mt-4 italic">
                Some links may be affiliate links. We only recommend products we genuinely use and love.
              </p>
            </div>
          </div>
        </div>

        <div className="container-narrow py-8">
          {product.what_it_is && (
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-bronze/10 flex items-center justify-center">
                  <Sparkles size={16} strokeWidth={1.5} className="text-bronze" />
                </div>
                <h2 className="font-serif text-2xl text-charcoal font-light">What It Is</h2>
              </div>
              <p className="text-charcoal-muted text-lg leading-[1.8]">{product.what_it_is}</p>
            </div>
          )}

          {product.what_its_used_for && (
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-bronze/10 flex items-center justify-center">
                  <Tag size={16} strokeWidth={1.5} className="text-bronze" />
                </div>
                <h2 className="font-serif text-2xl text-charcoal font-light">What It's Used For</h2>
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
                <h2 className="font-serif text-2xl text-charcoal font-light">Why We Recommend It</h2>
              </div>
              <p className="text-charcoal-muted text-lg leading-[1.8]">{product.why_we_recommend}</p>
            </div>
          )}

          <div className="bg-taupe-light/30 rounded-sm p-6 border border-taupe/30 mt-12">
            <div className="flex items-start gap-3">
              <Check size={18} strokeWidth={1.5} className="text-bronze flex-shrink-0 mt-1" />
              <p className="text-sm text-charcoal-muted leading-relaxed">
                Every product on Lixxon Studio is independently selected and tested by our editorial team.
                We never accept payment for placement, and affiliate commissions never influence our recommendations.
              </p>
            </div>
          </div>
        </div>
      </article>
    </>
  );
}
