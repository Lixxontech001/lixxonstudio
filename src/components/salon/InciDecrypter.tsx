import { useState } from 'react';
import { useSalon } from '../../hooks/useSalon';
import { CULT_FORMULAS } from '../../lib/salonEngine';
import type { InciReport } from '../../types/salon';
import {
  Search, Sparkles, CheckCircle2, AlertTriangle,
  Beaker, Plus
} from 'lucide-react';

export default function InciDecrypter() {
  const { decodeInci, addVanityItem } = useSalon();
  const [inputText, setInputText] = useState('');
  const [productTitle, setProductTitle] = useState('');
  const [report, setReport] = useState<InciReport | null>(null);
  const [addedToVanity, setAddedToVanity] = useState(false);

  const handleAnalyze = (textToAnalyze?: string, title?: string) => {
    const raw = textToAnalyze || inputText;
    if (!raw.trim()) return;
    const rep = decodeInci(raw, title || productTitle || 'Analyzed Formula');
    setReport(rep);
    setAddedToVanity(false);
  };

  const handleSelectCult = (formula: typeof CULT_FORMULAS[number]) => {
    setInputText(formula.inci);
    setProductTitle(`${formula.brand} - ${formula.name}`);
    handleAnalyze(formula.inci, `${formula.brand} - ${formula.name}`);
  };

  const handleSaveToVanity = () => {
    if (!report) return;
    addVanityItem({
      product_name: report.productTitle || 'Analyzed Cosmetic Product',
      brand: 'Decoded Brand',
      category: 'treatment',
      opened_on: new Date().toISOString().slice(0, 10),
      pao_months: 6,
      key_actives: report.starActives.map(a => a.name),
      safety_score: report.overallScore,
    });
    setAddedToVanity(true);
    setTimeout(() => setAddedToVanity(false), 3000);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-warm-ivory border border-taupe/30 p-6 md:p-8 rounded-sm">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-bronze/10 text-bronze text-xs tracking-editorial uppercase font-medium rounded-full mb-3">
          <Beaker size={13} />
          <span>Cosmetic Decrypter & Safety Scanner · Bronze+ Privileges</span>
        </div>
        <h2 className="font-serif text-2xl md:text-3xl text-charcoal mb-2">
          INCI Clinical Ingredient Scanner
        </h2>
        <p className="text-sm text-charcoal-light max-w-2xl leading-relaxed">
          Paste any cosmetic ingredient deck or product packaging text. The system parses every compound, calculates pore-clogging comedogenicity, verifies peer-reviewed clinical evidence grades, and flags volatile sensitizers.
        </p>

        {/* Cult Formula Presets */}
        <div className="mt-4 pt-4 border-t border-taupe/20">
          <span className="text-[11px] font-semibold tracking-editorial uppercase text-charcoal-muted block mb-2">
            Or test against iconic cult formulations:
          </span>
          <div className="flex flex-wrap gap-2">
            {CULT_FORMULAS.map(f => (
              <button
                key={f.name}
                type="button"
                onClick={() => handleSelectCult(f)}
                className="px-3 py-1 bg-white border border-taupe/30 hover:border-bronze text-xs text-charcoal rounded-sm transition-colors text-left"
              >
                <span className="font-medium">{f.name}</span> <span className="text-charcoal-muted">({f.brand})</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Input Deck */}
      <div className="bg-white border border-taupe/30 p-6 rounded-sm space-y-4">
        <div>
          <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1.5">
            Product Name (Optional)
          </label>
          <input
            type="text"
            value={productTitle}
            onChange={e => setProductTitle(e.target.value)}
            placeholder="e.g. SkinCeuticals Triple Lipid Restore"
            className="w-full px-3.5 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1.5">
            Paste Full INCI Ingredients List
          </label>
          <textarea
            rows={4}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Aqua, Glycerin, Niacinamide, Squalane, Ceramide NP, Sodium Hyaluronate, Tocopherol..."
            className="w-full p-3.5 border border-taupe/40 rounded-sm text-sm font-mono text-charcoal focus:outline-hidden focus:border-bronze"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => handleAnalyze()}
            disabled={!inputText.trim()}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-bronze text-white text-xs font-medium tracking-editorial uppercase rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50"
          >
            <Search size={14} /> Scan & Decrypt Ingredients (+25 Pts)
          </button>
        </div>
      </div>

      {/* Analysis Report */}
      {report && (
        <div className="space-y-6">
          {/* Verdict Scorecard */}
          <div className="bg-white border border-taupe/30 p-6 rounded-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-taupe/20 pb-6">
              <div>
                <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted font-semibold block mb-1">
                  Clinical Formulation Verdict
                </span>
                <h3 className="font-serif text-2xl text-charcoal flex items-center gap-3">
                  <span>{report.verdict}</span>
                  <span className={`text-xs px-2.5 py-1 rounded-sm font-sans font-medium uppercase tracking-wider ${
                    report.overallScore >= 85
                      ? 'bg-green-100 text-green-800'
                      : report.overallScore >= 65
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {report.overallScore}/100 Score
                  </span>
                </h3>
                <p className="text-sm text-charcoal-light mt-1 max-w-2xl leading-relaxed">
                  {report.verdictSummary}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleSaveToVanity}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-charcoal text-white text-xs font-medium rounded-sm hover:bg-bronze transition-colors"
                >
                  <Plus size={13} /> Add to Smart Vanity
                </button>
              </div>
            </div>

            {addedToVanity && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 text-green-800 text-xs rounded-sm flex items-center gap-2">
                <CheckCircle2 size={15} /> Added to your Smart Vanity Shelf!
              </div>
            )}

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6">
              <div className="p-3 bg-warm-ivory/50 border border-taupe/20 rounded-sm">
                <span className="text-[10px] uppercase tracking-editorial text-charcoal-muted block">Total Ingredients</span>
                <span className="font-serif text-xl text-charcoal">{report.totalIngredients}</span>
              </div>
              <div className="p-3 bg-warm-ivory/50 border border-taupe/20 rounded-sm">
                <span className="text-[10px] uppercase tracking-editorial text-charcoal-muted block">Star Clinical Actives</span>
                <span className="font-serif text-xl text-bronze">{report.starActives.length}</span>
              </div>
              <div className="p-3 bg-warm-ivory/50 border border-taupe/20 rounded-sm">
                <span className="text-[10px] uppercase tracking-editorial text-charcoal-muted block">Comedogenic Peak</span>
                <span className={`font-serif text-xl ${report.comedogenicMax >= 3 ? 'text-amber-600' : 'text-green-700'}`}>
                  {report.comedogenicMax} / 5
                </span>
              </div>
              <div className="p-3 bg-warm-ivory/50 border border-taupe/20 rounded-sm">
                <span className="text-[10px] uppercase tracking-editorial text-charcoal-muted block">Sensitizer Alerts</span>
                <span className={`font-serif text-xl ${report.flaggedConcerns.length > 0 ? 'text-red-600' : 'text-green-700'}`}>
                  {report.flaggedConcerns.length}
                </span>
              </div>
            </div>
          </div>

          {/* Star Actives */}
          {report.starActives.length > 0 && (
            <div className="bg-white border border-taupe/30 p-6 rounded-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-taupe/20 pb-3">
                <Sparkles size={16} className="text-bronze" />
                <h4 className="font-serif text-base text-charcoal font-medium">
                  Verified Star Actives ({report.starActives.length})
                </h4>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                {report.starActives.map(act => (
                  <div key={act.name} className="p-3.5 bg-warm-ivory/40 border border-taupe/20 rounded-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-charcoal">{act.name}</span>
                      <span className="text-[10px] bg-bronze/10 text-bronze font-mono px-2 py-0.5 rounded-sm font-semibold">
                        Grade {act.clinicalEvidence} Evidence
                      </span>
                    </div>
                    <p className="text-xs text-bronze font-medium">{act.purpose}</p>
                    <p className="text-xs text-charcoal-light leading-relaxed">{act.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Flagged Concerns */}
          {report.flaggedConcerns.length > 0 && (
            <div className="bg-red-50/40 border border-red-200/60 p-6 rounded-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-red-200/50 pb-3">
                <AlertTriangle size={16} className="text-red-700" />
                <h4 className="font-serif text-base text-red-900 font-medium">
                  Irritant & Sensitivity Alerts ({report.flaggedConcerns.length})
                </h4>
              </div>

              <div className="space-y-3">
                {report.flaggedConcerns.map(item => (
                  <div key={item.name} className="p-3 bg-white border border-red-200 rounded-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-red-900">{item.name}</span>
                      {item.comedogenicRating >= 3 && (
                        <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-sm font-medium">
                          Comedogenic Rating {item.comedogenicRating}/5
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-red-700">{item.irritantReason || item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All Ingredients Breakdown */}
          <div className="bg-white border border-taupe/30 p-6 rounded-sm space-y-4">
            <h4 className="font-serif text-base text-charcoal font-medium border-b border-taupe/20 pb-3">
              Full Deck Breakdown ({report.allIngredients.length} Ingredients)
            </h4>

            <div className="divide-y divide-taupe/20 max-h-80 overflow-y-auto">
              {report.allIngredients.map((item, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-charcoal-muted font-mono w-6">{idx + 1}.</span>
                    <span className={`font-medium ${item.isStarActive ? 'text-bronze' : 'text-charcoal'}`}>
                      {item.name}
                    </span>
                  </div>
                  <span className="text-charcoal-muted truncate max-w-[200px] text-right">
                    {item.purpose}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

