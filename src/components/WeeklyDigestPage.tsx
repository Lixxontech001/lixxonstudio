import { displayImageUrl } from '../lib/images';
import { useEffect } from 'react';
import {Clock, Calendar, ArrowRight} from 'lucide-react';
import { Link } from '../context/NavigationContext';
import { useWeeklyDigest } from '../hooks/useFeatures';
import { FeedSkeleton } from './Skeletons';
import Newsletter from './Newsletter';
import { Helmet } from 'react-helmet-async';

export default function WeeklyDigestPage() {
  const { posts, loading } = useWeeklyDigest();

  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <main>
      <Helmet>
        <title>Weekly Digest | Lixxon Studio</title>
        <meta name="description" content="Your weekly roundup of the best in skincare, style, and wellness." />
      </Helmet>

      <section className="bg-taupe-light/40 py-16 md:py-24 border-b border-taupe/30">
        <div className="container-narrow text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <Calendar size={16} strokeWidth={1.5} className="text-bronze" />
            <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Weekly Digest</p>
          </div>
          <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light leading-tight">
            This Week in Beauty, Style & Wellness
          </h1>
          <p className="text-charcoal-muted text-base md:text-lg mt-5 max-w-xl mx-auto leading-relaxed">
            The stories worth your time from the past seven days, curated by our editorial team.
          </p>
        </div>
      </section>

      <section className="container-wide py-12 md:py-16">
        {loading ? (
          <FeedSkeleton />
        ) : posts.length === 0 ? (
          <div className="container-narrow text-center py-20">
            <h2 className="font-serif text-2xl text-charcoal font-light mb-3">No new stories this week</h2>
            <p className="text-charcoal-muted text-sm leading-relaxed mb-8">
              Check back soon for fresh articles, or explore our archive.
            </p>
            <Link to={{ name: 'home', page: 1 }} className="inline-flex items-center gap-2 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all">
              Browse Magazine <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
            {posts.map(post => (
              <Link key={post.id} to={{ name: 'article', slug: post.slug }} className="group flex flex-col">
                <div className="img-zoom rounded-sm overflow-hidden luxury-shadow aspect-[4/5] bg-taupe-light mb-4">
                  {post.cover_image && <img src={displayImageUrl(post.cover_image)} alt={post.title} className="w-full h-full object-cover" loading="lazy" />}
                </div>
                {post.category && <span className="text-[10px] tracking-editorial uppercase text-bronze mb-2">{post.category.name}</span>}
                <h3 className="font-serif text-lg text-charcoal leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-3">{post.title}</h3>
                {post.excerpt && <p className="text-charcoal-muted text-sm mt-2 line-clamp-2 leading-relaxed">{post.excerpt}</p>}
                <div className="flex items-center gap-3 mt-3 text-xs text-charcoal-muted">
                  <span className="flex items-center gap-1.5"><Clock size={10} strokeWidth={1.5} /> {post.reading_time_minutes} min read</span>
                  <span>·</span>
                  <span>{new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Newsletter />
    </main>
  );
}
