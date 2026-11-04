import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Lock, Sparkles, ArrowRight, ShieldCheck
} from 'lucide-react';
import { useAchievements } from '../../hooks/useAchievements';
import { Link } from '../../context/NavigationContext';

interface VaultEntry {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  readTime: string;
  dossierSummary: string;
  dateAdded: string;
}

const VAULT_ARCHIVES: VaultEntry[] = [
  {
    id: 'vault-1',
    title: 'The Anatomy of 0.1% Retinaldehyde & Lipid Nanosomes',
    subtitle: 'Clinical degradation kinetics and cellular retinoic acid receptor affinity.',
    category: 'Formulation Science',
    readTime: '12 min dossier',
    dossierSummary: 'An investigative formulation teardown detailing why retinal requires only a single metabolic conversion step compared to retinol, with complete stability testing across lipid vesicular carriers.',
    dateAdded: 'November 2026',
  },
  {
    id: 'vault-2',
    title: 'The 3:1:1 Physiological Barrier Ratio Protocol',
    subtitle: 'Ceramides, Cholesterol, and Free Fatty Acids in lamellar membrane reconstruction.',
    category: 'Dermatological Protocol',
    readTime: '9 min dossier',
    dossierSummary: 'A clinical deep dive exploring equimolar synthetic membrane repairs, lipid phase transitions, and why unbalanced ceramides without cholesterol actually increase trans-epidermal water loss.',
    dateAdded: 'October 2026',
  },
  {
    id: 'vault-3',
    title: 'Cellular Osmolytes: The Ectoin & Trehalose Frontier',
    subtitle: 'Next-generation extremolyte photoprotection beyond traditional antioxidants.',
    category: 'Molecule Dossier',
    readTime: '14 min dossier',
    dossierSummary: 'How halophilic microorganisms survive lethal salinity and UV radiation through hydration shell stabilization, and how cosmetic chemists adapt ectoin to shield Langerhans skin cells.',
    dateAdded: 'October 2026',
  },
];

export default function VaultPage() {
  const { points, rank, hasPrivilege, unlockBadge } = useAchievements();
  const isUnlocked = hasPrivilege('vault') || points >= 200;

  useEffect(() => {
    window.scrollTo(0, 0);
    if (isUnlocked) {
      unlockBadge('vault_explorer');
    }
  }, [isUnlocked, unlockBadge]);

  return (
    <main className="min-h-screen bg-[#FBF9F5] dark:bg-[#141414] text-charcoal dark:text-white">
      <Helmet>
        <title>The Secret Editorial Vault | Lixxon Studio</title>
        <meta name="description" content="Exclusive clinical formulation dossiers and salon archives reserved for Lixxon Studio scholars." />
      </Helmet>

      {/* Header Banner */}
      <section className="container-wide pt-14 pb-10 border-b border-taupe/30 dark:border-white/10">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] tracking-ultra-wide uppercase font-semibold text-bronze flex items-center gap-1.5">
              <Sparkles size={13} /> The Salon Archives
            </span>
            <span className="text-[9px] uppercase tracking-editorial bg-charcoal text-white dark:bg-white dark:text-charcoal px-2.5 py-0.5 rounded-full font-mono">
              Silver Tier+ Exclusive
            </span>
          </div>

          <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-light leading-[1.05]">
            The Secret Editorial Vault
          </h1>
          <p className="text-charcoal-muted dark:text-white/60 text-lg mt-4 leading-relaxed font-light">
            Unreleased formulation teardowns, molecular stability dossiers, and salon masterclasses unlocked by dedicated readers.
          </p>
        </div>
      </section>

      {/* Unlocked Content vs Locked Gate */}
      <section className="container-wide py-12">
        {isUnlocked ? (
          <div className="space-y-8">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/30 rounded-sm flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                <ShieldCheck size={16} className="text-emerald-600" />
                <span>
                  Welcome, <strong>{rank.title}</strong>. Your reader status grants permanent access to these restricted dossiers.
                </span>
              </div>
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-mono">
                {points.toLocaleString()} pts
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {VAULT_ARCHIVES.map(item => (
                <article
                  key={item.id}
                  className="bg-white dark:bg-[#1E1E1E] border border-taupe/40 dark:border-white/10 rounded-sm p-6 flex flex-col justify-between luxury-shadow hover:luxury-shadow-lg transition-all group"
                >
                  <div>
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-editorial text-bronze font-medium mb-3">
                      <span>{item.category}</span>
                      <span className="text-charcoal-muted dark:text-white/40 font-mono">{item.readTime}</span>
                    </div>

                    <h2 className="font-serif text-xl font-normal group-hover:text-bronze transition-colors leading-snug">
                      {item.title}
                    </h2>

                    <p className="text-xs text-charcoal-muted dark:text-white/60 mt-2 font-medium">
                      {item.subtitle}
                    </p>

                    <p className="text-xs text-charcoal-muted/80 dark:text-white/50 mt-3 leading-relaxed">
                      {item.dossierSummary}
                    </p>
                  </div>

                  <div className="pt-6 mt-6 border-t border-taupe/30 dark:border-white/10 flex items-center justify-between">
                    <span className="text-[10px] text-charcoal-muted dark:text-white/40 font-mono">
                      {item.dateAdded}
                    </span>
                    <button
                      type="button"
                      onClick={() => alert(`Opening Vault Dossier: "${item.title}". Full PDF rendered.`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bronze text-white text-[11px] tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-colors shadow-xs"
                    >
                      <span>Read Dossier</span>
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          /* Locked State Preview */
          <div className="max-w-2xl mx-auto py-12 px-6 bg-white dark:bg-[#1E1E1E] border border-taupe/40 dark:border-white/10 rounded-sm text-center luxury-shadow-lg">
            <div className="w-16 h-16 rounded-full bg-bronze/10 text-bronze flex items-center justify-center mx-auto mb-5">
              <Lock size={28} strokeWidth={1.5} />
            </div>

            <h2 className="font-serif text-3xl font-light mb-3">
              This Archive is Reserved for Silver Scholars
            </h2>
            <p className="text-charcoal-muted dark:text-white/60 text-sm leading-relaxed max-w-md mx-auto mb-6">
              You currently have <strong>{points} points</strong>. Reach <strong>200 points</strong> (Silver Scholar) by reading articles, exploring trending debates, and building your knowledge ritual to unlock The Vault.
            </p>

            {/* Progress Bar */}
            <div className="max-w-xs mx-auto mb-8 space-y-1.5">
              <div className="flex justify-between text-xs text-charcoal-muted dark:text-white/50">
                <span>Current: {points} pts</span>
                <span>Required: 200 pts</span>
              </div>
              <div className="w-full h-2.5 bg-taupe/20 dark:bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-bronze rounded-full"
                  style={{ width: `${Math.min(100, Math.round((points / 200) * 100))}%` }}
                />
              </div>
              <p className="text-[11px] text-bronze font-medium">
                Only {Math.max(0, 200 - points)} more points needed!
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to={{ name: 'trending' }}
                className="px-6 py-3 bg-charcoal text-white dark:bg-white dark:text-charcoal text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze hover:text-white transition-all duration-300"
              >
                Read Stories &amp; Earn Points
              </Link>
              <Link
                to={{ name: 'home', page: 1 }}
                className="px-6 py-3 border border-taupe/50 dark:border-white/20 text-xs tracking-editorial uppercase font-medium rounded-sm hover:border-bronze transition-colors"
              >
                Explore Magazine
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
