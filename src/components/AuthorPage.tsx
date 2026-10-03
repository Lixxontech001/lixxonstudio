import { useEffect } from 'react';
import {Clock, Twitter, Instagram, Linkedin, Globe} from 'lucide-react';
import { Link } from '../context/NavigationContext';
import { useAuthorPosts } from '../hooks/useFeatures';
import { HeroSkeleton } from './Skeletons';
import EmptyState from './EmptyState';
import { Helmet } from 'react-helmet-async';

export default function AuthorPage({ slug }: { slug: string }) {
  const { author, posts, loading } = useAuthorPosts(slug);

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  if (loading) return <HeroSkeleton />;
  if (!author) return <EmptyState message="Author not found" />;

  const social = author.social_links || {};

  return (
    <main>
      <Helmet>
        <title>{author.name} | Lixxon Studio</title>
        <meta name="description" content={author.bio || `Articles by ${author.name}`} />
        <link rel="canonical" href={`${window.location.origin}/author/${author.slug}`} />
        <meta property="og:title" content={`${author.name} | Lixxon Studio`} />
        <meta property="og:description" content={author.bio || ''} />
        {author.avatar_url && <meta property="og:image" content={author.avatar_url} />}
      </Helmet>

      {/* Author header */}
      <section className="bg-taupe-light/40 py-16 md:py-24 border-b border-taupe/30">
        <div className="container-narrow text-center">
          {author.avatar_url && (
            <img
              src={author.avatar_url}
              alt={author.name}
              className="w-24 h-24 md:w-32 md:h-32 rounded-full object-cover mx-auto mb-6 luxury-shadow-lg"
            />
          )}
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Author</p>
          <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light leading-tight">{author.name}</h1>
          {author.role && <p className="text-charcoal-muted text-base mt-3">{author.role}</p>}
          {author.bio && (
            <p className="text-charcoal-muted text-lg leading-relaxed mt-6 max-w-2xl mx-auto">{author.bio}</p>
          )}
          {Object.keys(social).length > 0 && (
            <div className="flex items-center justify-center gap-3 mt-8">
              {social.twitter && (
                <a href={social.twitter} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all">
                  <Twitter size={14} strokeWidth={1.5} />
                </a>
              )}
              {social.instagram && (
                <a href={social.instagram} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all">
                  <Instagram size={14} strokeWidth={1.5} />
                </a>
              )}
              {social.linkedin && (
                <a href={social.linkedin} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all">
                  <Linkedin size={14} strokeWidth={1.5} />
                </a>
              )}
              {social.website && (
                <a href={social.website} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all">
                  <Globe size={14} strokeWidth={1.5} />
                </a>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Articles by this author */}
      <section className="container-wide py-12 md:py-16">
        <div className="flex items-center gap-3 mb-10">
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Articles by {author.name}</p>
          <div className="flex-1 h-[1px] bg-taupe" />
          <span className="text-sm text-charcoal-muted">{posts.length} {posts.length === 1 ? 'story' : 'stories'}</span>
        </div>

        {posts.length === 0 ? (
          <EmptyState message="No articles published yet" />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
            {posts.map(post => (
              <Link key={post.id} to={{ name: 'article', slug: post.slug }} className="group flex flex-col">
                <div className="img-zoom rounded-sm overflow-hidden luxury-shadow aspect-[4/5] bg-taupe-light mb-4">
                  {post.cover_image && <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover" loading="lazy" />}
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
        )}
      </section>
    </main>
  );
}
