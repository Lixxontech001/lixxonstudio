import { Clock, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Link } from '../context/NavigationContext';
import { normalizeImageUrl } from '../lib/images';
import type { PostWithRelations } from '../lib/types';

export default function Hero({ featuredPosts }: { featuredPosts: PostWithRelations[] }) {
  if (featuredPosts.length === 0) return null;

  const primary = featuredPosts[0];
  const sideStories = featuredPosts.slice(1, 4);

  return (
    <section className="relative">
      {/* Full-width primary featured story */}
      <div className="relative w-full h-[70vh] min-h-[480px] max-h-[700px] overflow-hidden">
        {primary.cover_image && (
          <img
            src={normalizeImageUrl(primary.cover_image) ?? ''}
            alt={primary.cover_image_alt || primary.title}
            className="absolute inset-0 w-full h-full object-cover"
            loading="eager"
            fetchPriority="high"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-charcoal/85 via-charcoal/30 to-charcoal/20" />

        <div className="relative h-full container-wide flex flex-col justify-end pb-12 md:pb-16">
          <div className="max-w-2xl">
            {primary.category && (
              <Link
                to={{ name: 'category', slug: primary.category.slug, page: 1 }}
                className="inline-block text-[10px] md:text-xs tracking-ultra-wide uppercase text-bronze-light border-b border-bronze-light/40 pb-1 mb-5 hover:border-bronze-light transition-colors"
              >
                {primary.category.name}
              </Link>
            )}
            <h1 className="font-serif text-3xl md:text-5xl lg:text-6xl text-white font-light leading-[1.05] text-balance">
              {primary.title}
            </h1>
            {primary.excerpt && (
              <p className="text-white/80 text-base md:text-lg leading-relaxed mt-5 max-w-lg line-clamp-2">
                {primary.excerpt}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-4 mt-6 text-xs text-white/70">
              <span className="tracking-wider uppercase">{primary.author?.name}</span>
              <span className="text-white/40">·</span>
              <span className="tracking-wider uppercase">
                {new Date(primary.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <span className="text-white/40">·</span>
              <span className="flex items-center gap-1.5">
                <Clock size={12} strokeWidth={1.5} /> {primary.reading_time_minutes} min read
              </span>
            </div>
            <Link
              to={{ name: 'article', slug: primary.slug }}
              className="group inline-flex items-center gap-3 mt-8 text-white hover:text-bronze-light transition-colors duration-500 w-fit"
            >
              <span className="text-xs md:text-sm tracking-editorial uppercase font-medium">Read the Story</span>
              <span className="w-10 h-[1px] bg-white group-hover:w-16 group-hover:bg-bronze-light transition-all duration-500" />
              <ArrowRight size={18} strokeWidth={1.5} className="group-hover:translate-x-1 transition-transform duration-300" />
            </Link>
          </div>
        </div>
      </div>

      {/* Side stories strip */}
      {sideStories.length > 0 && (
        <div className="container-wide py-10 md:py-12 border-b border-taupe/40">
          <div className="grid sm:grid-cols-3 gap-6 md:gap-10">
            {sideStories.map((post, i) => (
              <Link
                key={post.id}
                to={{ name: 'article', slug: post.slug }}
                className="group flex flex-col text-left"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="font-serif text-3xl text-bronze/30 font-light leading-none">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 h-[1px] bg-taupe" />
                  <ArrowUpRight size={16} strokeWidth={1.5} className="text-charcoal-muted/30 group-hover:text-bronze group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300" />
                </div>
                <span className="text-[10px] tracking-editorial uppercase text-bronze mb-2">{post.category?.name}</span>
                <h3 className="font-serif text-lg text-charcoal leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-3">
                  {post.title}
                </h3>
                <div className="flex items-center gap-2 mt-3 text-xs text-charcoal-muted">
                  <Clock size={10} strokeWidth={1.5} /> {post.reading_time_minutes} min read
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
