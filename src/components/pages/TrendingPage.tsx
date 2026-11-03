import { useState, useEffect, useMemo } from 'react';
import { Flame, Share2, ExternalLink, ArrowRight, Clock, Sparkles, MessageCircle, BookOpen, AlertCircle, Check, Search } from 'lucide-react';
import { useNavigation } from '../../context/NavigationContext';
import { useToast } from '../../context/ToastContext';
import { useTrending } from '../../hooks/useTrending';
import type { TrendingItem, TrendingCategory, TrendingItemType } from '../../types/trending';

const CATEGORIES: { label: string; value: TrendingCategory }[] = [
  { label: 'All', value: 'all' },
  { label: 'Skincare', value: 'skincare' },
  { label: 'Fashion', value: 'fashion' },
  { label: 'Wellness', value: 'wellness' },
  { label: 'Others', value: 'others' },
];

export default function TrendingPage() {
  const { navigate } = useNavigation();
  const { showToast } = useToast();

  // Read initial category from query parameters if present
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
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { items, loading, error, upvote, recordClick, recordView } = useTrending(activeCategory);

  // Sync category with URL query param smoothly
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

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      item =>
        item.title.toLowerCase().includes(q) ||
        item.excerpt.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.item_type.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const handleCopyLink = async (item: TrendingItem) => {
    try {
      const url = `${window.location.origin}/trending#${item.slug}`;
      await navigator.clipboard.writeText(url);
      setCopiedId(item.id);
      showToast('Link copied to clipboard', 'success');
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      showToast('Could not copy link', 'error');
    }
  };

  const handleUpvote = async (item: TrendingItem) => {
    const res = await upvote(item.id);
    if (res.alreadyVoted) {
      showToast('You already upvoted this item', 'info');
    } else {
      showToast('Upvoted! Thank you for curating.', 'success');
    }
  };

  const handleCardClick = (item: TrendingItem) => {
    recordClick(item.id);
    if (item.destination_url) {
      if (item.destination_url.startsWith('http')) {
        window.open(item.destination_url, '_blank', 'noopener,noreferrer');
      } else {
        // Internal navigation
        const path = item.destination_url;
        if (path === '/shop') navigate({ name: 'shop' });
        else if (path.startsWith('/collections')) navigate({ name: 'collections' });
        else if (path.startsWith('/blog') || path.startsWith('/article')) {
          const parts = path.split('/').filter(Boolean);
          if (parts[1]) navigate({ name: 'article', slug: parts[1] });
          else navigate({ name: 'home', page: 1 });
        } else {
          window.location.href = path;
        }
      }
    }
  };

  return (
    <div className="bg-[#FAF8F5] min-h-screen py-10 md:py-16 text-[#2B2B2B]">
      {/* Hero Header */}
      <div className="container-wide max-w-6xl mx-auto px-4 sm:px-6 mb-12 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#9C6647]/10 text-[#9C6647] rounded-full text-xs font-medium tracking-editorial uppercase mb-4">
          <Flame size={14} className="animate-pulse" />
          <span>Curated Cultural Radar</span>
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-light text-[#1F1F1F] mb-4 tracking-tight">
          The Trending Index
        </h1>
        <p className="max-w-2xl mx-auto text-sm sm:text-base text-[#666666] leading-relaxed">
          Real-time tracking of emerging skincare breakthroughs, cultural fashion dialogues, scientific consensus, and verified industry updates.
        </p>

        {/* Filter Bar & Search */}
        <div className="mt-8 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-[#E8E2D9] pb-6">
          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {CATEGORIES.map(cat => (
              <button
                key={cat.value}
                onClick={() => handleCategoryChange(cat.value)}
                className={`px-4 py-2 text-xs tracking-editorial uppercase font-medium rounded-full transition-all duration-300 ${
                  activeCategory === cat.value
                    ? 'bg-[#1F1F1F] text-white shadow-sm'
                    : 'bg-white text-[#666666] hover:bg-[#EFEAE2] hover:text-[#1F1F1F] border border-[#E8E2D9]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Quick Search */}
          <div className="relative w-full md:w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999999]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search trending..."
              aria-label="Search trending topics"
              className="w-full bg-white border border-[#E8E2D9] pl-9 pr-4 py-2 text-xs rounded-full text-[#1F1F1F] placeholder:text-[#999999] focus:outline-none focus:border-[#9C6647] transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Main Grid Content */}
      <div className="container-wide max-w-6xl mx-auto px-4 sm:px-6">
        {loading ? (
          <div className="grid md:grid-cols-2 gap-8">
            {[1, 2, 3, 4].map(n => (
              <div key={n} className="bg-white border border-[#E8E2D9] p-6 rounded-sm animate-pulse h-72">
                <div className="h-4 bg-[#EFEAE2] w-24 rounded mb-4" />
                <div className="h-6 bg-[#EFEAE2] w-3/4 rounded mb-3" />
                <div className="h-4 bg-[#EFEAE2] w-full rounded mb-2" />
                <div className="h-4 bg-[#EFEAE2] w-2/3 rounded" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-16 bg-white border border-[#E8E2D9] rounded-sm p-8">
            <AlertCircle size={32} className="mx-auto text-amber-600 mb-3" />
            <p className="text-sm text-[#666666] mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-[#1F1F1F] text-white text-xs uppercase tracking-editorial rounded-sm hover:bg-[#9C6647] transition-colors"
            >
              Retry
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-20 bg-white border border-[#E8E2D9] rounded-sm p-8">
            <Sparkles size={32} className="mx-auto text-[#9C6647] mb-3" />
            <h3 className="font-serif text-xl text-[#1F1F1F] mb-2">No trending topics found</h3>
            <p className="text-xs text-[#666666] max-w-md mx-auto">
              We are actively monitoring upcoming dispatches. Try clearing your search query or selecting "All" categories.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-8">
            {filteredItems.map(item => (
              <TrendingCard
                key={item.id}
                item={item}
                copiedId={copiedId}
                onUpvote={() => handleUpvote(item)}
                onCopy={() => handleCopyLink(item)}
                onClick={() => handleCardClick(item)}
                onVisible={() => recordView(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface TrendingCardProps {
  item: TrendingItem;
  copiedId: string | null;
  onUpvote: () => void;
  onCopy: () => void;
  onClick: () => void;
  onVisible: () => void;
}

function TrendingCard({ item, copiedId, onUpvote, onCopy, onClick, onVisible }: TrendingCardProps) {
  useEffect(() => {
    onVisible();
  }, [onVisible]);

  const typeConfig: Record<
    TrendingItemType,
    { label: string; icon: typeof Flame; color: string; bg: string }
  > = {
    product: {
      label: 'Product Spotlight',
      icon: Sparkles,
      color: 'text-[#9C6647]',
      bg: 'bg-[#9C6647]/10',
    },
    debate: {
      label: 'Community Debate',
      icon: MessageCircle,
      color: 'text-[#3E5C76]',
      bg: 'bg-[#3E5C76]/10',
    },
    ingredient: {
      label: 'Science & Clinical Argument',
      icon: BookOpen,
      color: 'text-[#47624B]',
      bg: 'bg-[#47624B]/10',
    },
    update: {
      label: 'Editorial Flash',
      icon: Flame,
      color: 'text-[#8C4A32]',
      bg: 'bg-[#8C4A32]/10',
    },
  };

  const currentType = typeConfig[item.item_type] || typeConfig.update;
  const TypeIcon = currentType.icon;

  return (
    <article
      id={item.slug}
      className="bg-white border border-[#E8E2D9] rounded-sm p-6 sm:p-7 flex flex-col justify-between hover:border-[#9C6647]/50 hover:shadow-md transition-all duration-300 relative group"
    >
      {/* Top Meta Line */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-editorial uppercase ${currentType.bg} ${currentType.color}`}
            >
              <TypeIcon size={12} />
              {currentType.label}
            </span>
            <span className="text-[10px] tracking-editorial uppercase text-[#888888]">
              {item.category}
            </span>
            {item.is_pinned && (
              <span className="px-2 py-0.5 bg-[#9C6647] text-white rounded-full text-[9px] uppercase tracking-editorial font-medium">
                Pinned
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-[#888888]">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} />
              {item.read_time_minutes} min read
            </span>
          </div>
        </div>

        {/* Title */}
        <h2 className="font-serif text-xl sm:text-2xl font-normal text-[#1F1F1F] mb-3 group-hover:text-[#9C6647] transition-colors leading-snug">
          {item.title}
        </h2>

        {/* Excerpt */}
        <p className="text-sm text-[#555555] leading-relaxed mb-5">{item.excerpt}</p>

        {/* Card Specific Archetype Body */}
        {item.item_type === 'product' && (
          <div className="bg-[#FAF8F5] border border-[#EFEAE2] p-4 rounded-sm mb-5 text-xs text-[#444444] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#1F1F1F]">
                {item.metadata.brand || 'Featured Brand'}
              </span>
              {item.metadata.rating_score && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#9C6647]/10 text-[#9C6647] rounded text-[11px] font-medium">
                  🔥 Heat Score: {item.metadata.rating_score}/100
                </span>
              )}
            </div>
            {item.metadata.why_trending && (
              <p className="text-[#666666] italic">
                <strong>Why it’s trending:</strong> {item.metadata.why_trending}
              </p>
            )}
            {item.metadata.price && (
              <p className="font-medium text-[#1F1F1F]">MSRP: {item.metadata.price}</p>
            )}
          </div>
        )}

        {item.item_type === 'debate' && (
          <div className="bg-[#FAF8F5] border border-[#EFEAE2] p-4 rounded-sm mb-5 text-xs text-[#444444] space-y-2">
            {item.metadata.topic_headline && (
              <p className="font-semibold text-[#1F1F1F]">
                Topic: {item.metadata.topic_headline}
              </p>
            )}
            {item.metadata.counter_arguments && (
              <p className="text-[#555555]">
                <strong className="text-[#1F1F1F]">The Counterpoints:</strong>{' '}
                {item.metadata.counter_arguments}
              </p>
            )}
            {item.metadata.community_takeaway && (
              <p className="text-[#3E5C76] font-medium">
                <strong>Community Takeaway:</strong> {item.metadata.community_takeaway}
              </p>
            )}
          </div>
        )}

        {item.item_type === 'ingredient' && (
          <div className="bg-[#FAF8F5] border border-[#EFEAE2] p-4 rounded-sm mb-5 text-xs text-[#444444] space-y-2">
            {item.metadata.controversy && (
              <p className="text-[#555555]">
                <strong className="text-[#8C4A32]">The Controversy:</strong>{' '}
                {item.metadata.controversy}
              </p>
            )}
            {item.metadata.consensus && (
              <p className="text-[#47624B]">
                <strong className="text-[#1F1F1F]">Clinical Consensus:</strong>{' '}
                {item.metadata.consensus}
              </p>
            )}
            {item.metadata.study_summary && (
              <p className="text-[#666666] italic">
                <strong>Key Study:</strong> {item.metadata.study_summary}
              </p>
            )}
          </div>
        )}

        {item.item_type === 'update' && (
          <div className="bg-[#FAF8F5] border border-[#EFEAE2] p-3 rounded-sm mb-5 text-xs text-[#555555] flex items-center justify-between">
            <span>
              Source:{' '}
              <strong className="text-[#1F1F1F]">
                {item.metadata.source_name || 'Editorial Wire'}
              </strong>
            </span>
            <span className="text-[#888888]">{item.metadata.timestamp_label || 'Verified'}</span>
          </div>
        )}
      </div>

      {/* Bottom Action Footer */}
      <div className="pt-4 border-t border-[#E8E2D9] flex items-center justify-between gap-3">
        {/* Engagement Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={onUpvote}
            aria-label={`Upvote ${item.title}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#FAF8F5] border border-[#E8E2D9] text-[#1F1F1F] hover:bg-[#9C6647] hover:text-white hover:border-[#9C6647] transition-all"
          >
            <Flame size={14} className="text-[#9C6647] group-hover:text-white" />
            <span>{item.upvotes}</span>
          </button>

          <button
            onClick={onCopy}
            aria-label="Copy direct link to trending item"
            className="p-2 text-[#888888] hover:text-[#1F1F1F] hover:bg-[#FAF8F5] rounded-full border border-transparent hover:border-[#E8E2D9] transition-all"
            title="Copy link"
          >
            {copiedId === item.id ? <Check size={14} className="text-green-600" /> : <Share2 size={14} />}
          </button>
        </div>

        {/* Outbound Link CTA */}
        {item.destination_url && (
          <button
            onClick={onClick}
            className="inline-flex items-center gap-1.5 text-xs tracking-editorial uppercase font-medium text-[#9C6647] hover:text-[#1F1F1F] transition-colors"
          >
            <span>
              {item.item_type === 'product'
                ? 'Shop / View'
                : item.item_type === 'debate'
                ? 'Join Discussion'
                : item.item_type === 'ingredient'
                ? 'Read Study'
                : 'Read Flash'}
            </span>
            {item.destination_url.startsWith('http') ? <ExternalLink size={13} /> : <ArrowRight size={13} />}
          </button>
        )}
      </div>
    </article>
  );
}
