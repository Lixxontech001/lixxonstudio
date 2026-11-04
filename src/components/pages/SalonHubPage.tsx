import { useState, useEffect } from 'react';
import { useAchievements } from '../../hooks/useAchievements';
import { useNavigation } from '../../context/NavigationContext';
import RegimenArchitect from '../salon/RegimenArchitect';
import InciDecrypter from '../salon/InciDecrypter';
import SmartVanityShelf from '../salon/SmartVanityShelf';
import {
  Trophy, Sparkles, Beaker, Package, Lock, CheckCircle2,
  Flame, Award, ChevronRight, FileText
} from 'lucide-react';

type SalonTab = 'privileges' | 'architect' | 'inci' | 'vanity' | 'briefing';

export default function SalonHubPage() {
  const { points, rank, progress, badges, privileges, ranks } = useAchievements();
  const { navigate } = useNavigation();
  const [activeTab, setActiveTab] = useState<SalonTab>('privileges');
  const nextRank = ranks.find(r => r.tier === rank.tier + 1);
  const progressPercent = progress;
  const streakDays = typeof window !== 'undefined' ? (localStorage.getItem('lixxon_reader_streak_days') || '3') : '3';

  // Listen to URL query params or hash if provided
  useEffect(() => {
    window.scrollTo(0, 0);
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab') as SalonTab | null;
    if (tabParam && ['privileges', 'architect', 'inci', 'vanity', 'briefing'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, []);

  const handleTabChange = (tab: SalonTab) => {
    setActiveTab(tab);
    window.history.replaceState(null, '', `?tab=${tab}`);
  };

  const isGold = rank.tier >= 3;

  return (
    <div className="min-h-screen bg-warm-ivory/30 pb-20">
      {/* Top Hero Brand Header */}
      <section className="bg-charcoal text-white pt-12 pb-14 px-4 sm:px-6 lg:px-8 border-b border-gray-800">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 text-bronze-light text-xs tracking-editorial uppercase font-medium rounded-full">
                <Trophy size={13} className="text-bronze" />
                <span>The Lixxon Salon · Reader Privilege Suite</span>
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl tracking-tight text-white">
                Reader Privileges & Formulation Suite
              </h1>
              <p className="text-sm sm:text-base text-gray-300 max-w-2xl font-serif italic">
                A sanctuary of clinical active tools, custom routine synthesis, and private editorial privileges unlocked as you read.
              </p>
            </div>

            {/* Rank Card */}
            <div className="bg-gray-900 border border-gray-800 p-5 rounded-sm flex-shrink-0 min-w-[280px]">
              <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                <span>Reputation Tier</span>
                <span className="font-mono text-bronze uppercase font-semibold">{rank.badge} Tier {rank.tier}</span>
              </div>
              <div className="font-serif text-2xl text-white font-medium flex items-center gap-2">
                <span>{rank.title}</span>
              </div>

              {/* Points & Streak */}
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-800 text-xs">
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase tracking-wider">Score</span>
                  <span className="font-serif text-lg text-bronze font-semibold">{points} pts</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase tracking-wider">Cadence</span>
                  <span className="text-amber-400 font-semibold flex items-center gap-1">
                    <Flame size={13} /> {streakDays} Day Streak
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase tracking-wider">Badges</span>
                  <span className="text-white font-semibold flex items-center gap-1">
                    <Award size={13} /> {badges.filter(b => b.unlocked).length} / {badges.length}
                  </span>
                </div>
              </div>

              {/* Tier Progress Bar */}
              {nextRank && (
                <div className="mt-3.5 space-y-1">
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>Progress to {nextRank.title}</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-bronze transition-all duration-500 rounded-full"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Navigation Tabs Bar */}
          <div className="flex items-center gap-2 mt-10 overflow-x-auto no-scrollbar border-b border-gray-800 pb-1">
            <button
              onClick={() => handleTabChange('privileges')}
              className={`px-4 py-2 text-xs uppercase tracking-editorial font-medium rounded-sm transition-all whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'privileges'
                  ? 'bg-bronze text-white shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Trophy size={14} /> Privileges & Ranks
            </button>

            <button
              onClick={() => handleTabChange('architect')}
              className={`px-4 py-2 text-xs uppercase tracking-editorial font-medium rounded-sm transition-all whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'architect'
                  ? 'bg-bronze text-white shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Sparkles size={14} /> Regimen Architect
            </button>

            <button
              onClick={() => handleTabChange('inci')}
              className={`px-4 py-2 text-xs uppercase tracking-editorial font-medium rounded-sm transition-all whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'inci'
                  ? 'bg-bronze text-white shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Beaker size={14} /> INCI Decrypter
            </button>

            <button
              onClick={() => handleTabChange('vanity')}
              className={`px-4 py-2 text-xs uppercase tracking-editorial font-medium rounded-sm transition-all whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'vanity'
                  ? 'bg-bronze text-white shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Package size={14} /> Smart Vanity Shelf
            </button>

            <button
              onClick={() => handleTabChange('briefing')}
              className={`px-4 py-2 text-xs uppercase tracking-editorial font-medium rounded-sm transition-all whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'briefing'
                  ? 'bg-bronze text-white shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <FileText size={14} /> Bespoke Briefing {!isGold && <Lock size={12} className="text-gray-500" />}
            </button>
          </div>
        </div>
      </section>

      {/* Main Tab Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Tab 1: Privileges & Milestones */}
        {activeTab === 'privileges' && (
          <div className="space-y-10">
            {/* Unlocked Privileges Cards */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-serif text-2xl text-charcoal">Exclusive Salon Privileges</h3>
                <span className="text-xs text-charcoal-muted">
                  {privileges.filter(p => p.isUnlocked).length} of {privileges.length} Unlocked
                </span>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {privileges.map(priv => (
                  <div
                    key={priv.id}
                    className={`bg-white border rounded-sm p-5 space-y-4 flex flex-col justify-between transition-all ${
                      priv.isUnlocked
                        ? 'border-taupe/40 shadow-xs hover:border-bronze'
                        : 'border-dashed border-gray-300 opacity-80 bg-gray-50/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs mb-3">
                        <span className="text-2xl">{priv.icon}</span>
                        {priv.isUnlocked ? (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-editorial font-semibold px-2 py-0.5 bg-green-50 text-green-700 rounded-sm">
                            <CheckCircle2 size={11} /> Unlocked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-editorial font-semibold px-2 py-0.5 bg-gray-200 text-gray-700 rounded-sm">
                            <Lock size={11} /> Unlocks at {priv.requiredPoints} pts
                          </span>
                        )}
                      </div>

                      <h4 className="font-serif text-lg text-charcoal font-medium">{priv.title}</h4>
                      <p className="text-xs text-bronze font-medium mt-0.5">{priv.tagline}</p>
                      <p className="text-xs text-charcoal-light mt-2 leading-relaxed">{priv.description}</p>
                    </div>

                    <div className="pt-3 border-t border-taupe/20">
                      {priv.isUnlocked ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (priv.id === 'vault') navigate({ name: 'vault' });
                            else if (priv.id === 'analyzer') handleTabChange('architect');
                            else if (priv.actionTarget.startsWith('/')) window.location.href = priv.actionTarget;
                          }}
                          className="w-full py-2 bg-charcoal text-white hover:bg-bronze text-xs font-medium uppercase tracking-editorial rounded-sm transition-colors flex items-center justify-center gap-1"
                        >
                          <span>{priv.actionLabel}</span>
                          <ChevronRight size={13} />
                        </button>
                      ) : (
                        <div className="text-center py-2 text-xs text-charcoal-muted bg-gray-100 rounded-sm">
                          Need {priv.requiredPoints - points} more pts to access
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Achievement Badges Checklist */}
            <div className="bg-white border border-taupe/30 p-6 md:p-8 rounded-sm space-y-6">
              <div className="flex items-center justify-between border-b border-taupe/20 pb-4">
                <div>
                  <h3 className="font-serif text-xl text-charcoal">Reader Milestones & Badges</h3>
                  <p className="text-xs text-charcoal-muted">Earn points and unlock privileges by exploring long-form stories and active tools.</p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                {badges.map(badge => (
                  <div
                    key={badge.key}
                    className={`p-4 border rounded-sm flex items-start gap-3 transition-colors ${
                      badge.unlocked
                        ? 'border-bronze/40 bg-warm-ivory/40'
                        : 'border-taupe/20 bg-gray-50/40 opacity-75'
                    }`}
                  >
                    <span className="text-2xl flex-shrink-0">{badge.emoji}</span>
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-serif text-sm font-medium text-charcoal truncate">{badge.label}</span>
                        {badge.unlocked && (
                          <span className="text-[10px] text-green-700 bg-green-50 px-1.5 rounded-xs font-semibold">✓</span>
                        )}
                      </div>
                      <p className="text-xs text-charcoal-light leading-snug">{badge.description}</p>
                      <span className="text-[10px] text-bronze font-semibold uppercase tracking-editorial block pt-1">
                        +{badge.points} Points · {badge.requirement}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Regimen Architect */}
        {activeTab === 'architect' && (
          <RegimenArchitect />
        )}

        {/* Tab 3: INCI Decrypter */}
        {activeTab === 'inci' && (
          <InciDecrypter />
        )}

        {/* Tab 4: Smart Vanity Shelf */}
        {activeTab === 'vanity' && (
          <SmartVanityShelf />
        )}

        {/* Tab 5: Bespoke Intelligence Briefing */}
        {activeTab === 'briefing' && (
          <div className="space-y-8">
            <div className="bg-warm-ivory border border-taupe/30 p-6 md:p-8 rounded-sm">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-amber-100 text-amber-900 text-xs tracking-editorial uppercase font-medium rounded-full mb-3">
                  <FileText size={13} />
                  <span>Gold Connoisseur Exclusive · 500+ Pts Required</span>
                </div>
                <h2 className="font-serif text-2xl md:text-3xl text-charcoal mb-2">
                  Bespoke Editorial Intelligence Briefing
                </h2>
                <p className="text-sm text-charcoal-light leading-relaxed">
                  The system automatically digests peer-reviewed clinical literature, industry formulation launches, and active ingredient debates to assemble a private, personalized executive intelligence report.
                </p>
              </div>
            </div>

            {!isGold ? (
              <div className="bg-white border border-taupe/30 p-12 text-center rounded-sm space-y-4">
                <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center mx-auto">
                  <Lock size={22} />
                </div>
                <h3 className="font-serif text-2xl text-charcoal">Locked for Gold Connoisseurs</h3>
                <p className="text-sm text-charcoal-muted max-w-md mx-auto">
                  You currently have <strong className="text-charcoal">{points} points</strong>. Reach 500 points (Tier 3) to unlock automated personalized executive briefings delivered directly to your inbox or web push.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleTabChange('architect')}
                    className="px-6 py-2.5 bg-bronze text-white text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-bronze-dark transition-colors"
                  >
                    Build a Regimen to Earn +100 Points
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-taupe/30 p-6 rounded-sm space-y-6">
                <div className="border-b border-taupe/20 pb-4">
                  <h3 className="font-serif text-xl text-charcoal">Your Custom Radar Topics</h3>
                  <p className="text-xs text-charcoal-muted">Select active research domains for your personalized weekly compilation.</p>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  {['Copper Tripeptide-1 Matrix Remodeling', 'Next-Gen Retinoid Esters (HPR & Retinal)', 'Stratum Corneum TEWL & Winter Ceramide Delivery', 'Photoprotection: Iron Oxides & Visible Light Absorption'].map((topic, i) => (
                    <div key={i} className="p-4 border border-taupe/30 rounded-sm bg-warm-ivory/30 space-y-2">
                      <span className="text-[10px] text-bronze uppercase tracking-editorial font-semibold">Priority Radar #{i + 1}</span>
                      <h4 className="font-serif text-base text-charcoal font-medium">{topic}</h4>
                      <p className="text-xs text-charcoal-light">System tracks newly published clinical data and editorial teardowns.</p>
                    </div>
                  ))}
                </div>

                <div className="p-4 bg-green-50 border border-green-200 rounded-sm text-xs text-green-800 flex items-center justify-between">
                  <span>✓ Your Bespoke Executive Briefing is scheduled for automatic Sunday delivery.</span>
                  <button
                    type="button"
                    onClick={() => alert('Generating on-demand intelligence dossier...')}
                    className="px-4 py-1.5 bg-green-800 text-white rounded-sm font-medium hover:bg-green-900 transition-colors"
                  >
                    Download Dossier (PDF)
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

