import { useState, useMemo } from 'react';
import {
  Flame, Share2, ArrowRight, Clock, Sparkles, MessageCircle,
  BookOpen, AlertCircle, Check, Search, Bookmark, ChevronRight
} from 'lucide-react';
import { useNavigation } from '../../context/NavigationContext';
import { useToast } from '../../context/ToastContext';
import { useTrending } from '../../hooks/useTrending';
import SmartImage from '../SmartImage';
import type { TrendingItem, TrendingCategory, TrendingItemType } from '../../types/trending';

const CATEGORIES: { label: string; value: TrendingCategory }[] = [
  { label: 'All Categories', value: 'all' },
  { label: 'Skincare', value: 'skincare' },
  { label: 'Fashion', value: 'fashion' },
  { label: 'Wellness', value: 'wellness' },
  { label: 'Others', value: 'others' },
];

type FormatFilter = 'all' | 'articles' | 'debates' | 'products' | 'science';

export default function TrendingPage() {
  const { navigate } = useNavigation();
  const { showToast } = useToast();

  const getCategoryFromUrl = (): TrendingCategory => {
    if (typeof window === 'undefined') return 'all';
    const params = new URLSearchParams(window.location.search);
    const cat = params.get('category')?.toLowerCase();
    if (cat === 'skincare' || cat === 'fashion' || cat === 'wellness' || cat === 'others') {
      return cat;
    }
    return 'all';
  };

  const [activeCategory, setActiveCategory] = useState<TrendingCategory>(getCategoryFromUrl);
  const [activeFormat, setActiveFormat] = useState<FormatFilter>('articles');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bookmarkedSlugs, setBookmarkedSlugs] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('lixxon_bookmarks') || '[]');
      return new Set(stored.map((b: { slug: string }) => b.slug));
    } catch {
      return new Set();
    }
  });

  const {
    items,
    articles,
    spotlights,
    heroArticle,
    loading,
    error,
    upvote,
    recordClick,
    recordView,
  } = useTrending(activeCategory);

  const handleCategoryChange = (cat: TrendingCategory) => {
    setActiveCategory(cat);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (cat === 'all') {
        url.searchParams.delete('category');
      } else {
        url.searchParams.set('category', cat);
      }
      window.history.replaceState({}, '', url.toString());
    }
  };

  // Filter items by format & search query
  const displayedItems = useMemo(() => {
    let baseList = items;
    if (activeFormat === 'articles') {
      baseList = articles;
    } else if (activeFormat === 'debates') {
      baseList = items.filter(i => i.item_type === 'debate' || i.item_type === 'update');
    } else if (activeFormat === 'products') {
      baseList = items.filter(i => i.item_type === 'product');
    } else if (activeFormat === 'science') {
      baseList = items.filter(i => i.item_type === 'ingredient');
    }

    if (!searchQuery.trim()) return baseList;
    const q = searchQuery.toLowerCase();
    return baseList.filter(
      item =>
        item.title.toLowerCase().includes(q) ||
        item.excerpt.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.metadata?.author_name && item.metadata.author_name.toLowerCase().includes(q))
    );
  }, [items, articles, activeFormat, searchQuery]);

  // Exclude the hero article from the subsequent list if on "articles" or "all" to prevent duplicate lead
  const listItems = useMemo(() => {
    if (!heroArticle || searchQuery.trim() || activeFormat === 'debates' || activeFormat === 'products' || activeFormat === 'science') {
      return displayedItems;
    }
    return displayedItems.filter(item => item.id !== heroArticle.id);
  }, [displayedItems, heroArticle, searchQuery, activeFormat]);

  const handleCopyLink = async (item: TrendingItem) => {
    try {
      const url = item.item_type === 'article' && item.metadata?.post_slug
        ? `${window.location.origin}/article/${item.metadata.post_slug}`
        : `${window.location.origin}/trending#${item.slug}`;

      if (navigator.share) {
        try {
          await navigator.share({ title: item.title, text: item.excerpt, url });
          return;
        } catch {
          // fall through to clipboard
        }
      }
      await navigator.clipboard.writeText(url);
      setCopiedId(item.id);
      showToast('Article link copied to clipboard', 'success');
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      showToast('Could not copy link', 'error');
    }
  };

  const handleToggleBookmark = (item: TrendingItem) => {
    const slug = item.metadata?.post_slug || item.slug;
    const id = item.metadata?.post_id || item.id;
    const isSaved = bookmarkedSlugs.has(slug);

    try {
      const stored = JSON.parse(localStorage.getItem('lixxon_bookmarks') || '[]');
      let updated;
      if (isSaved) {
        updated = stored.filter((b: { slug: string }) => b.slug !== slug);
        localStorage.removeItem(`bookmark_${id}`);
        showToast('Removed from saved bookmarks', 'info');
      } else {
        updated = [{ id, title: item.title, slug, saved_at: Date.now() }, ...stored];
        localStorage.setItem(`bookmark_${id}`, 'true');
        showToast('Saved to your reading list', 'success');
      }
      localStorage.setItem('lixxon_bookmarks', JSON.stringify(updated));
      setBookmarkedSlugs(new Set(updated.map((b: { slug: string }) => b.slug)));
    } catch {
      showToast('Could not update bookmarks', 'error');
    }
  };

  const handleUpvote = async (item: TrendingItem) => {
    const res = await upvote(item.id);
    if (res.alreadyVoted) {
      showToast('You already upvoted this story', 'info');
    } else {
      showToast('Story upvoted! Thank you for curating.', 'success');
    }
  };

  const handleOpenArticle = (item: TrendingItem) => {
    recordClick(item.id);
    const targetSlug = item.metadata?.post_slug || (item.item_type === 'article' ? item.slug : null);
    if (targetSlug) {
      navigate({ name: 'article', slug: targetSlug });
      return;
    }
    if (item.destination_url) {
      if (item.destination_url.startsWith('http')) {
        window.open(item.destination_url, '_blank', 'noopener,noreferrer');
      } else if (item.destination_url.startsWith('/article/')) {
        const slug = item.destination_url.replace('/article/', '');
        navigate({ name: 'article', slug });
      } else if (item.destination_url === '/shop') {
        navigate({ name: 'shop' });
      } else {
        window.location.href = item.destination_url;
      }
    }
  };

  return (
    <div className="bg-[#FAF8F5] dark:bg-[#0E0E0E] min-h-screen py-10 md:py-16 text-[#2B2B2B] dark:text-[#E8E2D9] transition-colors duration-300">
      {/* Header & Sub-Navigation */}
      <div className="container-wide max-w-6xl mx-auto px-4 sm:px-6 mb-10">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-[#9C6647]/10 dark:bg-bronze/20 text-[#9C6647] dark:text-bronze-light rounded-full text-xs font-medium tracking-editorial uppercase mb-4">
            <Flame size={14} className="animate-pulse" />
            <span>Editorial Cultural Radar</span>
          </div>
          <h1 className="font-serif text-3xl sm:text-5xl md:text-6xl font-light text-[#1F1F1F] dark:text-white mb-4 tracking-tight">
            The Trending Index
          </h1>
          <p className="text-sm sm:text-base text-[#666666] dark:text-gray-400 leading-relaxed">
            The most widely read editorial deep dives, cultural discussions, and verified industry updates across Lixxon Studio.
          </p>
        </div>

        {/* Format Switcher Tabs */}
        <div className="mt-8 flex items-center justify-center gap-1 sm:gap-2 border-b border-[#E8E2D9] dark:border-white/10 pb-4 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveFormat('articles')}
            className={`px-4 py-2 text-xs uppercase tracking-editorial font-medium rounded-full transition-all duration-300 flex items-center gap-1.5 ${
              activeFormat === 'articles'
                ? 'bg-[#1F1F1F] dark:bg-bronze text-white shadow-sm'
                : 'text-[#666666] dark:text-gray-300 hover:text-[#1F1F1F] dark:hover:text-white hover:bg-white dark:hover:bg-white/10'
            }`}
          >
            <BookOpen size={13} />
            <span>Trending Articles</span>
            <span className="text-[10px] opacity-70">({articles.length})</span>
          </button>
          <button
            onClick={() => setActiveFormat('all')}
            className={`px-4 py-2 text-xs uppercase tracking-editorial font-medium rounded-full transition-all duration-300 ${
              activeFormat === 'all'
                ? 'bg-[#1F1F1F] dark:bg-bronze text-white shadow-sm'
                : 'text-[#666666] dark:text-gray-300 hover:text-[#1F1F1F] dark:hover:text-white hover:bg-white dark:hover:bg-white/10'
            }`}
          >
            All Trending
          </button>
          <button
            onClick={() => setActiveFormat('debates')}
            className={`px-4 py-2 text-xs uppercase tracking-editorial font-medium rounded-full transition-all duration-300 flex items-center gap-1.5 ${
              activeFormat === 'debates'
                ? 'bg-[#1F1F1F] dark:bg-bronze text-white shadow-sm'
                : 'text-[#666666] dark:text-gray-300 hover:text-[#1F1F1F] dark:hover:text-white hover:bg-white dark:hover:bg-white/10'
            }`}
          >
            <MessageCircle size={13} />
            <span>Debates &amp; Wire</span>
          </button>
          <button
            onClick={() => setActiveFormat('products')}
            className={`px-4 py-2 text-xs uppercase tracking-editorial font-medium rounded-full transition-all duration-300 flex items-center gap-1.5 ${
              activeFormat === 'products'
                ? 'bg-[#1F1F1F] dark:bg-bronze text-white shadow-sm'
                : 'text-[#666666] dark:text-gray-300 hover:text-[#1F1F1F] dark:hover:text-white hover:bg-white dark:hover:bg-white/10'
            }`}
          >
            <Sparkles size={13} />
            <span>Product Radar</span>
          </button>
          <button
            onClick={() => setActiveFormat('science')}
            className={`px-4 py-2 text-xs uppercase tracking-editorial font-medium rounded-full transition-all duration-300 ${
              activeFormat === 'science'
                ? 'bg-[#1F1F1F] dark:bg-bronze text-white shadow-sm'
                : 'text-[#666666] dark:text-gray-300 hover:text-[#1F1F1F] dark:hover:text-white hover:bg-white dark:hover:bg-white/10'
            }`}
          >
            Science &amp; Clinical
          </button>
        </div>

        {/* Category Pills & Quick Search */}
        <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {CATEGORIES.map(cat => (
              <button
                key={cat.value}
                onClick={() => handleCategoryChange(cat.value)}
                className={`px-3.5 py-1.5 text-xs tracking-editorial uppercase font-medium rounded-full transition-all duration-300 ${
                  activeCategory === cat.value
                    ? 'bg-[#9C6647] text-white shadow-sm'
                    : 'bg-white dark:bg-[#1A1A1A] text-[#666666] dark:text-gray-300 hover:bg-[#EFEAE2] dark:hover:bg-white/10 hover:text-[#1F1F1F] dark:hover:text-white border border-[#E8E2D9] dark:border-white/15'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-72">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#999999] dark:text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search trending stories..."
              aria-label="Search trending stories"
              className="w-full bg-white dark:bg-[#161616] border border-[#E8E2D9] dark:border-white/15 pl-10 pr-4 py-2 text-xs rounded-full text-[#1F1F1F] dark:text-white placeholder:text-[#999999] dark:placeholder:text-gray-400 focus:outline-none focus:border-[#9C6647] dark:focus:border-bronze transition-colors shadow-sm"
            />
          </div>
        </div>
      </div>

      <div className="container-wide max-w-6xl mx-auto px-4 sm:px-6">
        {loading ? (
          <div className="space-y-8 animate-pulse">
            <div className="bg-white dark:bg-[#161616] border border-[#E8E2D9] dark:border-white/10 rounded-sm p-8 h-96" />
            <div className="grid md:grid-cols-2 gap-8">
              {[1, 2, 3, 4].map(n => (
                <div key={n} className="bg-white dark:bg-[#161616] border border-[#E8E2D9] dark:border-white/10 p-6 rounded-sm h-64" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="text-center py-16 bg-white dark:bg-[#161616] border border-[#E8E2D9] dark:border-white/10 rounded-sm p-8">
            <AlertCircle size={32} className="mx-auto text-amber-600 mb-3" />
            <p className="text-sm text-[#666666] dark:text-gray-300 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-[#1F1F1F] dark:bg-bronze text-white text-xs uppercase tracking-editorial rounded-sm hover:bg-[#9C6647] dark:hover:bg-bronze-dark transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* HERO ARTICLE: #01 Trending Story */}
            {heroArticle && !searchQuery.trim() && (activeFormat === 'articles' || activeFormat === 'all') && (
              <div className="mb-14">
                <div className="flex items-center gap-2 mb-4">
                  <Flame size={16} className="text-[#9C6647] dark:text-bronze-light" />
                  <span className="text-[11px] tracking-ultra-wide uppercase font-semibold text-[#9C6647] dark:text-bronze-light">
                    #01 Most Read Story Right Now
                  </span>
                  <div className="flex-1 h-[1px] bg-[#E8E2D9] dark:bg-white/10" />
                </div>

                <div className="bg-white dark:bg-[#161616] border border-[#E8E2D9] dark:border-white/10 rounded-sm overflow-hidden luxury-shadow hover:luxury-shadow-lg transition-all duration-500 group">
                  <div className="grid lg:grid-cols-12 gap-0">
                    {/* Visual Media Column */}
                    <div
                      onClick={() => handleOpenArticle(heroArticle)}
                      className="lg:col-span-7 relative cursor-pointer overflow-hidden aspect-[16/10] lg:aspect-auto min-h-[300px] lg:min-h-[420px]"
                    >
                      {heroArticle.cover_image && (
                        <SmartImage
                          src={heroArticle.cover_image}
                          alt={heroArticle.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                          aspectRatio="16/10"
                          priority
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent lg:hidden" />
                      {/* Giant 01 Rank Badge */}
                      <div className="absolute top-4 left-4 w-12 h-12 rounded-full bg-[#1F1F1F]/90 backdrop-blur-md text-white border border-white/20 flex items-center justify-center font-serif text-lg font-light shadow-lg">
                        01
                      </div>
                      {heroArticle.metadata?.trending_badge && (
                        <div className="absolute top-4 right-4 px-3 py-1 bg-[#9C6647] text-white rounded-full text-[10px] uppercase tracking-editorial font-medium shadow-md flex items-center gap-1.5">
                          <Flame size={12} />
                          <span>{heroArticle.metadata.trending_badge}</span>
                        </div>
                      )}
                    </div>

                    {/* Editorial Content Column */}
                    <div className="lg:col-span-5 p-7 sm:p-9 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-3 text-xs">
                          <span className="text-[10px] tracking-editorial uppercase font-bold text-[#9C6647] dark:text-bronze-light">
                            {heroArticle.category}
                          </span>
                          <span className="text-[#CCCCCC] dark:text-gray-600">·</span>
                          <span className="text-[#777777] dark:text-gray-400 flex items-center gap-1">
                            <Clock size={12} /> {heroArticle.read_time_minutes} min read
                          </span>
                          {heroArticle.views_count > 0 && (
                            <>
                              <span className="text-[#CCCCCC] dark:text-gray-600">·</span>
                              <span className="text-[#777777] dark:text-gray-400">{heroArticle.views_count.toLocaleString()} reads</span>
                            </>
                          )}
                        </div>

                        <h2
                          onClick={() => handleOpenArticle(heroArticle)}
                          className="font-serif text-2xl sm:text-3xl lg:text-4xl text-[#1F1F1F] dark:text-white leading-tight font-normal mb-4 cursor-pointer hover:text-[#9C6647] dark:hover:text-bronze-light transition-colors"
                        >
                          {heroArticle.title}
                        </h2>

                        <p className="text-sm text-[#555555] dark:text-gray-300 leading-relaxed mb-6 line-clamp-3">
                          {heroArticle.excerpt}
                        </p>

                        {/* Author Byline */}
                        {heroArticle.metadata?.author_name && (
                          <div className="flex items-center gap-3 mb-6 pb-6 border-b border-[#EFEAE2] dark:border-white/10">
                            {heroArticle.metadata.author_avatar ? (
                              <img
                                src={heroArticle.metadata.author_avatar}
                                alt={heroArticle.metadata.author_name}
                                className="w-9 h-9 rounded-full object-cover border border-[#E8E2D9] dark:border-white/10"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-[#EFEAE2] dark:bg-white/10 text-[#9C6647] dark:text-bronze-light flex items-center justify-center text-xs font-serif font-bold">
                                {heroArticle.metadata.author_name.charAt(0)}
                              </div>
                            )}
                            <div>
                              <p className="text-xs font-medium text-[#1F1F1F] dark:text-white">{heroArticle.metadata.author_name}</p>
                              <p className="text-[11px] text-[#888888] dark:text-gray-400">
                                {heroArticle.metadata.author_role || 'Editorial Contributor'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Primary Actions */}
                      <div className="flex items-center justify-between gap-3 pt-2">
                        <button
                          onClick={() => handleOpenArticle(heroArticle)}
                          className="inline-flex items-center gap-2 px-6 py-3 bg-[#1F1F1F] dark:bg-bronze text-white text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-[#9C6647] dark:hover:bg-bronze-dark transition-all duration-300 shadow-sm"
                        >
                          <span>Read Full Story</span>
                          <ArrowRight size={14} />
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleBookmark(heroArticle)}
                            aria-label="Bookmark story"
                            className={`p-2.5 rounded-full border transition-all ${
                              bookmarkedSlugs.has(heroArticle.metadata?.post_slug || heroArticle.slug)
                                ? 'bg-[#9C6647] text-white border-[#9C6647]'
                                : 'bg-[#FAF8F5] dark:bg-white/5 text-[#666666] dark:text-gray-300 border-[#E8E2D9] dark:border-white/10 hover:text-[#1F1F1F] dark:hover:text-white'
                            }`}
                            title="Save for later"
                          >
                            <Bookmark size={15} fill={bookmarkedSlugs.has(heroArticle.metadata?.post_slug || heroArticle.slug) ? 'currentColor' : 'none'} />
                          </button>

                          <button
                            onClick={() => handleUpvote(heroArticle)}
                            aria-label="Upvote story"
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#FAF8F5] dark:bg-white/5 border border-[#E8E2D9] dark:border-white/10 text-[#1F1F1F] dark:text-white rounded-full text-xs font-medium hover:bg-[#9C6647] hover:text-white hover:border-[#9C6647] transition-all"
                            title="Upvote story"
                          >
                            <Flame size={14} className="text-[#9C6647] dark:text-bronze-light" />
                            <span>{heroArticle.upvotes}</span>
                          </button>

                          <button
                            onClick={() => handleCopyLink(heroArticle)}
                            aria-label="Share story"
                            className="p-2.5 rounded-full border border-[#E8E2D9] dark:border-white/10 bg-[#FAF8F5] dark:bg-white/5 text-[#666666] dark:text-gray-300 hover:text-[#1F1F1F] dark:hover:text-white transition-all"
                            title="Share story"
                          >
                            {copiedId === heroArticle.id ? <Check size={15} className="text-green-600 dark:text-green-400" /> : <Share2 size={15} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* LEADERBOARD & STORIES STREAM */}
            <div className="mb-14">
              <div className="flex items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-2">
                  <h2 className="font-serif text-2xl text-[#1F1F1F] dark:text-white font-normal">
                    {activeFormat === 'articles'
                      ? 'Trending Stories Leaderboard'
                      : activeFormat === 'debates'
                      ? 'Community Debates & Industry Wire'
                      : activeFormat === 'products'
                      ? 'Curated Product Spotlight'
                      : 'All Trending Topics'}
                  </h2>
                  <span className="text-xs text-[#888888] dark:text-gray-400">({listItems.length})</span>
                </div>
              </div>

              {listItems.length === 0 ? (
                <div className="text-center py-20 bg-white dark:bg-[#161616] border border-[#E8E2D9] dark:border-white/10 rounded-sm p-8">
                  <Sparkles size={32} className="mx-auto text-[#9C6647] dark:text-bronze-light mb-3" />
                  <h3 className="font-serif text-xl text-[#1F1F1F] dark:text-white mb-2">No trending stories found</h3>
                  <p className="text-xs text-[#666666] dark:text-gray-400 max-w-md mx-auto">
                    Try clearing your search query or selecting "All Categories".
                  </p>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {listItems.map((item, index) => {
                    const rankNumber = String(index + (heroArticle && !searchQuery.trim() ? 2 : 1)).padStart(2, '0');
                    return (
                      <TrendingStoryCard
                        key={item.id}
                        item={item}
                        rank={rankNumber}
                        isBookmarked={bookmarkedSlugs.has(item.metadata?.post_slug || item.slug)}
                        isCopied={copiedId === item.id}
                        onUpvote={() => handleUpvote(item)}
                        onBookmark={() => handleToggleBookmark(item)}
                        onShare={() => handleCopyLink(item)}
                        onClick={() => handleOpenArticle(item)}
                        onVisible={() => recordView(item.id)}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* CURATED CULTURAL HIGHLIGHTS & DEBATES (if on articles view) */}
            {activeFormat === 'articles' && spotlights.length > 0 && !searchQuery.trim() && (
              <div className="pt-10 border-t border-[#E8E2D9] dark:border-white/10 mb-12">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <span className="text-[10px] tracking-ultra-wide uppercase font-semibold text-[#9C6647] dark:text-bronze-light">
                      Cultural Curation
                    </span>
                    <h3 className="font-serif text-2xl text-[#1F1F1F] dark:text-white mt-1">
                      Debates, Science Consensus &amp; Product Radar
                    </h3>
                  </div>
                  <button
                    onClick={() => setActiveFormat('debates')}
                    className="text-xs tracking-editorial uppercase font-medium text-[#9C6647] dark:text-bronze-light hover:text-[#1F1F1F] dark:hover:text-white flex items-center gap-1 transition-colors"
                  >
                    <span>View all curations</span>
                    <ChevronRight size={14} />
                  </button>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  {spotlights.slice(0, 4).map(spot => (
                    <SpotlightMiniCard
                      key={spot.id}
                      item={spot}
                      onUpvote={() => handleUpvote(spot)}
                      onCopy={() => handleCopyLink(spot)}
                      onClick={() => handleOpenArticle(spot)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface TrendingStoryCardProps {
  item: TrendingItem;
  rank: string;
  isBookmarked: boolean;
  isCopied: boolean;
  onUpvote: () => void;
  onBookmark: () => void;
  onShare: () => void;
  onClick: () => void;
  onVisible: () => void;
}

function TrendingStoryCard({
  item,
  rank,
  isBookmarked,
  isCopied,
  onUpvote,
  onBookmark,
  onShare,
  onClick,
  onVisible,
}: TrendingStoryCardProps) {
  return (
    <article
      id={item.slug}
      onMouseEnter={onVisible}
      className="bg-white dark:bg-[#161616] border border-[#E8E2D9] dark:border-white/10 rounded-sm flex flex-col justify-between hover:border-[#9C6647]/50 dark:hover:border-bronze/50 luxury-shadow hover:luxury-shadow-lg transition-all duration-300 group overflow-hidden"
    >
      <div>
        {/* Cover Image & Rank Badge */}
        <div
          onClick={onClick}
          className="aspect-[16/10] overflow-hidden relative cursor-pointer bg-[#EFEAE2] dark:bg-white/5"
        >
          {item.cover_image && (
            <SmartImage
              src={item.cover_image}
              alt={item.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
              aspectRatio="16/10"
            />
          )}
          {/* Rank Badge */}
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-sm bg-[#1F1F1F]/80 dark:bg-black/80 backdrop-blur-md text-white font-serif text-xs font-light tracking-widest shadow-md">
            {rank}
          </div>
          {item.metadata?.trending_badge && (
            <div className="absolute top-3 right-3 px-2 py-0.5 bg-[#9C6647] text-white rounded text-[9px] uppercase tracking-editorial font-medium shadow-sm">
              {item.metadata.trending_badge}
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-5">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[10px] tracking-editorial uppercase font-semibold text-[#9C6647] dark:text-bronze-light">
              {item.category}
            </span>
            <span className="text-[#888888] dark:text-gray-400 flex items-center gap-1 text-[11px]">
              <Clock size={11} /> {item.read_time_minutes}m read
            </span>
          </div>

          <h3
            onClick={onClick}
            className="font-serif text-lg text-[#1F1F1F] dark:text-white leading-snug font-normal group-hover:text-[#9C6647] dark:group-hover:text-bronze-light transition-colors cursor-pointer line-clamp-2 mb-2"
          >
            {item.title}
          </h3>

          <p className="text-xs text-[#666666] dark:text-gray-300 leading-relaxed line-clamp-2 mb-4">
            {item.excerpt}
          </p>

          {item.metadata?.why_trending && (
            <div className="p-2.5 bg-[#FAF8F5] dark:bg-white/5 border border-[#EFEAE2] dark:border-white/10 rounded-sm text-[11px] text-[#555555] dark:text-gray-300 mb-2 flex items-center gap-1.5">
              <Flame size={12} className="text-[#9C6647] dark:text-bronze-light flex-shrink-0" />
              <span className="line-clamp-1 italic">{item.metadata.why_trending}</span>
            </div>
          )}

          {item.metadata?.author_name && (
            <p className="text-[11px] text-[#888888] dark:text-gray-400 mt-2">
              By <span className="font-medium text-[#444444] dark:text-gray-200">{item.metadata.author_name}</span>
            </p>
          )}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="px-5 py-3 border-t border-[#E8E2D9] dark:border-white/10 bg-[#FAF8F5]/50 dark:bg-white/[0.03] flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onUpvote}
            aria-label={`Upvote ${item.title}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-white dark:bg-white/10 border border-[#E8E2D9] dark:border-white/15 text-[#1F1F1F] dark:text-white hover:bg-[#9C6647] hover:text-white hover:border-[#9C6647] transition-all"
          >
            <Flame size={13} className="text-[#9C6647] dark:text-bronze-light" />
            <span>{item.upvotes}</span>
          </button>

          <button
            onClick={onBookmark}
            aria-label="Save story"
            className={`p-1.5 rounded-full border transition-all ${
              isBookmarked
                ? 'bg-[#9C6647] text-white border-[#9C6647]'
                : 'bg-white dark:bg-white/10 text-[#888888] dark:text-gray-300 border-[#E8E2D9] dark:border-white/15 hover:text-[#1F1F1F] dark:hover:text-white'
            }`}
            title="Bookmark"
          >
            <Bookmark size={13} fill={isBookmarked ? 'currentColor' : 'none'} />
          </button>

          <button
            onClick={onShare}
            aria-label="Share story"
            className="p-1.5 bg-white dark:bg-white/10 text-[#888888] dark:text-gray-300 hover:text-[#1F1F1F] dark:hover:text-white rounded-full border border-[#E8E2D9] dark:border-white/15 transition-all"
            title="Share"
          >
            {isCopied ? <Check size={13} className="text-green-600 dark:text-green-400" /> : <Share2 size={13} />}
          </button>
        </div>

        <button
          onClick={onClick}
          className="inline-flex items-center gap-1 text-[11px] tracking-editorial uppercase font-medium text-[#9C6647] dark:text-bronze-light hover:text-[#1F1F1F] dark:hover:text-white transition-colors"
        >
          <span>Read Story</span>
          <ArrowRight size={12} />
        </button>
      </div>
    </article>
  );
}

function SpotlightMiniCard({
  item,
  onUpvote,
  onCopy,
  onClick,
}: {
  item: TrendingItem;
  onUpvote: () => void;
  onCopy: () => void;
  onClick: () => void;
}) {
  const typeConfig: Record<
    TrendingItemType,
    { label: string; icon: typeof Flame; color: string; bg: string }
  > = {
    article: { label: 'Article', icon: BookOpen, color: 'text-[#9C6647] dark:text-bronze-light', bg: 'bg-[#9C6647]/10 dark:bg-bronze/20' },
    product: { label: 'Product Spotlight', icon: Sparkles, color: 'text-[#9C6647] dark:text-amber-300', bg: 'bg-[#9C6647]/10 dark:bg-amber-950/40' },
    debate: { label: 'Community Debate', icon: MessageCircle, color: 'text-[#3E5C76] dark:text-blue-300', bg: 'bg-[#3E5C76]/10 dark:bg-blue-950/40' },
    ingredient: { label: 'Clinical Argument', icon: BookOpen, color: 'text-[#47624B] dark:text-emerald-300', bg: 'bg-[#47624B]/10 dark:bg-emerald-950/40' },
    update: { label: 'Editorial Flash', icon: Flame, color: 'text-[#8C4A32] dark:text-red-300', bg: 'bg-[#8C4A32]/10 dark:bg-red-950/40' },
  };

  const currentType = typeConfig[item.item_type] || typeConfig.article;
  const TypeIcon = currentType.icon;

  return (
    <div className="bg-white dark:bg-[#161616] border border-[#E8E2D9] dark:border-white/10 rounded-sm p-5 flex flex-col justify-between hover:border-[#9C6647]/40 dark:hover:border-bronze/40 transition-all">
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-editorial uppercase ${currentType.bg} ${currentType.color}`}
          >
            <TypeIcon size={11} />
            {currentType.label}
          </span>
          <span className="text-[10px] uppercase text-[#888888] dark:text-gray-400 tracking-editorial">
            {item.category}
          </span>
        </div>

        <h4
          onClick={onClick}
          className="font-serif text-base text-[#1F1F1F] dark:text-white hover:text-[#9C6647] dark:hover:text-bronze-light cursor-pointer transition-colors leading-snug mb-2 font-normal"
        >
          {item.title}
        </h4>

        <p className="text-xs text-[#666666] dark:text-gray-300 leading-relaxed mb-4 line-clamp-2">
          {item.excerpt}
        </p>

        {item.item_type === 'product' && item.metadata?.brand && (
          <p className="text-xs text-[#9C6647] dark:text-bronze-light font-medium mb-3">
            Brand: {item.metadata.brand} {item.metadata.rating_score && `(Score: ${item.metadata.rating_score}/100)`}
          </p>
        )}
        {item.item_type === 'debate' && item.metadata?.community_takeaway && (
          <p className="text-xs text-[#3E5C76] dark:text-blue-300 italic mb-3">
            Takeaway: {item.metadata.community_takeaway}
          </p>
        )}
      </div>

      <div className="pt-3 border-t border-[#EFEAE2] dark:border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onUpvote}
            className="inline-flex items-center gap-1 text-xs text-[#666666] dark:text-gray-400 hover:text-[#9C6647] dark:hover:text-bronze-light"
          >
            <Flame size={13} className="text-[#9C6647] dark:text-bronze-light" />
            <span>{item.upvotes}</span>
          </button>
          <button
            onClick={onCopy}
            className="text-xs text-[#888888] dark:text-gray-400 hover:text-[#1F1F1F] dark:hover:text-white p-1"
            title="Share"
          >
            <Share2 size={12} />
          </button>
        </div>

        <button
          onClick={onClick}
          className="text-xs uppercase tracking-editorial font-medium text-[#9C6647] dark:text-bronze-light hover:text-[#1F1F1F] dark:hover:text-white inline-flex items-center gap-1"
        >
          <span>Explore</span>
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}
