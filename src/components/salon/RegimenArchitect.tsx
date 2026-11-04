import { useState } from 'react';
import type { SkinType, ClimateType, SkinConcern } from '../../types/salon';
import { useSalon } from '../../hooks/useSalon';
import { useAchievements } from '../../hooks/useAchievements';
import {
  Sparkles, Calendar, Clock, CheckCircle2, Plus,
  Layers, RefreshCw, BookOpen
} from 'lucide-react';

const SKIN_TYPES: { id: SkinType; label: string; desc: string }[] = [
  { id: 'combination', label: 'Combination', desc: 'Oily T-zone, dry cheeks' },
  { id: 'dry', label: 'Dry / Dehydrated', desc: 'Tightness, flaky barrier, low sebum' },
  { id: 'oily', label: 'Oily / Congested', desc: 'Excess shine, enlarged pores, acne prone' },
  { id: 'sensitive', label: 'Sensitive / Reactive', desc: 'Prone to flushing, stinging, rosacea' },
  { id: 'normal', label: 'Normal / Balanced', desc: 'Even texture, resilient lipid barrier' },
];

const CLIMATES: { id: ClimateType; label: string }[] = [
  { id: 'temperate', label: 'Temperate / Mild' },
  { id: 'humid', label: 'Humid & Tropical' },
  { id: 'arid', label: 'Arid / Desert Dry' },
  { id: 'cold', label: 'Cold / Harsh Winter' },
  { id: 'urban', label: 'Dense Urban / High Pollution' },
];

const CONCERNS: { id: SkinConcern; label: string }[] = [
  { id: 'barrier_repair', label: 'Lipid Barrier Repair' },
  { id: 'hyperpigmentation', label: 'Hyperpigmentation & Dark Spots' },
  { id: 'fine_lines', label: 'Fine Lines & Collagen Loss' },
  { id: 'acne_blemishes', label: 'Breakouts & Congestion' },
  { id: 'texture_pores', label: 'Rough Texture & Pores' },
  { id: 'erythema_redness', label: 'Redness & Erythema' },
  { id: 'dullness', label: 'Dullness & Radiance Boost' },
  { id: 'deep_hydration', label: 'Deep Trans-Epidermal Hydration' },
];

export default function RegimenArchitect() {
  const { regimen, createRegimen, cloneHouseProtocol, houseProtocols, exportToCalendar, addVanityItem } = useSalon();
  const { rank } = useAchievements();

  const [selectedSkinType, setSelectedSkinType] = useState<SkinType>(regimen?.skin_type || 'combination');
  const [selectedClimate, setSelectedClimate] = useState<ClimateType>(regimen?.climate || 'temperate');
  const [selectedConcerns, setSelectedConcerns] = useState<SkinConcern[]>(regimen?.concerns || ['barrier_repair', 'fine_lines']);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showProtocolsModal, setShowProtocolsModal] = useState(false);
  const [addedVanitySuccess, setAddedVanitySuccess] = useState(false);

  const toggleConcern = (concern: SkinConcern) => {
    setSelectedConcerns(prev =>
      prev.includes(concern)
        ? prev.filter(c => c !== concern)
        : prev.length < 4
        ? [...prev, concern]
        : prev
    );
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      createRegimen(selectedSkinType, selectedClimate, selectedConcerns);
      setIsGenerating(false);
    }, 600);
  };

  const handleSyncAllToVanity = () => {
    if (!regimen) return;
    const allSteps = [...regimen.morning_steps, ...regimen.evening_steps];
    allSteps.forEach(step => {
      addVanityItem({
        product_name: step.name,
        brand: 'Studio Curated',
        category: step.type.toLowerCase().includes('cleanse') ? 'cleanser' :
                  step.type.toLowerCase().includes('spf') || step.type.toLowerCase().includes('photoprotection') ? 'sunscreen' :
                  step.type.toLowerCase().includes('active') || step.type.toLowerCase().includes('antioxidant') ? 'serum' : 'moisturizer',
        opened_on: new Date().toISOString().slice(0, 10),
        pao_months: 6,
        key_actives: step.active ? [step.active] : [],
      });
    });
    setAddedVanitySuccess(true);
    setTimeout(() => setAddedVanitySuccess(false), 4000);
  };

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="bg-warm-ivory border border-taupe/30 p-6 md:p-8 rounded-sm relative overflow-hidden">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-bronze/10 text-bronze text-xs tracking-editorial uppercase font-medium rounded-full mb-3">
            <Sparkles size={13} />
            <span>Automated Regimen Architect · Silver Scholar Tier</span>
          </div>
          <h2 className="font-serif text-2xl md:text-3xl text-charcoal mb-2">
            Clinical Skin-Cycling Protocol Builder
          </h2>
          <p className="text-sm text-charcoal-light leading-relaxed">
            The system analyzes your skin typology, local environmental climate, and biological concerns to synthesize a conflict-free AM/PM protocol with exact pH layering wait times and 7-day active cycling.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowProtocolsModal(true)}
            className="inline-flex items-center gap-1.5 text-xs text-bronze hover:text-bronze-dark font-medium underline underline-offset-4 transition-colors"
          >
            <BookOpen size={14} /> Browse {houseProtocols.length} Curated House Protocols
          </button>
        </div>
      </div>

      {/* Input Parameters */}
      <div className="bg-white border border-taupe/30 p-6 rounded-sm space-y-6">
        <div>
          <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-3">
            1. Select Your Cutaneous Typology
          </label>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            {SKIN_TYPES.map(st => (
              <button
                key={st.id}
                type="button"
                onClick={() => setSelectedSkinType(st.id)}
                className={`p-3.5 text-left border rounded-sm transition-all ${
                  selectedSkinType === st.id
                    ? 'border-bronze bg-bronze/5 shadow-xs'
                    : 'border-taupe/30 hover:border-taupe/60'
                }`}
              >
                <div className="font-medium text-sm text-charcoal">{st.label}</div>
                <div className="text-xs text-charcoal-muted mt-0.5">{st.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-3">
            2. Local Environmental Climate
          </label>
          <div className="flex flex-wrap gap-2">
            {CLIMATES.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedClimate(c.id)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                  selectedClimate === c.id
                    ? 'bg-charcoal text-white border-charcoal font-medium'
                    : 'border-taupe/40 text-charcoal-light hover:border-charcoal'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-3">
            3. Target Skin Goals & Concerns (Select up to 4)
          </label>
          <div className="flex flex-wrap gap-2">
            {CONCERNS.map(c => {
              const active = selectedConcerns.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleConcern(c.id)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                    active
                      ? 'bg-bronze text-white border-bronze font-medium'
                      : 'border-taupe/40 text-charcoal-light hover:border-bronze/50'
                  }`}
                >
                  {active && '✓ '} {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between border-t border-taupe/20">
          <div className="text-xs text-charcoal-muted">
            Current Tier: <strong className="text-charcoal font-medium">{rank.title}</strong>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-bronze text-white text-xs font-medium tracking-editorial uppercase rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <RefreshCw size={14} className="animate-spin" /> Synthesizing Formulations...
              </>
            ) : (
              <>
                <Sparkles size={14} /> Generate Bespoke Protocol (+100 Pts)
              </>
            )}
          </button>
        </div>
      </div>

      {/* Generated Regimen Display */}
      {regimen && (
        <div className="space-y-6">
          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 border border-taupe/30 rounded-sm">
            <div>
              <h3 className="font-serif text-lg text-charcoal flex items-center gap-2">
                <span>{regimen.title}</span>
                <span className="text-[10px] tracking-editorial uppercase px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded-sm">
                  Synergy {regimen.synergy_score}%
                </span>
              </h3>
              <p className="text-xs text-charcoal-muted mt-0.5">
                Calibrated for {regimen.skin_type} skin in {regimen.climate} climate.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={exportToCalendar}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-taupe/40 text-xs font-medium text-charcoal hover:border-bronze hover:text-bronze rounded-sm transition-colors"
                title="Download .ics file to add AM/PM routine alarms to Apple/Google Calendar"
              >
                <Calendar size={13} className="text-bronze" /> Add to Calendar (.ics)
              </button>

              <button
                type="button"
                onClick={handleSyncAllToVanity}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-charcoal text-white text-xs font-medium rounded-sm hover:bg-bronze transition-colors"
              >
                <Plus size={13} /> Add Steps to Smart Vanity
              </button>
            </div>
          </div>

          {addedVanitySuccess && (
            <div className="p-3 bg-green-50 border border-green-200 text-green-800 text-xs rounded-sm flex items-center gap-2">
              <CheckCircle2 size={16} /> All protocol steps were saved to your Smart Vanity Shelf with freshness tracking!
            </div>
          )}

          {/* AM & PM Protocol Columns */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* AM Routine */}
            <div className="bg-white border border-taupe/30 rounded-sm p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-taupe/20 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-amber-500 font-serif text-lg">☀️</span>
                  <h4 className="font-serif text-base text-charcoal font-medium">Morning Protocol (AM)</h4>
                </div>
                <span className="text-[11px] text-charcoal-muted">Defend & Shield</span>
              </div>

              <div className="space-y-3">
                {regimen.morning_steps.map(step => (
                  <div key={step.step} className="p-3 bg-warm-ivory/60 border border-taupe/20 rounded-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] tracking-editorial uppercase font-semibold text-bronze">
                        Step {step.step} · {step.type}
                      </span>
                      {step.ph && (
                        <span className="text-[10px] text-charcoal-muted font-mono">pH {step.ph}</span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-charcoal">{step.name}</div>
                    {step.notes && (
                      <p className="text-xs text-charcoal-light italic">{step.notes}</p>
                    )}
                    {step.wait ? (
                      <div className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-sm mt-1">
                        <Clock size={11} /> Wait {step.wait} min for full absorption
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* PM Routine */}
            <div className="bg-white border border-taupe/30 rounded-sm p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-taupe/20 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-indigo-400 font-serif text-lg">🌙</span>
                  <h4 className="font-serif text-base text-charcoal font-medium">Evening Protocol (PM)</h4>
                </div>
                <span className="text-[11px] text-charcoal-muted">Repair & Cellular Reset</span>
              </div>

              <div className="space-y-3">
                {regimen.evening_steps.map(step => (
                  <div key={step.step} className="p-3 bg-warm-ivory/60 border border-taupe/20 rounded-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] tracking-editorial uppercase font-semibold text-bronze">
                        Step {step.step} · {step.type}
                      </span>
                      {step.ph && (
                        <span className="text-[10px] text-charcoal-muted font-mono">pH {step.ph}</span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-charcoal">{step.name}</div>
                    {step.notes && (
                      <p className="text-xs text-charcoal-light italic">{step.notes}</p>
                    )}
                    {step.wait ? (
                      <div className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-sm mt-1">
                        <Clock size={11} /> Wait {step.wait} min before next step
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 7-Day Skin-Cycling Cadence Calendar */}
          <div className="bg-white border border-taupe/30 rounded-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-taupe/20 pb-3">
              <div>
                <h4 className="font-serif text-base text-charcoal font-medium flex items-center gap-2">
                  <Layers size={16} className="text-bronze" /> 7-Day Skin-Cycling Cadence
                </h4>
                <p className="text-xs text-charcoal-muted">
                  Prevents over-exfoliation and retinoid irritation by cycling active nights with lipid barrier recovery nights.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Object.entries(regimen.weekly_schedule).map(([day, task]) => (
                <div key={day} className="p-3 border border-taupe/20 rounded-sm bg-warm-ivory/40">
                  <span className="text-[10px] font-semibold tracking-editorial uppercase text-charcoal-muted block">
                    {day}
                  </span>
                  <span className="text-xs text-charcoal font-medium mt-1 block">
                    {task}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* House Protocols Modal */}
      {showProtocolsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white max-w-2xl w-full max-h-[85vh] overflow-y-auto rounded-sm border border-taupe/40 p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-taupe/20 pb-4">
              <div>
                <h3 className="font-serif text-xl text-charcoal">Studio House Protocols</h3>
                <p className="text-xs text-charcoal-muted">Official clinical masterclasses curated by our cosmetic chemists.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowProtocolsModal(false)}
                className="text-charcoal-muted hover:text-charcoal p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {houseProtocols.map(protocol => (
                <div key={protocol.id} className="p-4 border border-taupe/30 rounded-sm hover:border-bronze transition-colors space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-bronze uppercase tracking-editorial">{protocol.difficulty}</span>
                    <span className="text-xs text-charcoal-muted">{protocol.cloned_count} readers using</span>
                  </div>
                  <h4 className="font-serif text-base text-charcoal font-medium">{protocol.title}</h4>
                  <p className="text-xs text-charcoal-light">{protocol.tagline}</p>
                  <p className="text-[11px] text-charcoal-muted italic">Curated by {protocol.curator_name}</p>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        cloneHouseProtocol(protocol);
                        setShowProtocolsModal(false);
                      }}
                      className="px-4 py-1.5 bg-bronze text-white text-xs font-medium rounded-sm hover:bg-bronze-dark transition-colors"
                    >
                      Clone This Protocol (+75 Pts)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

