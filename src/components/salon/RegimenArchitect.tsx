import { useState } from 'react';
import type { SkinType, ClimateType, SkinConcern, BarrierStatus, SensitivityLevel, ActiveTolerance, PollutionLevel, ReasoningStep, FormulationDiagnosis, ExtendedSkinProfile } from '../../types/salon';
import { useSalon } from '../../hooks/useSalon';
import { useAchievements } from '../../hooks/useAchievements';
import { generateFormulationDiagnosis } from '../../lib/salonEngine';
import {
  Sparkles, Calendar, Clock, CheckCircle2, Plus,
  Layers, RefreshCw, BookOpen, AlertTriangle, Check,
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

const BARRIER_STATUSES: { id: BarrierStatus; label: string; desc: string }[] = [
  { id: 'resilient', label: 'Resilient', desc: 'Healthy, intact lipid barrier' },
  { id: 'stressed', label: 'Stressed', desc: 'Mild compromise, some sensitivity' },
  { id: 'compromised', label: 'Compromised', desc: 'Persistent TEWL, reactive to most actives' },
  { id: 'post_peel', label: 'Post-Peel', desc: 'Recently had a chemical peel or laser' },
];

const SENSITIVITY_LEVELS: { id: SensitivityLevel; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'flushing', label: 'Flushing / Heat reactive' },
  { id: 'rosacea', label: 'Rosacea' },
  { id: 'neuro_reactive', label: 'Neuro-reactive / MCAS' },
];

const ACTIVE_TOLERANCES: { id: ActiveTolerance; label: string; desc: string }[] = [
  { id: 'novice', label: 'Novice', desc: 'New to actives or sensitive history' },
  { id: 'intermediate', label: 'Intermediate', desc: '6–18 months with low-dose actives' },
  { id: 'advanced', label: 'Advanced', desc: 'Experienced with retinoids, AHAs, BHAs' },
];

const POLLUTION_LEVELS: { id: PollutionLevel; label: string }[] = [
  { id: 'low', label: 'Low — rural/suburban' },
  { id: 'moderate', label: 'Moderate — small city' },
  { id: 'high_urban', label: 'High — dense urban / commuter' },
];

const THINKING_STEPS: Omit<ReasoningStep, 'status'>[] = [
  { phase: '1', title: 'Profiling skin typology…', detail: 'Mapping barrier integrity, sensitivity markers and sebaceous activity' },
  { phase: '2', title: 'Screening molecular conflicts…', detail: 'Cross-referencing ingredient pH optima and known antagonist pairs' },
  { phase: '3', title: 'Sequencing pH gradient…', detail: 'Ordering actives from lowest to highest pH for maximum efficacy' },
  { phase: '4', title: 'Scheduling circadian actives…', detail: 'Assigning UV-stable actives to AM and repair actives to PM' },
  { phase: '5', title: 'Synthesising formulation…', detail: 'Generating compatibility score and contingency protocol' },
];

export default function RegimenArchitect() {
  const { regimen, createRegimen, cloneHouseProtocol, houseProtocols, exportToCalendar, addVanityItem } = useSalon();
  const { rank } = useAchievements();

  const [selectedSkinType, setSelectedSkinType] = useState<SkinType>(regimen?.skin_type || 'combination');
  const [selectedClimate, setSelectedClimate] = useState<ClimateType>(regimen?.climate || 'temperate');
  const [selectedConcerns, setSelectedConcerns] = useState<SkinConcern[]>(regimen?.concerns || ['barrier_repair', 'fine_lines']);
  const [barrierStatus, setBarrierStatus] = useState<BarrierStatus>('resilient');
  const [sensitivityLevel, setSensitivityLevel] = useState<SensitivityLevel>('none');
  const [activeTolerance, setActiveTolerance] = useState<ActiveTolerance>('intermediate');
  const [pollutionLevel, setPollutionLevel] = useState<PollutionLevel>('moderate');
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [secondaryGoal, setSecondaryGoal] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<ReasoningStep[]>([]);
  const [diagnosis, setDiagnosis] = useState<FormulationDiagnosis | null>(null);
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
    setDiagnosis(null);
    // Initialise all steps as pending
    setThinkingSteps(THINKING_STEPS.map(s => ({ ...s, status: 'pending' as const })));

    // Animate each step sequentially with 400 ms delay
    THINKING_STEPS.forEach((_, idx) => {
      setTimeout(() => {
        setThinkingSteps(prev =>
          prev.map((s, i) =>
            i === idx ? { ...s, status: 'running' } : i < idx ? { ...s, status: 'done' } : s
          )
        );
      }, idx * 400);

      // Mark as done 350 ms after it started
      setTimeout(() => {
        setThinkingSteps(prev =>
          prev.map((s, i) => (i === idx ? { ...s, status: 'done' } : s))
        );
      }, idx * 400 + 350);
    });

    const totalDuration = THINKING_STEPS.length * 400 + 400;
    setTimeout(() => {
      const profile: ExtendedSkinProfile = {
        skinType: selectedSkinType,
        barrierStatus,
        sensitivityLevel,
        activeTolerance,
        climate: selectedClimate,
        pollutionLevel,
        primaryGoal,
        secondaryGoal,
        concerns: selectedConcerns,
      };
      const result = generateFormulationDiagnosis(profile);
      setDiagnosis(result);
      createRegimen(selectedSkinType, selectedClimate, selectedConcerns);
      setIsGenerating(false);
    }, totalDuration);
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

  const scoreColor = (s: number) =>
    s >= 95 ? 'text-green-700 bg-green-50 border-green-200' :
    s >= 90 ? 'text-blue-700 bg-blue-50 border-blue-200' :
    'text-amber-700 bg-amber-50 border-amber-200';

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
        {/* 1. Skin type */}
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

        {/* 2. Barrier status */}
        <div>
          <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-3">
            2. Skin Barrier Status
          </label>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-2">
            {BARRIER_STATUSES.map(b => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBarrierStatus(b.id)}
                className={`p-3 text-left border rounded-sm transition-all ${
                  barrierStatus === b.id
                    ? 'border-bronze bg-bronze/5'
                    : 'border-taupe/30 hover:border-taupe/60'
                }`}
              >
                <div className="font-medium text-xs text-charcoal">{b.label}</div>
                <div className="text-[11px] text-charcoal-muted mt-0.5">{b.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Sensitivity */}
        <div>
          <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-3">
            3. Sensitivity Level
          </label>
          <div className="flex flex-wrap gap-2">
            {SENSITIVITY_LEVELS.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSensitivityLevel(s.id)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                  sensitivityLevel === s.id
                    ? 'bg-charcoal text-white border-charcoal font-medium'
                    : 'border-taupe/40 text-charcoal-light hover:border-charcoal'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 4. Active tolerance */}
        <div>
          <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-3">
            4. Active Ingredient Tolerance
          </label>
          <div className="grid sm:grid-cols-3 gap-3">
            {ACTIVE_TOLERANCES.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => setActiveTolerance(a.id)}
                className={`p-3 text-left border rounded-sm transition-all ${
                  activeTolerance === a.id
                    ? 'border-bronze bg-bronze/5'
                    : 'border-taupe/30 hover:border-taupe/60'
                }`}
              >
                <div className="font-medium text-xs text-charcoal">{a.label}</div>
                <div className="text-[11px] text-charcoal-muted mt-0.5">{a.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 5. Climate + pollution */}
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-3">
              5. Local Environmental Climate
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
              6. Pollution Exposure
            </label>
            <div className="flex flex-wrap gap-2">
              {POLLUTION_LEVELS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPollutionLevel(p.id)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                    pollutionLevel === p.id
                      ? 'bg-charcoal text-white border-charcoal font-medium'
                      : 'border-taupe/40 text-charcoal-light hover:border-charcoal'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 6. Goals */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-2">
              7. Primary Goal
            </label>
            <input
              type="text"
              value={primaryGoal}
              onChange={e => setPrimaryGoal(e.target.value)}
              placeholder="e.g. Glass skin, hyperpigmentation, anti-aging…"
              className="w-full border border-taupe/30 px-3 py-2 rounded-sm text-sm text-charcoal focus:outline-none focus:border-bronze"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-2">
              8. Secondary Goal
            </label>
            <input
              type="text"
              value={secondaryGoal}
              onChange={e => setSecondaryGoal(e.target.value)}
              placeholder="e.g. Stress-resilience, texture refinement…"
              className="w-full border border-taupe/30 px-3 py-2 rounded-sm text-sm text-charcoal focus:outline-none focus:border-bronze"
            />
          </div>
        </div>

        {/* 7. Concerns */}
        <div>
          <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-3">
            9. Target Skin Goals & Concerns (Select up to 4)
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
                <RefreshCw size={14} className="animate-spin" /> Analysing…
              </>
            ) : (
              <>
                <Sparkles size={14} /> Analyse & Generate Protocol (+100 Pts)
              </>
            )}
          </button>
        </div>
      </div>

      {/* Formulation Thinking Steps */}
      {thinkingSteps.length > 0 && (
        <div className="bg-white border border-taupe/30 rounded-sm p-6">
          <h3 className="font-serif text-base text-charcoal mb-4 flex items-center gap-2">
            <Sparkles size={16} className="text-bronze" /> Formulation Thinking
          </h3>
          <div className="space-y-3">
            {thinkingSteps.map((step, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 transition-opacity duration-300 ${step.status === 'pending' ? 'opacity-30' : 'opacity-100'}`}
              >
                <div className="mt-0.5 shrink-0">
                  {step.status === 'done' ? (
                    <Check size={16} className="text-green-600" />
                  ) : step.status === 'running' ? (
                    <RefreshCw size={16} className="animate-spin text-bronze" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-taupe/30" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-charcoal">{step.title}</p>
                  {step.status !== 'pending' && (
                    <p className="text-xs text-charcoal-muted mt-0.5">{step.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulation Diagnosis Results */}
      {diagnosis && (
        <div className="space-y-6">
          {/* Compatibility Score Badge */}
          <div className={`flex items-center gap-6 p-6 border rounded-sm ${scoreColor(diagnosis.compatibilityScore)}`}>
            <div className="text-center shrink-0">
              <div className="text-5xl font-serif font-bold">{diagnosis.compatibilityScore}%</div>
              <div className="text-xs font-semibold tracking-editorial uppercase mt-1">Compatible</div>
            </div>
            <div>
              <h3 className="font-serif text-lg font-medium mb-1">Formulation Diagnosis Complete</h3>
              <p className="text-sm opacity-80">
                Your profile has been analysed across {diagnosis.pHSequence.length} pH checkpoints,{' '}
                {diagnosis.amRoutine.length + diagnosis.pmRoutine.length} protocol steps, and{' '}
                {diagnosis.conflictWarnings.length} conflict vector{diagnosis.conflictWarnings.length !== 1 ? 's' : ''}.
              </p>
            </div>
          </div>

          {/* Conflict Warnings */}
          {diagnosis.conflictWarnings.length > 0 && (
            <div className="bg-white border border-taupe/30 rounded-sm p-6">
              <h4 className="font-serif text-base text-charcoal mb-3 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-600" /> Conflict Screening
              </h4>
              <ul className="space-y-2">
                {diagnosis.conflictWarnings.map((w, i) => (
                  <li key={i} className="text-sm text-charcoal-light flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AM & PM Routine Tables */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* AM */}
            <div className="bg-white border border-taupe/30 rounded-sm p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-taupe/20 pb-3">
                <h4 className="font-serif text-base text-charcoal font-medium flex items-center gap-2">
                  <span className="text-amber-500 text-lg">☀️</span> Morning Protocol (AM)
                </h4>
                <span className="text-[11px] text-charcoal-muted">Defend & Shield</span>
              </div>
              <div className="space-y-3">
                {diagnosis.amRoutine.map(r => (
                  <div key={r.step} className="p-3 bg-warm-ivory/60 border border-taupe/20 rounded-sm space-y-1">
                    <span className="text-[10px] tracking-editorial uppercase font-semibold text-bronze">Step {r.step}</span>
                    <div className="text-sm font-medium text-charcoal">{r.product}</div>
                    <p className="text-xs text-charcoal-light italic">{r.note}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* PM */}
            <div className="bg-white border border-taupe/30 rounded-sm p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-taupe/20 pb-3">
                <h4 className="font-serif text-base text-charcoal font-medium flex items-center gap-2">
                  <span className="text-indigo-400 text-lg">🌙</span> Evening Protocol (PM)
                </h4>
                <span className="text-[11px] text-charcoal-muted">Repair & Cellular Reset</span>
              </div>
              <div className="space-y-3">
                {diagnosis.pmRoutine.map(r => (
                  <div key={r.step} className="p-3 bg-warm-ivory/60 border border-taupe/20 rounded-sm space-y-1">
                    <span className="text-[10px] tracking-editorial uppercase font-semibold text-bronze">Step {r.step}</span>
                    <div className="text-sm font-medium text-charcoal">{r.product}</div>
                    <p className="text-xs text-charcoal-light italic">{r.note}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* pH Sequence */}
          <div className="bg-white border border-taupe/30 rounded-sm p-6">
            <h4 className="font-serif text-base text-charcoal font-medium mb-4">pH Gradient Sequence</h4>
            <div className="space-y-2">
              {diagnosis.pHSequence.map((p, i) => (
                <div key={i} className="flex items-center gap-4 py-2 border-b border-taupe/10 last:border-0">
                  <span className="text-[10px] font-semibold text-bronze uppercase tracking-editorial w-6">{i + 1}</span>
                  <span className="text-sm text-charcoal flex-1">{p.step}</span>
                  <span className="text-xs font-mono text-charcoal-muted">pH {p.ph}</span>
                  {p.waitMinutes > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-sm">
                      <Clock size={10} /> {p.waitMinutes} min wait
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Milestone Timeline */}
          <div className="bg-white border border-taupe/30 rounded-sm p-6">
            <h4 className="font-serif text-base text-charcoal font-medium mb-4 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-bronze" /> Progress Milestones
            </h4>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {diagnosis.milestones.map(m => (
                <div key={m.week} className="p-4 border border-taupe/20 rounded-sm bg-warm-ivory/40">
                  <div className="text-xs font-semibold tracking-editorial uppercase text-bronze mb-1">Week {m.week}</div>
                  <p className="text-xs text-charcoal leading-relaxed">{m.expectation}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Contingency Protocol */}
          <div className="bg-amber-50 border border-amber-200 rounded-sm p-5">
            <h4 className="text-xs font-semibold tracking-editorial uppercase text-amber-800 mb-2 flex items-center gap-2">
              <AlertTriangle size={13} /> Contingency Protocol
            </h4>
            <p className="text-sm text-amber-900 leading-relaxed">{diagnosis.contingencyProtocol}</p>
          </div>

          {/* Action Toolbar */}
          {regimen && (
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
          )}

          {addedVanitySuccess && (
            <div className="p-3 bg-green-50 border border-green-200 text-green-800 text-xs rounded-sm flex items-center gap-2">
              <CheckCircle2 size={16} /> All protocol steps were saved to your Smart Vanity Shelf with freshness tracking!
            </div>
          )}

          {/* 7-Day Skin-Cycling Cadence Calendar */}
          {regimen && (
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
          )}
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
