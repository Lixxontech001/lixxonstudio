import { TrendingUp, ArrowRight, Clock } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import type { PostWithRelations } from '../lib/types';

export default function EditorsPicks({ posts }: { posts: PostWithRelations[] }) {
  const { navigate } = useNavigation();

  if (posts.length === 0) return null;

  return (
    <section className="bg-taupe-light/50 py-20">
      <div className="container-wide">
        <div className="flex items-center gap-3 mb-12">
          <TrendingUp size={18} strokeWidth={1.5} className="text-bronze" />
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Editor's Picks</p>
          <div className="flex-1 h-[1px] bg-taupe" />
        </div>

        <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
          {posts.slice(0, 3).map((post, i) => (
            <button
              key={post.id}
              onClick={() => navigate({ name: 'article', slug: post.slug })}
              className="group text-left"
            >
              <div className="flex items-center gap-3 mb-4">
                <span className="font-serif text-5xl text-bronze/40 font-light leading-none">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex-1 h-[1px] bg-taupe" />
              </div>
              <div className="img-zoom rounded-sm overflow-hidden mb-5 aspect-[3/2]">
                {post.cover_image && (
                  <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover" loading="lazy" />
                )}
              </div>
              <span className="text-[10px] tracking-editorial uppercase text-bronze">{post.category?.name}</span>
              <h3 className="font-serif text-xl lg:text-2xl text-charcoal mt-2 leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-2">
                {post.title}
              </h3>
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-charcoal-muted flex items-center gap-1.5">
                  <Clock size={10} strokeWidth={1.5} /> {post.reading_time_minutes} min read
                </span>
                <ArrowRight size={16} strokeWidth={1.5} className="text-charcoal-muted group-hover:text-bronze group-hover:translate-x-1 transition-all duration-300" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
