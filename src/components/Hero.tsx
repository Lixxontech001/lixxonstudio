import { Bookmark, Clock, ArrowRight } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import type { PostWithRelations } from '../lib/types';

export default function Hero({ featuredPosts }: { featuredPosts: PostWithRelations[] }) {
  const { navigate } = useNavigation();

  if (featuredPosts.length === 0) return null;

  const primary = featuredPosts[0];
  const secondary = featuredPosts.slice(1, 3);

  return (
    <section className="container-wide pt-12 pb-20">
      <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
        {/* Left: Featured image card */}
        <button
          onClick={() => navigate({ name: 'article', slug: primary.slug })}
          className="group relative block w-full img-zoom rounded-sm luxury-shadow-lg aspect-[4/5] lg:aspect-[3/4]"
        >
          {primary.cover_image && (
            <img
              src={primary.cover_image}
              alt={primary.title}
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-charcoal/70 via-charcoal/10 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-8 lg:p-10 text-left">
            <span className="inline-block text-[10px] tracking-editorial uppercase text-bronze-light bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full mb-4">
              {primary.category?.name}
            </span>
            <h2 className="font-serif text-2xl md:text-3xl lg:text-4xl text-white font-light leading-tight max-w-md">
              {primary.title}
            </h2>
          </div>
        </button>

        {/* Right: Editorial content */}
        <div className="flex flex-col justify-center pt-6 lg:pt-12">
          <span className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-6">
            Featured Story
          </span>
          <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-charcoal font-light leading-[1.05] text-balance">
            {primary.title}
          </h1>
          {primary.excerpt && (
            <p className="text-charcoal-muted text-lg leading-relaxed mt-6 max-w-lg">
              {primary.excerpt}
            </p>
          )}

          {/* Meta info */}
          <div className="flex items-center gap-4 mt-8 text-xs text-charcoal-muted">
            <span className="tracking-wider uppercase">{primary.author?.name}</span>
            <span className="text-taupe-dark">·</span>
            <span className="tracking-wider uppercase">
              {new Date(primary.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="text-taupe-dark">·</span>
            <span className="flex items-center gap-1.5">
              <Clock size={12} strokeWidth={1.5} /> {primary.reading_time_minutes} min
            </span>
          </div>

          {/* CTA */}
          <button
            onClick={() => navigate({ name: 'article', slug: primary.slug })}
            className="group inline-flex items-center gap-4 mt-10 text-charcoal hover:text-bronze transition-colors duration-500 w-fit"
          >
            <span className="text-sm tracking-editorial uppercase font-medium">Read Feature Story</span>
            <span className="w-12 h-[1px] bg-charcoal group-hover:w-20 group-hover:bg-bronze transition-all duration-500" />
            <ArrowRight size={20} strokeWidth={1.5} className="group-hover:translate-x-1 transition-transform duration-300" />
          </button>

          {/* Secondary picks */}
          {secondary.length > 0 && (
            <div className="mt-14 pt-10 border-t border-taupe/50 space-y-6">
              {secondary.map(post => (
                <button
                  key={post.id}
                  onClick={() => navigate({ name: 'article', slug: post.slug })}
                  className="group flex gap-5 items-start w-full text-left"
                >
                  <div className="img-zoom rounded-sm flex-shrink-0 w-24 h-24">
                    {post.cover_image && (
                      <img src={post.cover_image} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] tracking-editorial uppercase text-bronze">{post.category?.name}</span>
                    <h3 className="font-serif text-lg text-charcoal mt-1.5 leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-2">
                      {post.title}
                    </h3>
                    <p className="text-xs text-charcoal-muted mt-1.5 flex items-center gap-2">
                      <Clock size={10} strokeWidth={1.5} /> {post.reading_time_minutes} min read
                    </p>
                  </div>
                  <Bookmark size={16} strokeWidth={1.5} className="text-charcoal-muted/40 group-hover:text-bronze transition-colors flex-shrink-0 mt-1" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
