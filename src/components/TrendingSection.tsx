import { Flame, Clock, ArrowRight } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import type { PostWithRelations } from '../lib/types';

export default function TrendingSection({ posts }: { posts: PostWithRelations[] }) {
  const { navigate } = useNavigation();

  if (posts.length === 0) return null;

  const trending = [...posts]
    .sort((a, b) => (b.reading_time_minutes || 0) - (a.reading_time_minutes || 0))
    .slice(0, 5);

  return (
    <section className="container-wide py-16">
      <div className="flex items-center gap-3 mb-10">
        <Flame size={18} strokeWidth={1.5} className="text-bronze" />
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Trending Now</p>
        <div className="flex-1 h-[1px] bg-taupe" />
      </div>

      <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
        {/* Lead trending article */}
        <button
          onClick={() => navigate({ name: 'article', slug: trending[0].slug })}
          className="group text-left"
        >
          <div className="img-zoom rounded-sm overflow-hidden luxury-shadow aspect-[16/10] mb-5 relative">
            {trending[0].cover_image && (
              <img src={trending[0].cover_image} alt={trending[0].title} className="w-full h-full object-cover" loading="lazy" />
            )}
            <div className="absolute top-4 left-4 w-10 h-10 rounded-full bg-bronze text-white flex items-center justify-center text-xs font-bold">
              01
            </div>
          </div>
          <span className="text-[10px] tracking-editorial uppercase text-bronze">{trending[0].category?.name}</span>
          <h3 className="font-serif text-2xl lg:text-3xl text-charcoal mt-2 leading-snug group-hover:text-bronze transition-colors duration-300">
            {trending[0].title}
          </h3>
          <p className="text-charcoal-muted text-sm mt-3 leading-relaxed line-clamp-2">{trending[0].excerpt}</p>
          <div className="flex items-center gap-3 mt-4 text-xs text-charcoal-muted">
            <span>{trending[0].author?.name}</span>
            <span className="text-taupe-dark">·</span>
            <span className="flex items-center gap-1"><Clock size={10} strokeWidth={1.5} /> {trending[0].reading_time_minutes} min</span>
          </div>
        </button>

        {/* Trending list */}
        <div className="space-y-5">
          {trending.slice(1).map((post, i) => (
            <button
              key={post.id}
              onClick={() => navigate({ name: 'article', slug: post.slug })}
              className="group flex gap-5 items-start w-full text-left pb-5 border-b border-taupe/30 last:border-0"
            >
              <span className="font-serif text-3xl text-bronze/30 font-light leading-none flex-shrink-0 w-10">
                {String(i + 2).padStart(2, '0')}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] tracking-editorial uppercase text-bronze">{post.category?.name}</span>
                <h4 className="font-serif text-base lg:text-lg text-charcoal mt-1 leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-2">
                  {post.title}
                </h4>
                <p className="text-xs text-charcoal-muted mt-1.5 flex items-center gap-1.5">
                  <Clock size={10} strokeWidth={1.5} /> {post.reading_time_minutes} min read
                </p>
              </div>
              <ArrowRight size={14} strokeWidth={1.5} className="text-charcoal-muted/40 group-hover:text-bronze group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
