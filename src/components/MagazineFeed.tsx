import { Clock, ArrowUpRight } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import type { PostWithRelations, Category } from '../lib/types';

interface MagazineFeedProps {
  posts: PostWithRelations[];
  categories: Category[];
  activeCategory: string;
  onCategoryChange: (slug: string) => void;
  loading?: boolean;
}

export default function MagazineFeed({ posts, categories, activeCategory, onCategoryChange, loading }: MagazineFeedProps) {
  const { navigate } = useNavigation();

  const feedCats = categories.filter(c => c.slug !== 'about');
  const tabs = [{ name: 'All', slug: 'all' }, ...feedCats.map(c => ({ name: c.name, slug: c.slug }))];

  return (
    <section className="container-wide py-16">
      <div className="flex items-center justify-between mb-10">
        <div>
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-2">The Magazine</p>
          <h2 className="font-serif text-3xl md:text-4xl font-light text-charcoal">Latest Stories</h2>
        </div>
        <p className="hidden md:block text-sm text-charcoal-muted">{posts.length} articles</p>
      </div>

      <div className="sticky top-20 z-20 -mx-6 px-6 py-4 bg-porcelain/90 backdrop-blur-md mb-10 border-b border-taupe/30">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {tabs.map(tab => (
            <button
              key={tab.slug}
              onClick={() => onCategoryChange(tab.slug)}
              className={`flex-shrink-0 px-5 py-2.5 text-xs tracking-editorial uppercase font-medium transition-all duration-400 relative ${
                activeCategory === tab.slug
                  ? 'text-charcoal'
                  : 'text-charcoal-muted hover:text-charcoal'
              }`}
            >
              {tab.name}
              {activeCategory === tab.slug && (
                <span className="absolute bottom-0 left-5 right-5 h-[2px] bg-bronze" />
              )}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex flex-col">
              <div className="skeleton aspect-[4/5] rounded-sm" />
              <div className="mt-4 space-y-3">
                <div className="skeleton h-3 w-20 rounded-full" />
                <div className="skeleton h-5 w-full" />
                <div className="skeleton h-5 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="text-center text-charcoal-muted py-20 text-lg font-light">No articles in this category yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
          {posts.map((post, i) => (
            <button
              key={post.id}
              onClick={() => navigate({ name: 'article', slug: post.slug })}
              className="group flex flex-col text-left reveal"
              style={{ transitionDelay: `${(i % 3) * 0.08}s` }}
            >
              <div className="img-zoom rounded-sm overflow-hidden luxury-shadow relative aspect-[4/5]">
                {post.cover_image && (
                  <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover" loading="lazy" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-charcoal/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                {post.category && (
                  <span className="absolute top-4 left-4 text-[9px] tracking-editorial uppercase text-white bg-charcoal/60 backdrop-blur-md px-3 py-1.5 rounded-full">
                    {post.category.name}
                  </span>
                )}
                <div className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/80 backdrop-blur-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-400">
                  <ArrowUpRight size={14} strokeWidth={1.5} className="text-charcoal" />
                </div>
              </div>
              <div className="mt-5">
                {post.author && (
                  <div className="flex items-center gap-2 mb-2.5">
                    {post.author.avatar_url && (
                      <img src={post.author.avatar_url} alt={post.author.name} className="w-6 h-6 rounded-full object-cover" />
                    )}
                    <span className="text-[11px] tracking-wider text-charcoal-muted uppercase">{post.author.name}</span>
                  </div>
                )}
                <h3 className="font-serif text-xl text-charcoal leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-3">
                  {post.title}
                </h3>
                {post.excerpt && (
                  <p className="text-charcoal-muted text-sm mt-2.5 leading-relaxed line-clamp-2">
                    {post.excerpt}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-4 text-[11px] text-charcoal-muted">
                  <span>{new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span className="text-taupe-dark">·</span>
                  <span className="flex items-center gap-1"><Clock size={10} strokeWidth={1.5} /> {post.reading_time_minutes} min</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
