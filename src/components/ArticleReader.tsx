import { displayImageUrl } from '../lib/images';
import {useEffect, useState, useMemo, useRef} from 'react';
import { Clock, Calendar, ArrowLeft, Twitter, Link2, Check, Printer, List, Sparkles, Facebook, Linkedin, Share2, Bookmark, Moon, Sun, Hash } from 'lucide-react';
import { Link } from '../context/NavigationContext';
import { usePostBySlug, usePosts } from '../hooks/useSupabase';
import { useRelatedPosts } from '../hooks/useSearch';
import QueryStatusNotice from './QueryStatusNotice';
import { HeroSkeleton } from './Skeletons';
import EmptyState from './EmptyState';
import Comments from './Comments';
import ArticleReactions from './ArticleReactions';
import ArticlePollComponent from './ArticlePoll';
import ShopThisArticle from './ShopThisArticle';
import TextToSpeech from './TextToSpeech';
import { FontSizeControl, useFontSize } from './FontSizeControl';
import LiveReaderCount from './LiveReaderCount';
import ReadingStreakBadge from './ReadingStreakBadge';
import ArticleRating from './ArticleRating';
import ReadingListButton from './ReadingListButton';
import EmailArticleButton from './EmailArticleButton';
import RandomArticleButton from './RandomArticleButton';
import { trackSocialShare } from '../hooks/usePlatform';
import { trackArticleView } from '../hooks/useCommerce';
import { getFingerprint, recordReadingHistory, useReadingStreak } from '../hooks/useFeatures';
import { useReadingProgressTracker } from '../hooks/usePersonalisation';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { Helmet } from 'react-helmet-async';
import type { PostWithRelations } from '../lib/types';
import { renderMarkdown } from '../lib/markdown';
import { normalizeImageUrl } from '../lib/images';
import SmartImage from './SmartImage';
import { useGlossary } from '../hooks/useGlossary';
import { useNavigation } from '../context/NavigationContext';
import { useCloudBookmarks, pickHeadline, trackHeadline, useSiteSettings } from '../hooks/useV3';
import KeyTakeaways from './article/KeyTakeaways';
import SeriesNav from './article/SeriesNav';
import AskEditor from './article/AskEditor';
import ShareQuote from './article/ShareQuote';
import ArticleFaq from './article/ArticleFaq';

export default function ArticleReader({ slug }: { slug: string }) {
  const { post, loading, error, retry } = usePostBySlug(slug);
  const { posts } = usePosts();
  const { glossary } = useGlossary();
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeHeading, setActiveHeading] = useState('');
  const [bookmarked, setBookmarked] = useState(false);
  const proseRef = useRef<HTMLDivElement>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const { theme, toggleTheme } = useTheme();
  const { showToast } = useToast();
  const { fontSize, setFontSize } = useFontSize();
  const { recordReadingDay } = useReadingStreak();
  const { navigate } = useNavigation();
  const { toggle: toggleCloudBookmark } = useCloudBookmarks();
  const flags = (useSiteSettings().features || {}) as Record<string, boolean>;
  useReadingProgressTracker(post?.id ?? null, progress);

  // "Continue reading": restore the last scroll position for this article (kept for 7 days)
  useEffect(() => {
    if (loading || !post) return;
    let y = 0;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`resume_${post.id}`) || localStorage.getItem(`resume_${post.id}`) || 'null');
      if (saved && Date.now() - saved.t < 7 * 864e5 && saved.y > 400) y = saved.y;
    } catch { /* ignore */ }
    window.scrollTo(0, 0);
    if (y) {
      const id = window.setTimeout(() => { window.scrollTo({ top: y, behavior: 'smooth' }); showToast('Resumed where you left off', 'info'); }, 350);
      return () => window.clearTimeout(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id, loading]);

  useEffect(() => {
    if (!post) return;
    const save = () => {
      const y = window.scrollY;
      const doc = document.documentElement;
      const done = y + window.innerHeight >= doc.scrollHeight - 200;
      try {
        if (done) { localStorage.removeItem(`resume_${post.id}`); }
        else localStorage.setItem(`resume_${post.id}`, JSON.stringify({ y, t: Date.now() }));
      } catch { /* quota */ }
    };
    const t = window.setInterval(save, 4000);
    window.addEventListener('beforeunload', save);
    return () => { window.clearInterval(t); window.removeEventListener('beforeunload', save); save(); };
  }, [post]);

  useEffect(() => {
    if (post) {
      trackArticleView(post.id, getFingerprint());
      setBookmarked(localStorage.getItem(`bookmark_${post.id}`) === '1');
      recordReadingHistory({
        id: post.id,
        title: post.title,
        slug: post.slug,
        category_id: post.category_id,
        tags: post.tags,
        cover_image: normalizeImageUrl(post.cover_image),
      });
      recordReadingDay(post.id);
      setTimeRemaining(post.reading_time_minutes);
      const hl = pickHeadline(post);
      if (post.alt_title) trackHeadline(post.id, hl.variant, 'click');
    }
  }, [post, recordReadingDay]);

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

  useEffect(() => {
    if (!post || timeRemaining === null) return;
    const onScroll = () => {
      const article = document.querySelector('article');
      if (!article) return;
      const rect = article.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const scrolled = Math.max(0, -rect.top);
      const pct = Math.min(1, Math.max(0, scrolled / total));
      setTimeRemaining(Math.max(0, Math.ceil(post.reading_time_minutes * (1 - pct))));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [post, timeRemaining === null]);

  const headings = useMemo(() => {
    if (!post?.content) return [];
    return post.content.split('\n')
      .filter(l => l.trim().startsWith('## '))
      .map(l => {
        const text = l.trim().slice(3);
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        return { id, text };
      });
  }, [post]);

  useEffect(() => {
    if (!post) return;
    const onKey = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === 'b') { document.getElementById('bookmark-btn')?.click(); return; }
      const idx = posts.findIndex(p => p.id === post.id);
      if (idx === -1) return;
      const target = key === 'j' ? posts[idx + 1] : key === 'k' ? posts[idx - 1] : null;
      if (target) navigate({ name: 'article', slug: target.slug });
    };
    window.addEventListener('lixxon:key', onKey);
    return () => window.removeEventListener('lixxon:key', onKey);
  }, [post, posts, navigate]);

  // Related articles come from SQL (shared tags + category + people who read both).
  // If the function is unavailable or returns too little, the in-memory scorer
  // that shipped before Batch 2 keeps the rail alive.
  const { posts: related } = useRelatedPosts(post?.id ?? null, 4);
  const recommended = useMemo(() => {
    if (!post) return [];
    if (related.length >= 2) {
      return related.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        cover_image: row.cover_image,
        category: row.category_name ? { name: row.category_name } : null,
        reading_time_minutes: row.reading_time_minutes ?? 5,
        reason: row.reason as string | undefined,
      }));
    }
    return getRecommended(post, posts, 4).map((row) => ({ ...row, reason: undefined as string | undefined }));
  }, [post, posts, related]);

  if (loading) return <HeroSkeleton />;
  if (error) {
    return (
      <main>
        <QueryStatusNotice
          loading={false}
          hasData={false}
          error={error}
          onRetry={retry}
          unavailableTitle="Article unavailable"
          errorMessage="We couldn’t load this article right now."
        />
      </main>
    );
  }
  if (!post) return <EmptyState message="Article not found" />;

  const articleUrl = `${window.location.origin}/blog/${post.slug}`;
  const shareText = encodeURIComponent(post.title);
  const shareUrl = encodeURIComponent(articleUrl);

  const copyLink = () => {
    navigator.clipboard.writeText(articleUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const nativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, url: articleUrl, text: post.excerpt || '' });
        trackSocialShare(post.id, 'native');
      } catch { /* user cancelled */ }
    } else {
      copyLink();
    }
  };

  const pinterestUrl = `https://www.pinterest.com/pin/create/button/?url=${shareUrl}&media=${encodeURIComponent(normalizeImageUrl(post.cover_image) || '')}&description=${shareText}`;

  const toggleBookmark = () => {
    if (!post) return;
    const key = `bookmark_${post.id}`;
    const isBookmarked = localStorage.getItem(key) === '1';
    if (isBookmarked) {
      localStorage.removeItem(key);
      const saved = JSON.parse(localStorage.getItem('lixxon_bookmarks') || '[]').filter((s: { id: string }) => s.id !== post.id);
      localStorage.setItem('lixxon_bookmarks', JSON.stringify(saved));
      toggleCloudBookmark(post.id, false);
      setBookmarked(false);
    } else {
      toggleCloudBookmark(post.id, true);
      localStorage.setItem(key, '1');
      const saved = JSON.parse(localStorage.getItem('lixxon_bookmarks') || '[]');
      if (!saved.find((s: { id: string }) => s.id === post.id)) {
        saved.push({ id: post.id, title: post.title, slug: post.slug, saved_at: Date.now() });
        localStorage.setItem('lixxon_bookmarks', JSON.stringify(saved));
      }
      setBookmarked(true);
      showToast('Article saved to bookmarks', 'success');
    }
  };

  const renderContent = (content: string | null) => renderMarkdown(content, { glossary });

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
        <meta property="og:image" content={normalizeImageUrl(post.cover_image) || `${window.location.origin}/api/og?slug=${encodeURIComponent(post.slug)}`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={post.title} />
        <meta name="twitter:description" content={post.excerpt || ''} />
        <meta name="twitter:image" content={normalizeImageUrl(post.cover_image) || `${window.location.origin}/api/og?slug=${encodeURIComponent(post.slug)}`} />
        {post.tags && post.tags.length > 0 && (
          <meta name="article:tag" content={post.tags.join(', ')} />
        )}
        <meta property="article:published_time" content={post.published_at} />
        <meta property="article:author" content={post.author?.name || 'Lixxon Studio'} />
        <meta property="article:section" content={post.category?.name || ''} />
        <script type="application/ld+json">{JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: post.title,
          description: post.excerpt,
          image: normalizeImageUrl(post.cover_image),
          datePublished: post.published_at,
          author: { '@type': 'Organization', name: post.author?.name || 'Lixxon Studio' },
          publisher: { '@type': 'Organization', name: 'Lixxon Studio', logo: { '@type': 'ImageObject', url: `${window.location.origin}/icon-512.png` } },
          mainEntityOfPage: articleUrl,
          dateModified: post.updated_at,
          wordCount: post.content ? post.content.split(/\s+/).length : undefined,
        })}</script>
        <script type="application/ld+json">{JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: window.location.origin },
            ...(post.category ? [{ '@type': 'ListItem', position: 2, name: post.category.name, item: `${window.location.origin}/category/${post.category.slug}` }] : []),
            { '@type': 'ListItem', position: post.category ? 3 : 2, name: post.title, item: articleUrl },
          ],
        })}</script>
        {post.faq && post.faq.length > 0 && (
          <script type="application/ld+json">{JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: post.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
          })}</script>
        )}
      </Helmet>
      <ShareQuote postId={post.id} title={post.title} url={articleUrl} />

      {/* Reading Progress Bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-taupe/20">
        <div className="h-full bg-bronze transition-all duration-100" style={{ width: `${progress}%` }} />
      </div>

      {/* Article Header */}
      <div className="container-narrow pt-12 pb-8">
        <Link to={{ name: 'home', page: 1 }} className="inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors mb-8">
          <ArrowLeft size={14} strokeWidth={1.5} /> Back to Magazine
        </Link>

        {post.category && (
          <Link to={{ name: 'category', slug: post.category.slug, page: 1 }} className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-5 inline-block hover:underline">
            {post.category.name}
          </Link>
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
            <Link to={{ name: 'author', slug: post.author.slug }} className="flex items-center gap-3 group">
              {post.author.avatar_url && (
                <img src={displayImageUrl(post.author.avatar_url)} alt={post.author.name} className="w-10 h-10 rounded-full object-cover" loading="lazy" />
              )}
              <div>
                <p className="text-sm text-charcoal font-medium group-hover:text-bronze transition-colors">{post.author.name}</p>
                {post.author.role && <p className="text-xs text-charcoal-muted">{post.author.role}</p>}
              </div>
            </Link>
          )}
          <div className="flex items-center gap-4 text-xs text-charcoal-muted ml-auto">
            <span className="flex items-center gap-1.5"><Calendar size={12} strokeWidth={1.5} /> {new Date(post.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
            <span className="text-taupe-dark">·</span>
            <span className="flex items-center gap-1.5"><Clock size={12} strokeWidth={1.5} /> {post.reading_time_minutes} min read</span>
            {timeRemaining !== null && timeRemaining > 0 && timeRemaining < post.reading_time_minutes && (
              <span className="text-bronze text-xs hidden sm:inline">{timeRemaining} min left</span>
            )}
            <ReadingStreakBadge />
            <LiveReaderCount postId={post.id} />
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-full flex items-center justify-center text-charcoal-muted hover:text-bronze transition-colors"
              aria-label="Toggle dark mode"
            >
              {theme === 'light' ? <Moon size={14} strokeWidth={1.5} /> : <Sun size={14} strokeWidth={1.5} />}
            </button>
          </div>
        </div>
      </div>

      {/* Cover Image with Pinterest Save */}
      {post.cover_image && (
        <div className="container-wide mb-12">
          <div className="rounded-sm overflow-hidden luxury-shadow-lg aspect-[16/9] lg:aspect-[2/1] relative group">
            <SmartImage src={post.cover_image} alt={post.title} className="w-full h-full object-cover" sizes="100vw" aspectRatio="16/9" priority />
            <a
              href={pinterestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute top-4 right-4 bg-white text-charcoal px-4 py-2 rounded-sm text-xs font-medium flex items-center gap-2 luxury-shadow transition-all duration-300 hover-reveal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12c0 5 3 9.4 7.4 11.3-.1-.9-.2-2.4 0-3.4.2-.9 1.3-5.7 1.3-5.7s-.3-.7-.3-1.6c0-1.5.9-2.7 2-2.7.9 0 1.4.7 1.4 1.5 0 .9-.6 2.3-.9 3.6-.3 1.1.5 2 1.6 2 1.9 0 3.4-2 3.4-5 0-2.6-1.9-4.4-4.5-4.4-3.1 0-4.9 2.3-4.9 4.7 0 .9.4 1.9.8 2.5.1.1.1.2 0 .3l-.3 1.1c0 .2-.2.2-.3.1-1.2-.5-1.9-2.2-1.9-3.6 0-2.9 2.1-5.6 6.2-5.6 3.2 0 5.8 2.3 5.8 5.4 0 3.2-2 5.8-4.8 5.8-1 0-1.9-.5-2.2-1.1l-.6 2.3c-.2.9-.8 2-1.2 2.6C9.5 23.8 10.7 24 12 24c6.6 0 12-5.4 12-12S18.6 0 12 0z"/></svg>
              Save
            </a>
          </div>
        </div>
      )}

      {/* Article Body + Sidebar */}
      <div className="container-wide relative">
        <div className="flex gap-8 lg:gap-16 max-w-4xl mx-auto">
          {/* Sticky Social Share */}
          <div className="hidden lg:flex flex-col items-center gap-3 sticky top-32 self-start flex-shrink-0">
            <p className="text-[9px] tracking-editorial uppercase text-charcoal-muted/50 [writing-mode:vertical-lr] rotate-180 mb-2">Share</p>
            <a href={`https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`} target="_blank" rel="noopener noreferrer" onClick={() => trackSocialShare(post.id, 'twitter')} className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all duration-300" aria-label="Share on X">
              <Twitter size={14} strokeWidth={1.5} />
            </a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`} target="_blank" rel="noopener noreferrer" onClick={() => trackSocialShare(post.id, 'facebook')} className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all duration-300" aria-label="Share on Facebook">
              <Facebook size={14} strokeWidth={1.5} />
            </a>
            <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`} target="_blank" rel="noopener noreferrer" onClick={() => trackSocialShare(post.id, 'linkedin')} className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all duration-300" aria-label="Share on LinkedIn">
              <Linkedin size={14} strokeWidth={1.5} />
            </a>
            <button onClick={copyLink} className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all duration-300" aria-label="Copy link">
              {copied ? <Check size={14} strokeWidth={1.5} /> : <Link2 size={14} strokeWidth={1.5} />}
            </button>
            <button onClick={() => window.print()} className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal hover:bg-charcoal hover:text-white transition-all duration-300" aria-label="Print">
              <Printer size={14} strokeWidth={1.5} />
            </button>
            <div className="w-[1px] h-12 bg-taupe mt-2" />
            <button id="bookmark-btn" onClick={toggleBookmark} aria-pressed={bookmarked} className={`w-10 h-10 rounded-full border border-taupe flex items-center justify-center transition-all duration-300 ${bookmarked ? 'bg-bronze text-white border-bronze' : 'text-charcoal-muted hover:text-bronze'}`} aria-label="Bookmark article">
              <Bookmark size={14} strokeWidth={1.5} fill={bookmarked ? 'currentColor' : 'none'} />
            </button>
          </div>

          {/* Content + TOC */}
          <div className="flex-1 min-w-0">
            {/* TTS + Font Size controls */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <TextToSpeech postId={post.id} title={post.title} content={post.content} coverImage={post.cover_image} lang="en" containerRef={proseRef} />
              <FontSizeControl fontSize={fontSize} setFontSize={setFontSize} />
            </div>

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
                      className={`block text-sm leading-snug transition-colors duration-200 ${activeHeading === h.id ? 'text-bronze font-medium' : 'text-charcoal-muted hover:text-charcoal'}`}
                    >
                      {h.text}
                    </a>
                  ))}
                </nav>
              </div>
            )}

            <SeriesNav seriesId={post.series_id} currentPostId={post.id} />
            <KeyTakeaways items={post.takeaways} />
            <div ref={proseRef} className={`article-prose max-w-none font-${fontSize}`} dangerouslySetInnerHTML={{ __html: renderContent(post.content) }} />
            <ArticleFaq faq={post.faq} />
            <SeriesNav seriesId={post.series_id} currentPostId={post.id} variant="bottom" />

            {/* Article Poll */}
            <ArticlePollComponent postId={post.id} />

            {/* Reactions + Share bottom bar */}
            <div className="flex flex-wrap items-center gap-4 mt-12 pt-8 border-t border-taupe/50">
              <ArticleReactions postId={post.id} />
              <button onClick={nativeShare} className="inline-flex items-center gap-2 px-6 py-3 border border-taupe rounded-sm text-charcoal text-sm hover:border-bronze transition-all" aria-label="Share article">
                <Share2 size={16} strokeWidth={1.5} /> Share
              </button>
              <a href={pinterestUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackSocialShare(post.id, 'pinterest')} className="inline-flex items-center gap-2 px-6 py-3 border border-taupe rounded-sm text-charcoal text-sm hover:border-bronze transition-all">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12c0 5 3 9.4 7.4 11.3-.1-.9-.2-2.4 0-3.4.2-.9 1.3-5.7 1.3-5.7s-.3-.7-.3-1.6c0-1.5.9-2.7 2-2.7.9 0 1.4.7 1.4 1.5 0 .9-.6 2.3-.9 3.6-.3 1.1.5 2 1.6 2 1.9 0 3.4-2 3.4-5 0-2.6-1.9-4.4-4.5-4.4-3.1 0-4.9 2.3-4.9 4.7 0 .9.4 1.9.8 2.5.1.1.1.2 0 .3l-.3 1.1c0 .2-.2.2-.3.1-1.2-.5-1.9-2.2-1.9-3.6 0-2.9 2.1-5.6 6.2-5.6 3.2 0 5.8 2.3 5.8 5.4 0 3.2-2 5.8-4.8 5.8-1 0-1.9-.5-2.2-1.1l-.6 2.3c-.2.9-.8 2-1.2 2.6C9.5 23.8 10.7 24 12 24c6.6 0 12-5.4 12-12S18.6 0 12 0z"/></svg>
                Save to Pinterest
              </a>
              <ReadingListButton postId={post.id} />
              <EmailArticleButton title={post.title} url={articleUrl} />
              <RandomArticleButton />
            </div>

            {/* Article Rating */}
            <div className="mt-8">
              <ArticleRating postId={post.id} />
            </div>

            {/* Pinterest CTA */}
            <p className="text-charcoal-muted text-sm italic mt-6 leading-relaxed">
              If this was useful, save it to your Pinterest board so you can come back to it later.
            </p>
          </div>
        </div>

        {/* Mobile Share Bar */}
        <div className="container-narrow flex lg:hidden items-center gap-3 mt-10 pt-8 border-t border-taupe/50">
          <a href={`https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal" aria-label="Share on X">
            <Twitter size={14} strokeWidth={1.5} />
          </a>
          <a href={`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal" aria-label="Share on Facebook">
            <Facebook size={14} strokeWidth={1.5} />
          </a>
          <button onClick={copyLink} className="w-10 h-10 rounded-full border border-taupe flex items-center justify-center text-charcoal" aria-label="Copy link">
            {copied ? <Check size={14} strokeWidth={1.5} /> : <Link2 size={14} strokeWidth={1.5} />}
          </button>
          <button onClick={nativeShare} className="ml-auto px-5 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all" aria-label="Share">
            Share
          </button>
        </div>

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="container-narrow mt-10 pt-8 border-t border-taupe/50">
            <div className="flex flex-wrap gap-2">
              {post.tags.map(tag => (
                <Link key={tag} to={{ name: 'tag', tag, page: 1 }} className="inline-flex items-center gap-1 px-4 py-2 bg-taupe-light/60 text-charcoal-muted text-xs rounded-full border border-taupe/30 hover:border-bronze hover:text-bronze transition-all">
                  <Hash size={10} strokeWidth={1.5} />
                  {tag}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Author Bio */}
        {post.author && (
          <div className="container-narrow mt-12 pt-10 border-t border-taupe/50">
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              {post.author.avatar_url && (
                <img src={displayImageUrl(post.author.avatar_url)} alt={post.author.name} className="w-16 h-16 rounded-full object-cover" loading="lazy" />
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

        {/* Shop This Article */}
        <div className="container-narrow mt-12">
          <ShopThisArticle postId={post.id} />
        </div>

        {/* Reader Q&A */}
        {flags.qa !== false && (
          <div className="container-narrow">
            <AskEditor postId={post.id} />
          </div>
        )}

        {/* Comments */}
        {post.allow_comments !== false && flags.comments !== false && (
          <div className="container-narrow mt-12">
            <Comments postId={post.id} />
          </div>
        )}
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
                <Link
                  key={r.id}
                  to={{ name: 'article', slug: r.slug }}
                  className="group text-left bg-white rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500 flex flex-col"
                >
                  <div className="img-zoom aspect-[4/5] overflow-hidden">
                    {r.cover_image && <SmartImage src={r.cover_image} alt={r.title} className="w-full h-full object-cover" sizes="(max-width: 768px) 50vw, 20vw" aspectRatio="4/5" />}
                  </div>
                  <div className="p-5 flex flex-col flex-1">
                    <span className="text-[10px] tracking-editorial uppercase text-bronze">{r.category?.name}</span>
                    <h4 className="font-serif text-base text-charcoal mt-2 leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-2">{r.title}</h4>
                    {r.excerpt && (
                      <p className="text-charcoal-muted text-sm mt-2 leading-relaxed line-clamp-2 flex-1">{r.excerpt}</p>
                    )}
                    <div className="flex items-center gap-2 mt-4 text-xs text-charcoal-muted">
                      <Clock size={10} strokeWidth={1.5} /> {r.reading_time_minutes} min read
                      {r.reason === 'co-read' && <span className="text-bronze">· readers of this also read it</span>}
                    </div>
                  </div>
                </Link>
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
