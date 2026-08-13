import { useEffect, useState, useMemo } from 'react';
import { Clock, Calendar, ArrowLeft, Twitter, Link2, Check, Bookmark, Printer, List, Sparkles } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import { usePostBySlug, usePosts } from '../hooks/useSupabase';
import { HeroSkeleton } from './Skeletons';
import EmptyState from './EmptyState';
import Comments from './Comments';
import { Helmet } from 'react-helmet-async';
import type { PostWithRelations } from '../lib/types';

export default function ArticleReader({ slug }: { slug: string }) {
  const { navigate } = useNavigation();
  const { post, loading } = usePostBySlug(slug);
  const { posts } = usePosts();
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeHeading, setActiveHeading] = useState('');

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  useEffect(() => {
    const onScroll = () => {
      const article = document.querySelector('article');
      if (!article) return;
      const rect = article.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const scrolled = Math.max(0, -rect.top);
      setProgress(Math.min(100, (scrolled / total) * 100));

      const headings = document.querySelectorAll('.article-prose h2');
      let current = '';
      headings.forEach(h => {
        const r = h.getBoundingClientRect();
        if (r.top < 120) current = h.id;
      });
      setActiveHeading(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [post]);

  const headings = useMemo(() => {
    if (!post?.content) return [];
    const lines = post.content.split('\n');
    return lines
      .filter(l => l.trim().startsWith('## '))
      .map(l => {
        const text = l.trim().slice(3);
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        return { id, text };
      });
  }, [post]);

  const recommended = useMemo(() => {
    if (!post) return [];
    return getRecommended(post, posts, 4);
  }, [post, posts]);

  if (loading) return <HeroSkeleton />;
  if (!post) return <EmptyState message="Article not found" />;

  const articleUrl = `${window.location.origin}/blog/${post.slug}`;
  const shareText = encodeURIComponent(post.title);

  const copyLink = () => {
    navigator.clipboard.writeText(articleUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const renderContent = (content: string | null) => {
    if (!content) return '';
    const lines = content.split('\n');
    const html: string[] = [];
    let inUl = false;
    let inOl = false;

    const closeLists = () => {
      if (inUl) { html.push('</ul>'); inUl = false; }
      if (inOl) { html.push('</ol>'); inOl = false; }
    };

    const inline = (text: string): string => {
      return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { closeLists(); continue; }
      if (trimmed.startsWith('## ')) {
        closeLists();
        const heading = inline(trimmed.slice(3));
        const id = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        html.push(`<h2 id="${id}">${heading}</h2>`);
      } else if (trimmed.startsWith('### ')) {
        closeLists();
        html.push(`<h3>${inline(trimmed.slice(4))}</h3>`);
      } else if (trimmed.startsWith('> ')) {
        closeLists();
        html.push(`<blockquote>${inline(trimmed.slice(2))}</blockquote>`);
      } else if (/^\d+\.\s/.test(trimmed)) {
        if (inUl) { html.push('</ul>'); inUl = false; }
        if (!inOl) { html.push('<ol>'); inOl = true; }
        html.push(`<li>${inline(trimmed.replace(/^\d+\.\s/, ''))}</li>`);
      } else if (trimmed.startsWith('- ')) {
        if (inOl) { html.push('</ol>'); inOl = false; }
        if (!inUl) { html.push('<ul>'); inUl = true; }
        html.push(`<li>${inline(trimmed.slice(2))}</li>`);
      } else {
        closeLists();
        html.push(`<p>${inline(trimmed)}</p>`);
      }
    }
    closeLists();
    return html.join('');
  };

  return (
    <article>
      <Helmet>
        <title>{post.title} | Lixxon Studio</title>
        <meta name="description" content={post.excerpt || post.title} />
        <link rel="canonical" href={articleUrl} />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.excerpt || ''} />
        <meta property="og:url" content={articleUrl} />
        <meta property="og:type" content="article" />
        {post.cover_image && <meta property="og:image" content={post.cover_image} />}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={post.title} />
        <meta name="twitter:description" content={post.excerpt || ''} />
        {post.cover_image && <meta name="twitter:image" content={post.cover_image} />}
      </Helmet>

      {/* Reading Progress Bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-taupe/20">
        <div className="h-full bg-bronze transition-all duration-100" style={{ width: `${progress}%` }} />
      </div>

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

      {/* Cover Image */}
      {post.cover_image && (
        <div className="container-wide mb-12">
          <div className="rounded-sm overflow-hidden luxury-shadow-lg aspect-[16/9] lg:aspect-[2/1]">
            <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover" />
          </div>
        </div>
      )}

      {/* Article Body + Sidebar */}
      <div className="container-wide relative">
        <div className="flex gap-8 lg:gap-16 max-w-4xl mx-auto">
          {/* Sticky Social Share */}
          <div className="hidden lg:flex flex-col items-center gap-3 sticky top-32 self-start flex-shrink-0">
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

          {/* Content + TOC */}
          <div className="flex-1 min-w-0">
            {headings.length > 2 && (
              <div className="mb-10 p-6 bg-taupe-light/40 rounded-sm border border-taupe/30">
                <div className="flex items-center gap-2 mb-4">
                  <List size={14} strokeWidth={1.5} className="text-bronze" />
                  <p className="text-[10px] tracking-editorial uppercase text-bronze">Table of Contents</p>
                </div>
                <nav className="space-y-1.5">
                  {headings.map(h => (
                    <a
                      key={h.id}
                      href={`#${h.id}`}
                      className={`block text-sm leading-snug transition-colors duration-200 ${
                        activeHeading === h.id ? 'text-bronze font-medium' : 'text-charcoal-muted hover:text-charcoal'
                      }`}
                    >
                      {h.text}
                    </a>
                  ))}
                </nav>
              </div>
            )}

            <div className="article-prose max-w-none" dangerouslySetInnerHTML={{ __html: renderContent(post.content) }} />
          </div>
        </div>

        {/* Mobile Share Bar */}
        <div className="container-narrow flex lg:hidden items-center gap-3 mt-10 pt-8 border-t border-taupe/50">
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

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="container-narrow mt-10 pt-8 border-t border-taupe/50">
            <div className="flex flex-wrap gap-2">
              {post.tags.map(tag => (
                <span key={tag} className="px-4 py-2 bg-taupe-light/60 text-charcoal-muted text-xs rounded-full border border-taupe/30">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Author Bio */}
        {post.author && (
          <div className="container-narrow mt-12 pt-10 border-t border-taupe/50">
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

        {/* Comments */}
        <div className="container-narrow mt-12">
          <Comments postId={post.id} />
        </div>
      </div>

      {/* Continue Reading - Premium Related Articles */}
      {recommended.length > 0 && (
        <section className="bg-taupe-light/40 py-20 mt-12 border-t border-taupe/30">
          <div className="container-wide">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 mb-3">
                <Sparkles size={16} strokeWidth={1.5} className="text-bronze" />
                <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Keep Reading</p>
              </div>
              <h3 className="font-serif text-3xl md:text-4xl font-light text-charcoal">Stories You Might Love</h3>
              <p className="text-charcoal-muted text-sm mt-3 max-w-md mx-auto">Hand-picked based on what you are reading now.</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
              {recommended.map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate({ name: 'article', slug: r.slug })}
                  className="group text-left bg-white rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500 flex flex-col"
                >
                  <div className="img-zoom aspect-[4/5] overflow-hidden">
                    {r.cover_image && <img src={r.cover_image} alt={r.title} className="w-full h-full object-cover" loading="lazy" />}
                  </div>
                  <div className="p-5 flex flex-col flex-1">
                    <span className="text-[10px] tracking-editorial uppercase text-bronze">{r.category?.name}</span>
                    <h4 className="font-serif text-base text-charcoal mt-2 leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-2">{r.title}</h4>
                    {r.excerpt && (
                      <p className="text-charcoal-muted text-sm mt-2 leading-relaxed line-clamp-2 flex-1">{r.excerpt}</p>
                    )}
                    <div className="flex items-center gap-2 mt-4 text-xs text-charcoal-muted">
                      <Clock size={10} strokeWidth={1.5} /> {r.reading_time_minutes} min read
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}
    </article>
  );
}

function getRecommended(current: PostWithRelations, all: PostWithRelations[], count: number): PostWithRelations[] {
  const currentTags = new Set(current.tags || []);
  const scored = all
    .filter(p => p.id !== current.id)
    .map(p => {
      let score = 0;
      if (p.category_id === current.category_id) score += 10;
      const sharedTags = (p.tags || []).filter(t => currentTags.has(t)).length;
      score += sharedTags * 5;
      if (p.featured) score += 2;
      if (p.editors_pick) score += 2;
      score += Math.max(0, 3 - Math.abs(new Date(p.published_at).getTime() - new Date(current.published_at).getTime()) / (1000 * 60 * 60 * 24 * 30));
      return { post: p, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map(s => s.post);
}
