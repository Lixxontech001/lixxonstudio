import { useState, useMemo, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  CheckCircle2, Lock, ArrowRight, Share2, History, Trophy, Sparkles, User, ExternalLink
} from 'lucide-react';
import { Link } from '../context/NavigationContext';
import { useBadges, useProfile } from '../hooks/useV3';
import { useReadingHistory } from '../hooks/useFeatures';
import CustomerGate from './shop/CustomerGate';

// Expanded rich catalog of editorial reader milestones
interface BadgeDefinition {
  key: string;
  label: string;
  description: string;
  emoji: string;
  category: 'reading' | 'streak' | 'collection' | 'community';
  requirement: string;
  points: number;
}

const ALL_ACHIEVEMENTS: BadgeDefinition[] = [
  {
    key: 'first_read',
    label: 'First Page',
    description: 'Read your first editorial piece or scientific deep dive on Lixxon Studio.',
    emoji: '📖',
    category: 'reading',
    requirement: 'Read 1 article',
    points: 50,
  },
  {
    key: 'ten_articles',
    label: 'Regular Reader',
    description: 'Immersed in daily skincare science, formulation guides, and intentional style.',
    emoji: '☕',
    category: 'reading',
    requirement: 'Read across 10 different days',
    points: 150,
  },
  {
    key: 'fifty_articles',
    label: 'Editorial Devotee',
    description: 'Fifty days of curated knowledge and intentional living.',
    emoji: '🏛️',
    category: 'reading',
    requirement: 'Read across 50 different days',
    points: 500,
  },
  {
    key: 'streak_7',
    label: '7-Day Habit',
    description: 'Read every single day for a full week without breaking the cadence.',
    emoji: '🔥',
    category: 'streak',
    requirement: '7 consecutive reading days',
    points: 200,
  },
  {
    key: 'streak_30',
    label: 'Full Moon Streak',
    description: 'A 30-day continuous ritual of daily wellness and editorial discovery.',
    emoji: '🌙',
    category: 'streak',
    requirement: '30 consecutive reading days',
    points: 600,
  },
  {
    key: 'curator',
    label: 'Master Curator',
    description: 'Curated 5 or more articles into your private reference library.',
    emoji: '🗂️',
    category: 'collection',
    requirement: 'Save 5 bookmarks',
    points: 100,
  },
  {
    key: 'patron',
    label: 'Studio Patron',
    description: 'Purchased a curated essential or digital wellness guide from the boutique.',
    emoji: '🛍️',
    category: 'community',
    requirement: 'Make your first shop purchase',
    points: 300,
  },
  {
    key: 'series_finisher',
    label: 'Series Graduate',
    description: 'Completed every chapter in a multi-part editorial series in order.',
    emoji: '🎓',
    category: 'reading',
    requirement: 'Complete an entire series',
    points: 250,
  },
  {
    key: 'glossary_explorer',
    label: 'Formulation Scholar',
    description: 'Explored cosmetic formulation science and clinical ingredient definitions.',
    emoji: '🔬',
    category: 'reading',
    requirement: 'Explore glossary actives & terms',
    points: 100,
  },
  {
    key: 'night_owl',
    label: 'Nighttime Ritual',
    description: 'Enjoyed an evening skincare or mindfulness article after 9:00 PM.',
    emoji: '✨',
    category: 'streak',
    requirement: 'Read during quiet evening hours',
    points: 75,
  },
];

export default function AchievementsPage() {
  return (
    <CustomerGate title="Reader Achievements" intro="Sign in to view your milestones, streaks, and reader ranks.">
      <AchievementsInner />
    </CustomerGate>
  );
}

function AchievementsInner() {
  const { badges } = useBadges();
  const { profile } = useProfile();
  const { history } = useReadingHistory();
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all');
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Compute stats
  const unlockedKeys = useMemo(() => new Set(badges.map(b => b.badge)), [badges]);
  const unlockedCount = badges.length;
  const totalCount = ALL_ACHIEVEMENTS.length;

  const totalPoints = useMemo(() => {
    return ALL_ACHIEVEMENTS.reduce((sum, item) => {
      return unlockedKeys.has(item.key) ? sum + item.points : sum;
    }, 0);
  }, [unlockedKeys]);

  // Reader rank ladder
  const rank = useMemo(() => {
    if (totalPoints >= 1000) return { title: 'Platinum Luminary', tier: 4, next: null, progress: 100 };
    if (totalPoints >= 500) return { title: 'Gold Connoisseur', tier: 3, next: 1000, progress: Math.round(((totalPoints - 500) / 500) * 100) };
    if (totalPoints >= 200) return { title: 'Silver Scholar', tier: 2, next: 500, progress: Math.round(((totalPoints - 200) / 300) * 100) };
    return { title: 'Bronze Reader', tier: 1, next: 200, progress: Math.round((totalPoints / 200) * 100) };
  }, [totalPoints]);

  const filteredBadges = useMemo(() => {
    return ALL_ACHIEVEMENTS.filter(b => {
      const isUnlocked = unlockedKeys.has(b.key);
      if (filter === 'unlocked') return isUnlocked;
      if (filter === 'locked') return !isUnlocked;
      return true;
    });
  }, [unlockedKeys, filter]);

  const shareShowcase = () => {
    const url = profile?.handle ? `${window.location.origin}/reader/${profile.handle}` : window.location.href;
    if (navigator.share) {
      navigator.share({ title: 'My Lixxon Studio Achievements', url }).catch(() => undefined);
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2500);
      });
    }
  };

  return (
    <main className="container-wide py-12 md:py-16">
      <Helmet>
        <title>Reader Achievements &amp; Milestones | Lixxon Studio</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-2 text-xs text-charcoal-muted tracking-editorial uppercase mb-8">
        <Link to={{ name: 'account' }} className="hover:text-bronze transition-colors">
          Account
        </Link>
        <span>/</span>
        <span className="text-charcoal font-medium">Achievements</span>
      </nav>

      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-12 border-b border-taupe/30 pb-8">
        <div>
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3 font-semibold flex items-center gap-1.5">
            <Trophy size={14} className="text-bronze" /> Gamified Editorial Milestones
          </p>
          <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light">
            Reader Achievements
          </h1>
          <p className="text-charcoal-muted text-base mt-3 max-w-xl">
            Celebrate your reading rituals, consistent knowledge habits, and mastery of formulation science.
          </p>
        </div>

        {/* Quick action: View Reading History */}
        <div className="flex items-center gap-3">
          <Link
            to={{ name: 'reading-history' }}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-taupe text-charcoal text-xs tracking-editorial uppercase rounded-sm hover:border-bronze transition-colors bg-white shadow-sm"
          >
            <History size={14} className="text-bronze" /> View Reading History ({history.length})
          </Link>
          <button
            type="button"
            onClick={shareShowcase}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze transition-colors shadow-sm"
          >
            <Share2 size={14} /> {copiedLink ? 'Link Copied!' : 'Share Showcase'}
          </button>
        </div>
      </div>

      {/* Rank & Stats Overview Banner */}
      <div className="grid md:grid-cols-4 gap-4 mb-10">
        {/* Card 1: Current Rank */}
        <div className="bg-white border border-taupe/40 rounded-sm p-6 shadow-sm md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] tracking-editorial uppercase text-charcoal-muted">Current Reader Rank</span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-bronze/10 text-bronze">
              Tier {rank.tier}
            </span>
          </div>
          <h2 className="font-serif text-2xl md:text-3xl text-charcoal font-medium flex items-center gap-2">
            <Sparkles size={22} className="text-bronze" /> {rank.title}
          </h2>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-charcoal-muted mb-1.5">
              <span>{totalPoints} Editorial Points</span>
              {rank.next ? <span>Next Tier at {rank.next} pts</span> : <span>Highest Rank Achieved</span>}
            </div>
            <div className="w-full bg-taupe-light h-2 rounded-full overflow-hidden">
              <div
                className="bg-bronze h-full transition-all duration-700 ease-out"
                style={{ width: `${Math.min(100, Math.max(5, rank.progress))}%` }}
              />
            </div>
          </div>
        </div>

        {/* Card 2: Badges Count */}
        <div className="bg-white border border-taupe/40 rounded-sm p-6 shadow-sm">
          <span className="text-[11px] tracking-editorial uppercase text-charcoal-muted block mb-2">
            Badges Collected
          </span>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-3xl md:text-4xl text-charcoal font-semibold">{unlockedCount}</span>
            <span className="text-sm text-charcoal-muted">/ {totalCount}</span>
          </div>
          <p className="text-xs text-charcoal-muted mt-2">
            {totalCount - unlockedCount > 0
              ? `${totalCount - unlockedCount} more to unlock`
              : 'Every badge unlocked!'}
          </p>
        </div>

        {/* Card 3: Articles Read */}
        <div className="bg-white border border-taupe/40 rounded-sm p-6 shadow-sm">
          <span className="text-[11px] tracking-editorial uppercase text-charcoal-muted block mb-2">
            Articles Completed
          </span>
          <span className="font-serif text-3xl md:text-4xl text-charcoal font-semibold">{history.length}</span>
          <p className="text-xs text-charcoal-muted mt-2">Logged in your private history</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between mb-8 border-b border-taupe/20 pb-4 flex-wrap gap-4">
        <div className="flex items-center gap-2">
          {(['all', 'unlocked', 'locked'] as const).map(tabKey => (
            <button
              key={tabKey}
              onClick={() => setFilter(tabKey)}
              className={`px-4 py-2 text-xs tracking-editorial uppercase rounded-sm transition-colors ${
                filter === tabKey
                  ? 'bg-charcoal text-white font-medium shadow-sm'
                  : 'text-charcoal-muted hover:text-charcoal hover:bg-taupe-light/50'
              }`}
            >
              {tabKey === 'all' && `All Achievements (${totalCount})`}
              {tabKey === 'unlocked' && `Unlocked (${unlockedCount})`}
              {tabKey === 'locked' && `Locked (${totalCount - unlockedCount})`}
            </button>
          ))}
        </div>

        {profile?.handle && (
          <Link
            to={{ name: 'reader', handle: profile.handle }}
            className="inline-flex items-center gap-1.5 text-xs text-bronze hover:underline"
          >
            <User size={13} /> View on your Public Profile <ExternalLink size={11} />
          </Link>
        )}
      </div>

      {/* Badges Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredBadges.map(item => {
          const unlocked = unlockedKeys.has(item.key);
          const badgeRecord = badges.find(b => b.badge === item.key);

          return (
            <div
              key={item.key}
              className={`relative rounded-md border p-6 flex flex-col justify-between transition-all duration-300 ${
                unlocked
                  ? 'bg-white border-bronze/50 shadow-md hover:shadow-lg'
                  : 'bg-taupe-light/20 border-taupe/30 opacity-75'
              }`}
            >
              {/* Top Row: Icon + Points Badge */}
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div
                    className={`w-14 h-14 rounded-full flex items-center justify-center text-3xl shadow-sm ${
                      unlocked ? 'bg-bronze/10 border border-bronze/30' : 'bg-taupe/20 grayscale'
                    }`}
                  >
                    <span role="img" aria-label={item.label}>
                      {item.emoji}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="inline-block text-[11px] font-semibold tracking-wider px-2 py-0.5 rounded bg-taupe-light text-charcoal-muted">
                      +{item.points} PTS
                    </span>
                    {unlocked && (
                      <span className="block text-[10px] text-green-700 font-medium mt-1 flex items-center justify-end gap-1">
                        <CheckCircle2 size={11} /> Unlocked
                      </span>
                    )}
                  </div>
                </div>

                <h3 className="font-serif text-lg text-charcoal font-medium mb-1">{item.label}</h3>
                <p className="text-xs text-charcoal-muted leading-relaxed mb-4">{item.description}</p>
              </div>

              {/* Bottom Row: Requirement & Status */}
              <div className="pt-4 border-t border-taupe/20 text-xs">
                <div className="flex items-center justify-between text-charcoal-muted">
                  <span className="font-mono text-[11px]">Target: {item.requirement}</span>
                  {!unlocked && <Lock size={12} className="text-charcoal-muted" />}
                </div>
                {unlocked && badgeRecord?.earned_at && (
                  <p className="text-[10px] text-bronze mt-1 font-medium">
                    Earned on {new Date(badgeRecord.earned_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom CTA to Reading History */}
      <div className="mt-16 p-8 bg-taupe-light/30 border border-taupe/40 rounded-md text-center max-w-2xl mx-auto">
        <History size={28} className="text-bronze mx-auto mb-3" />
        <h2 className="font-serif text-xl text-charcoal font-medium mb-2">Looking for your read articles log?</h2>
        <p className="text-xs text-charcoal-muted mb-6 leading-relaxed">
          Reading history maintains the chronological log of every article you have browsed, with resumption points and timestamps.
        </p>
        <Link
          to={{ name: 'reading-history' }}
          className="inline-flex items-center gap-2 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-colors shadow-sm"
        >
          Open Reading History Log <ArrowRight size={14} />
        </Link>
      </div>
    </main>
  );
}
