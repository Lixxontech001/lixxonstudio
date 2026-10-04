import { useEffect } from 'react';
import { ArrowLeft, Clock } from 'lucide-react';
import { Link, useNavigation } from '../../context/NavigationContext';
import { useCollection } from '../../hooks/useCommerce';
import EmptyState from '../EmptyState';
import { renderMarkdown } from '../../lib/markdown';
import { Helmet } from 'react-helmet-async';

export default function CollectionDetailPage({ slug }: { slug: string }) {
  const { collection, loading } = useCollection(slug);
  const { navigate } = useNavigation();

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  if (loading) {
    return (
      <div className="container-wide pt-12 pb-16">
        <div className="skeleton h-8 w-48 mb-4" />
        <div className="skeleton h-16 w-3/4 mb-8" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton aspect-[4/3] rounded-sm" />)}
        </div>
      </div>
    );
  }

  if (!collection) return <EmptyState message="Collection not found" />;

  const items = collection.items || [];

  return (
    <main>
      <Helmet>
        <title>{collection.title} | Lixxon Studio</title>
        <meta name="description" content={collection.description || collection.title} />
        <link rel="canonical" href={`${window.location.origin}/collections/${collection.slug}`} />
        <meta property="og:title" content={`${collection.title} | Lixxon Studio`} />
        <meta property="og:description" content={collection.description || ''} />
        {collection.cover_image && <meta property="og:image" content={collection.cover_image} />}
      </Helmet>

      <section className="container-wide pt-12 pb-8">
        <button onClick={() => navigate({ name: 'collections' })} className="inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors mb-8">
          <ArrowLeft size={14} strokeWidth={1.5} /> All Collections
        </button>

        {collection.cover_image && (
          <div className="aspect-[21/9] rounded-sm overflow-hidden luxury-shadow-lg mb-8 bg-taupe-light">
            <img src={collection.cover_image} alt={collection.title} className="w-full h-full object-cover" />
          </div>
        )}

        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Collection</p>
        <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-charcoal font-light leading-[1.05] text-balance">
          {collection.title}
        </h1>
        {collection.description && (
          <div className="text-charcoal-muted text-lg mt-5 max-w-2xl leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(collection.description) }} />
        )}
      </section>

      <section className="container-wide pb-16">
        {items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-charcoal-muted">This collection has no articles yet.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {items.map((item, idx) => {
              const post = item.post;
              if (!post) return null;
              return (
                <Link key={item.id} to={{ name: 'article', slug: post.slug }} className="group block bg-white rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500">
                  <div className="img-zoom aspect-[4/3] bg-taupe-light">
                    {post.cover_image && <img src={post.cover_image} alt={post.cover_image_alt || post.title} className="w-full h-full object-cover" loading="lazy" width={400} height={300} />}
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-2 text-[10px] tracking-editorial uppercase text-charcoal-muted">
                      <span className="text-bronze">{String(idx + 1).padStart(2, '0')}</span>
                      {post.category && <span>{post.category.name}</span>}
                      {post.reading_time_minutes && <span className="flex items-center gap-1"><Clock size={10} /> {post.reading_time_minutes} min</span>}
                    </div>
                    <h3 className="font-serif text-lg text-charcoal group-hover:text-bronze transition-colors duration-300 leading-snug line-clamp-3">{post.title}</h3>
                    {post.excerpt && <p className="text-charcoal-muted text-sm mt-2 line-clamp-2 leading-relaxed">{post.excerpt}</p>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
