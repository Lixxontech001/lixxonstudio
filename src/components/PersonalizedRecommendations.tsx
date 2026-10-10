import { displayImageUrl } from '../lib/images';
import { Clock, Sparkles } from 'lucide-react';
import { Link } from '../context/NavigationContext';
import { usePersonalizedRecommendations } from '../hooks/useFeatures';

export default function PersonalizedRecommendations() {
  const { posts, loading } = usePersonalizedRecommendations();

  if (loading || posts.length === 0) return null;

  return (
    <section className="bg-taupe-light/40 py-16 border-t border-taupe/30">
      <div className="container-wide">
        <div className="flex items-center gap-3 mb-8">
          <Sparkles size={16} strokeWidth={1.5} className="text-bronze" />
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">For You</p>
          <div className="flex-1 h-[1px] bg-taupe" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          {posts.map(post => (
            <Link key={post.id} to={{ name: 'article', slug: post.slug }} className="group flex flex-col bg-white rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500">
              <div className="img-zoom aspect-[4/5] overflow-hidden">
                {post.cover_image && <img src={displayImageUrl(post.cover_image)} alt={post.title} className="w-full h-full object-cover" loading="lazy" />}
              </div>
              <div className="p-5 flex flex-col flex-1">
                {post.category && <span className="text-[10px] tracking-editorial uppercase text-bronze">{post.category.name}</span>}
                <h4 className="font-serif text-base text-charcoal mt-2 leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-2">{post.title}</h4>
                <div className="flex items-center gap-2 mt-4 text-xs text-charcoal-muted">
                  <Clock size={10} strokeWidth={1.5} /> {post.reading_time_minutes} min read
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
