import { TrendingUp, Clock } from 'lucide-react';
import { Link } from '../context/NavigationContext';
import { useMostReadThisWeek } from '../hooks/usePlatform';

export default function MostReadThisWeek() {
  const { posts, loading } = useMostReadThisWeek();

  if (loading || posts.length === 0) return null;

  return (
    <section className="container-wide py-12 border-t border-taupe/30">
      <div className="flex items-center gap-3 mb-8">
        <TrendingUp size={16} strokeWidth={1.5} className="text-bronze" />
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Most Read This Week</p>
        <div className="flex-1 h-[1px] bg-taupe" />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-6">
        {posts.map((post, i) => (
          <Link key={post.id} to={{ name: 'article', slug: post.slug }} className="group flex flex-col">
            <span className="font-serif text-3xl text-bronze/30 font-light leading-none mb-3">{String(i + 1).padStart(2, '0')}</span>
            {post.cover_image && (
              <div className="img-zoom rounded-sm overflow-hidden luxury-shadow aspect-[4/3] bg-taupe-light mb-3">
                <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover" loading="lazy" />
              </div>
            )}
            {post.category && <span className="text-[10px] tracking-editorial uppercase text-bronze mb-1">{post.category.name}</span>}
            <h3 className="font-serif text-sm text-charcoal leading-snug group-hover:text-bronze transition-colors line-clamp-2">{post.title}</h3>
          </Link>
        ))}
      </div>
    </section>
  );
}
