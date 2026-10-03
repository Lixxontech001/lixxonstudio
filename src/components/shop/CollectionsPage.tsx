import { useEffect } from 'react';
import { Link } from '../../context/NavigationContext';
import { useCollections } from '../../hooks/useCommerce';
import { ArrowRight } from 'lucide-react';
import { Helmet } from 'react-helmet-async';

export default function CollectionsPage() {
  const { collections, loading } = useCollections();

  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <main>
      <Helmet>
        <title>Collections | Lixxon Studio</title>
        <meta name="description" content="Curated editorial collections from Lixxon Studio — themed guides for intentional living." />
        <link rel="canonical" href={`${window.location.origin}/collections`} />
      </Helmet>

      <section className="container-wide pt-12 pb-8 md:pt-16 md:pb-12">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Collections</p>
        <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-charcoal font-light leading-[1.05] text-balance">
          Curated reading journeys.
        </h1>
        <p className="text-charcoal-muted text-lg mt-5 max-w-xl leading-relaxed">
          Thoughtfully grouped articles and guides — from beginner's essentials to seasonal resets.
        </p>
      </section>

      <section className="container-wide pb-16">
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton aspect-[4/5] rounded-sm" />)}
          </div>
        ) : collections.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-6">
              <ArrowRight size={24} strokeWidth={1.5} className="text-bronze" />
            </div>
            <h2 className="font-serif text-2xl text-charcoal font-light">No collections yet</h2>
            <p className="text-charcoal-muted text-sm mt-3 max-w-md mx-auto">
              Curated collections of our best articles will appear here soon.
            </p>
            <Link to={{ name: 'home', page: 1 }} className="inline-flex items-center gap-3 mt-6 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm">
              Browse the Magazine <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {collections.map(col => (
              <Link key={col.id} to={{ name: 'collection', slug: col.slug }} className="group block bg-white rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500">
                <div className="img-zoom aspect-[4/5] bg-taupe-light relative">
                  {col.cover_image && <img src={col.cover_image} alt={col.title} className="w-full h-full object-cover" loading="lazy" />}
                  {col.is_featured && (
                    <span className="absolute top-3 left-3 text-[9px] tracking-editorial uppercase text-white bg-bronze/90 backdrop-blur-md px-2.5 py-1 rounded-full">
                      Featured
                    </span>
                  )}
                </div>
                <div className="p-5">
                  <h3 className="font-serif text-xl text-charcoal group-hover:text-bronze transition-colors duration-300">{col.title}</h3>
                  {col.description && <p className="text-charcoal-muted text-sm mt-2 line-clamp-2 leading-relaxed">{col.description}</p>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
