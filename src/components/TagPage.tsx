import { displayImageUrl } from '../lib/images';
import { useEffect } from 'react';
import { Clock, Hash } from 'lucide-react';
import { Link } from '../context/NavigationContext';
import { useTagPosts } from '../hooks/useFeatures';
import { FeedSkeleton } from './Skeletons';
import EmptyState from './EmptyState';
import Pagination from './Pagination';
import { Helmet } from 'react-helmet-async';
import QueryStatusNotice from './QueryStatusNotice';

export default function TagPage({ tag, page }: { tag: string; page: number }) {
  const { posts, totalPages, loading, error, retry } = useTagPosts(tag, page);
  useEffect(() => { window.scrollTo(0, 0); }, [tag, page]);

  const buildRoute = (p: number) => ({ name: 'tag' as const, tag, page: p });

  return (
    <main>
      <Helmet>
        <title>{`#${tag} | Lixxon Studio`}</title>
        <meta name="description" content={`Articles tagged with ${tag}`} />
      </Helmet>

      <section className="bg-taupe-light/40 py-12 md:py-16 border-b border-taupe/30">
        <div className="container-narrow text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <Hash size={16} strokeWidth={1.5} className="text-bronze" />
            <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Tag</p>
          </div>
          <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light">{tag}</h1>
        </div>
      </section>

      <section className="container-wide py-12 md:py-16">
        <QueryStatusNotice loading={loading} hasData={posts.length > 0} error={error} onRetry={retry} />
        {loading && posts.length === 0 ? (
          <FeedSkeleton />
        ) : error && posts.length === 0 ? null : posts.length === 0 ? (
          <EmptyState message={`No articles tagged "${tag}" yet`} />
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10 mb-12">
              {posts.map(post => (
                <Link key={post.id} to={{ name: 'article', slug: post.slug }} className="group flex flex-col">
                  <div className="img-zoom rounded-sm overflow-hidden luxury-shadow aspect-[4/5] bg-taupe-light mb-4">
                    {post.cover_image && <img src={displayImageUrl(post.cover_image)} alt={post.title} className="w-full h-full object-cover" loading="lazy" />}
                  </div>
                  {post.category && <span className="text-[10px] tracking-editorial uppercase text-bronze mb-2">{post.category.name}</span>}
                  <h3 className="font-serif text-lg text-charcoal leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-3">{post.title}</h3>
                  {post.excerpt && <p className="text-charcoal-muted text-sm mt-2 line-clamp-2 leading-relaxed">{post.excerpt}</p>}
                  <div className="flex items-center gap-2 mt-3 text-xs text-charcoal-muted">
                    <Clock size={10} strokeWidth={1.5} /> {post.reading_time_minutes} min read
                  </div>
                </Link>
              ))}
            </div>
            {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} buildRoute={buildRoute} />}
          </>
        )}
      </section>
    </main>
  );
}
