import { useEffect, useState } from 'react';
import { Clock, Calendar, ArrowLeft, Twitter, Link2, Check, Bookmark, Printer } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import { usePostBySlug, usePosts } from '../hooks/useSupabase';
import { HeroSkeleton } from './Skeletons';
import EmptyState from './EmptyState';

export default function ArticleReader({ slug }: { slug: string }) {
  const { navigate } = useNavigation();
  const { post, loading } = usePostBySlug(slug);
  const { posts } = usePosts();
  const [copied, setCopied] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  if (loading) return <HeroSkeleton />;

  if (!post) {
    return <EmptyState message="Article not found" />;
  }

  const recommended = posts.filter(p => p.id !== post.id && p.category_id === post.category_id).slice(0, 3);
  const fallbackRecommended = posts.filter(p => p.id !== post.id).slice(0, 3);
  const recommendedList = recommended.length >= 3 ? recommended : fallbackRecommended;

  const articleUrl = `${window.location.origin}/#/blog/${post.slug}`;
  const shareText = encodeURIComponent(post.title);

  const copyLink = () => {
    navigator.clipboard.writeText(articleUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  // Parse simple markdown-like content into HTML
  const renderContent = (content: string | null) => {
    if (!content) return null;
    const lines = content.split('\n');
    const html: string[] = [];
    let inList = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inList) { html.push('</ul>'); inList = false; }
        continue;
      }
      if (trimmed.startsWith('## ')) {
        if (inList) { html.push('</ul>'); inList = false; }
        html.push(`<h2>${trimmed.slice(3)}</h2>`);
      } else if (trimmed.startsWith('### ')) {
        if (inList) { html.push('</ul>'); inList = false; }
        html.push(`<h3>${trimmed.slice(4)}</h3>`);
      } else if (trimmed.startsWith('> ')) {
        if (inList) { html.push('</ul>'); inList = false; }
        html.push(`<blockquote>${trimmed.slice(2)}</blockquote>`);
      } else if (trimmed.startsWith('- ')) {
        if (!inList) { html.push('<ul>'); inList = true; }
        html.push(`<li>${trimmed.slice(2)}</li>`);
      } else {
        if (inList) { html.push('</ul>'); inList = false; }
        html.push(`<p>${trimmed}</p>`);
      }
    }
    if (inList) html.push('</ul>');
    return html.join('');
  };

  return (
    <article>
      {/* Article Header */}
      <div className="container-narrow pt-12 pb-8">
        <button
          onClick={() => navigate({ name: 'home' })}
          className="inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors mb-8"
        >
          <ArrowLeft size={14} strokeWidth={1.5} /> Back to Magazine
        </button>

        {post.category && (
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-5">{post.category.name}</p>
        )}

        <h1 className="font-serif text-3xl md:text-5xl lg:text-6xl text-charcoal font-light leading-[1.05] text-balance">
          {post.title}
        </h1>

        {post.excerpt && (
          <p className="text-charcoal-muted text-lg md:text-xl leading-relaxed mt-6 font-light italic">
            {post.excerpt}
          </p>
        )}

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-4 mt-8 pb-8 border-b border-taupe/50">
          {post.author && (
            <div className="flex items-center gap-3">
              {post.author.avatar_url && (
                <img src={post.author.avatar_url} alt={post.author.name} className="w-10 h-10 rounded-full object-cover" />
              )}
              <div>
                <p className="text-sm text-charcoal font-medium">{post.author.name}</p>
                {post.author.role && <p className="text-xs text-charcoal-muted">{post.author.role}</p>}
              </div>
            </div>
          )}
          <div className="flex items-center gap-4 text-xs text-charcoal-muted ml-auto">
            <span className="flex items-center gap-1.5"><Calendar size={12} strokeWidth={1.5} /> {new Date(post.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
            <span className="text-taupe-dark">·</span>
            <span className="flex items-center gap-1.5"><Clock size={12} strokeWidth={1.5} /> {post.reading_time_minutes} min read</span>
          </div>
        </div>
      </div>

      {/* Leaderboard Ad Placeholder */}
      <div className="container-narrow mb-10">
        <div className="h-24 md:h-28 border border-taupe/40 bg-taupe-light/30 flex items-center justify-center rounded-sm">
          <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted/50">Advertisement</span>
        </div>
      </div>

      {/* Cover Image */}
      {post.cover_image && (
        <div className="container-wide mb-12">
          <div className="img-zoom rounded-sm overflow-hidden luxury-shadow-lg aspect-[16/9] lg:aspect-[2/1]">
            <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover" />
          </div>
        </div>
      )}

      {/* Article Body + Social Share */}
      <div className="container-narrow relative">
        <div className="flex gap-8 lg:gap-12">
          {/* Sticky Social Share */}
          <div className="hidden lg:flex flex-col items-center gap-3 sticky top-32 self-start">
            <p className="text-[9px] tracking-editorial uppercase text-charcoal-muted/50 [writing-mode:vertical-lr] rotate-180 mb-2">Share</p>
            <a
              href={`https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(articleUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all duration-300"
              aria-label="Share on Twitter"
            >
              <Twitter size={14} strokeWidth={1.5} />
            </a>
            <button
              onClick={copyLink}
              className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all duration-300"
              aria-label="Copy link"
            >
              {copied ? <Check size={14} strokeWidth={1.5} /> : <Link2 size={14} strokeWidth={1.5} />}
            </button>
            <button
              onClick={() => window.print()}
              className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all duration-300"
              aria-label="Print"
            >
              <Printer size={14} strokeWidth={1.5} />
            </button>
            <div className="w-[1px] h-12 bg-taupe mt-2" />
            <button className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal-muted hover:text-bronze transition-all duration-300" aria-label="Bookmark">
              <Bookmark size={14} strokeWidth={1.5} />
            </button>
          </div>

          {/* Content */}
          <div
            className="article-prose flex-1 max-w-none"
            dangerouslySetInnerHTML={{ __html: renderContent(post.content) || '' }}
          />
        </div>

        {/* Mobile Share Bar */}
        <div className="flex lg:hidden items-center gap-3 mt-10 pt-8 border-t border-taupe/50">
          <a
            href={`https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(articleUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal"
          >
            <Twitter size={14} strokeWidth={1.5} />
          </a>
          <button onClick={copyLink} className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal">
            {copied ? <Check size={14} strokeWidth={1.5} /> : <Link2 size={14} strokeWidth={1.5} />}
          </button>
          <a
            href={`https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(articleUrl)}&media=${encodeURIComponent(post.cover_image || '')}&description=${shareText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto px-5 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all"
          >
            Pin It
          </a>
        </div>

        {/* Pinterest Pin Save Box */}
        {post.cover_image && (
          <div className="mt-12 bg-taupe-light/50 rounded-sm p-8 border border-taupe/30">
            <div className="flex flex-col md:flex-row gap-6 items-center">
              <img src={post.cover_image} alt={post.title} className="w-full md:w-48 h-32 object-cover rounded-sm" />
              <div className="flex-1 text-center md:text-left">
                <p className="text-[10px] tracking-editorial uppercase text-bronze mb-2">Pin This Article</p>
                <h4 className="font-serif text-xl text-charcoal leading-snug">Save this for later</h4>
                <p className="text-charcoal-muted text-sm mt-2">Pin this article to your skincare or wellness board on Pinterest.</p>
              </div>
              <a
                href={`https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(articleUrl)}&media=${encodeURIComponent(post.cover_image)}&description=${shareText}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 px-6 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all duration-500"
              >
                Save to Pinterest
              </a>
            </div>
          </div>
        )}

        {/* In-Article Banner Ad */}
        <div className="my-12 h-24 md:h-28 border border-taupe/40 bg-taupe-light/30 flex items-center justify-center rounded-sm">
          <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted/50">Advertisement</span>
        </div>

        {/* Author Bio */}
        {post.author && (
          <div className="mt-12 pt-10 border-t border-taupe/50">
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              {post.author.avatar_url && (
                <img src={post.author.avatar_url} alt={post.author.name} className="w-16 h-16 rounded-full object-cover" />
              )}
              <div>
                <p className="text-[10px] tracking-editorial uppercase text-bronze mb-1">Written By</p>
                <h4 className="font-serif text-xl text-charcoal">{post.author.name}</h4>
                {post.author.role && <p className="text-sm text-charcoal-muted mt-0.5">{post.author.role}</p>}
                {post.author.bio && <p className="text-charcoal-muted text-sm mt-3 leading-relaxed max-w-lg">{post.author.bio}</p>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Continue Reading */}
      {recommendedList.length > 0 && (
        <section className="container-wide py-20 mt-10 border-t border-taupe/30">
          <div className="flex items-center gap-4 mb-10">
            <h3 className="font-serif text-2xl md:text-3xl font-light text-charcoal">Continue Reading</h3>
            <div className="flex-1 h-[1px] bg-taupe" />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {recommendedList.map(post => (
              <button
                key={post.id}
                onClick={() => navigate({ name: 'article', slug: post.slug })}
                className="group text-left"
              >
                <div className="img-zoom rounded-sm overflow-hidden aspect-[4/5] mb-4">
                  {post.cover_image && <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover" loading="lazy" />}
                </div>
                <span className="text-[10px] tracking-editorial uppercase text-bronze">{post.category?.name}</span>
                <h4 className="font-serif text-lg text-charcoal mt-1.5 leading-snug group-hover:text-bronze transition-colors line-clamp-2">{post.title}</h4>
                <p className="text-xs text-charcoal-muted mt-2 flex items-center gap-1.5"><Clock size={10} strokeWidth={1.5} /> {post.reading_time_minutes} min read</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
