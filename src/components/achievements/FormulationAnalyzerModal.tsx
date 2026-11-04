import { useState } from 'react';
import {
  X, Sparkles, AlertTriangle, CheckCircle2, ShieldCheck
} from 'lucide-react';
import { useAchievements } from '../../hooks/useAchievements';

interface FormulationAnalyzerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Ingredient {
  id: string;
  name: string;
  category: 'Retinoid' | 'Acid' | 'Antioxidant' | 'Hydrator' | 'Peptide';
  amPm: 'AM' | 'PM' | 'Both';
}

const INGREDIENTS: Ingredient[] = [
  { id: 'retinol', name: 'Retinol / Retinal', category: 'Retinoid', amPm: 'PM' },
  { id: 'vit_c', name: 'L-Ascorbic Acid (Vitamin C)', category: 'Antioxidant', amPm: 'AM' },
  { id: 'aha', name: 'Glycolic / Lactic Acid (AHA)', category: 'Acid', amPm: 'PM' },
  { id: 'bha', name: 'Salicylic Acid (BHA)', category: 'Acid', amPm: 'Both' },
  { id: 'copper_peptides', name: 'Copper Tripeptide-1', category: 'Peptide', amPm: 'Both' },
  { id: 'niacinamide', name: 'Niacinamide (Vitamin B3)', category: 'Antioxidant', amPm: 'Both' },
  { id: 'hyaluronic', name: 'Hyaluronic Acid Multi-Weight', category: 'Hydrator', amPm: 'Both' },
  { id: 'ceramides', name: 'Ceramides Complex NP/AP/EOP', category: 'Hydrator', amPm: 'Both' },
];

export default function FormulationAnalyzerModal({ isOpen, onClose }: FormulationAnalyzerModalProps) {
  const { unlockBadge } = useAchievements();
  const [selected, setSelected] = useState<string[]>(['retinol', 'vit_c']);

  if (!isOpen) return null;

  const toggleIngredient = (id: string) => {
    setSelected(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      // Trigger formulation master badge when experimenting with 3+ ingredients
      if (next.length >= 3) {
        unlockBadge('formulation_master');
      }
      return next;
    });
  };

  // Conflict analysis
  const hasRetinol = selected.includes('retinol');
  const hasVitC = selected.includes('vit_c');
  const hasAha = selected.includes('aha');
  const hasPeptides = selected.includes('copper_peptides');
  const hasBha = selected.includes('bha');

  const warnings: string[] = [];
  const synergies: string[] = [];

  if (hasRetinol && hasAha) {
    warnings.push('Retinol + Glycolic Acid (AHA): High risk of moisture barrier damage. Do not layer in the same PM ritual; alternate nights instead.');
  }
  if (hasVitC && hasPeptides) {
    warnings.push('Pure Ascorbic Acid + Copper Peptides: Free copper ions oxidize unbuffered Vitamin C, neutralizing active antioxidant potential.');
  }
  if (hasRetinol && hasBha) {
    warnings.push('Retinol + Salicylic Acid: Simultaneous application can provoke erythema and desquamation in sensitive skin types.');
  }

  if (hasVitC && selected.includes('niacinamide')) {
    synergies.push('Vitamin C + Niacinamide: Modern encapsulated formulations work harmoniously to inhibit melanosome transfer and promote collagen synthesis.');
  }
  if (selected.includes('hyaluronic') && selected.includes('ceramides')) {
    synergies.push('Hyaluronic Acid + Ceramides: Optimal humectant-occlusive lipid barrier synergy for prolonged trans-epidermal moisture lock.');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-charcoal/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Box */}
      <div className="relative w-full max-w-xl bg-white dark:bg-[#1E1E1E] rounded-sm shadow-2xl border border-taupe/40 dark:border-white/10 overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-taupe/30 dark:border-white/10 bg-porcelain dark:bg-[#181818] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-bronze/10 text-bronze flex items-center justify-center flex-shrink-0">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="font-serif text-xl text-charcoal dark:text-white font-normal">
                Salon Formulation Concierge
              </h3>
              <p className="text-xs text-charcoal-muted dark:text-white/50">
                Active ingredient compatibility &amp; routine cadence auditor
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-charcoal-muted hover:text-charcoal dark:text-white/60 dark:hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs uppercase tracking-editorial font-medium text-charcoal-muted dark:text-white/50 mb-3">
              Select Actives in Your Proposed Routine:
            </label>
            <div className="grid grid-cols-2 gap-2">
              {INGREDIENTS.map(item => {
                const active = selected.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleIngredient(item.id)}
                    className={`p-3 text-left border rounded-sm transition-all text-xs flex items-center justify-between ${
                      active
                        ? 'border-bronze bg-bronze/10 text-charcoal dark:text-white font-medium'
                        : 'border-taupe/40 bg-white dark:bg-white/5 text-charcoal-muted hover:border-bronze/40'
                    }`}
                  >
                    <div>
                      <p className="font-serif">{item.name}</p>
                      <span className="text-[10px] text-bronze uppercase tracking-editorial">{item.amPm}</span>
                    </div>
                    {active && <CheckCircle2 size={14} className="text-bronze flex-shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Analysis Results */}
          <div className="space-y-4 pt-2 border-t border-taupe/30 dark:border-white/10">
            <h4 className="text-xs uppercase tracking-editorial font-semibold text-charcoal dark:text-white flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-bronze" /> Clinical Analysis
            </h4>

            {warnings.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 p-4 rounded-sm space-y-2">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5 uppercase tracking-editorial">
                  <AlertTriangle size={14} /> Contraindications Detected ({warnings.length})
                </p>
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    • {w}
                  </p>
                ))}
              </div>
            )}

            {synergies.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 p-4 rounded-sm space-y-2">
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 uppercase tracking-editorial">
                  <CheckCircle2 size={14} /> Synergistic Pairings
                </p>
                {synergies.map((s, i) => (
                  <p key={i} className="text-xs text-emerald-900 dark:text-emerald-200 leading-relaxed">
                    • {s}
                  </p>
                ))}
              </div>
            )}

            {warnings.length === 0 && synergies.length === 0 && (
              <p className="text-xs text-charcoal-muted dark:text-white/60 italic p-3 bg-taupe-light/30 rounded-sm">
                Select ingredients above to evaluate chemical interactions and optimal application cadence.
              </p>
            )}

            {/* Cadence Protocol */}
            <div className="p-4 bg-porcelain dark:bg-white/5 border border-taupe/30 dark:border-white/10 rounded-sm text-xs space-y-2">
              <p className="font-semibold text-charcoal dark:text-white uppercase tracking-editorial text-[10px]">
                Recommended Application Protocol:
              </p>
              <p className="text-charcoal-muted dark:text-white/70 leading-relaxed">
                <strong>AM Routine:</strong> Cleanse → Antioxidants (Vitamin C) → Hydrators → Broad Spectrum SPF 50.<br />
                <strong>PM Routine:</strong> Double Cleanse → Cell Renewal Actives (Retinol or AHA on alternating nights) → Lipid Barrier Barrier Cream.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-porcelain dark:bg-[#181818] border-t border-taupe/30 dark:border-white/10 flex items-center justify-between text-xs">
          <span className="text-charcoal-muted dark:text-white/40 text-[11px]">
            Salon Privilege Unlocked · 100+ points
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-charcoal text-white dark:bg-white dark:text-charcoal text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
