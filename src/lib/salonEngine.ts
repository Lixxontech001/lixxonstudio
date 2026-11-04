import type {
  SkinType,
  ClimateType,
  SkinConcern,
  RegimenStep,
  ReaderRegimen,
  InciReport,
  InciIngredientDetail,
  VanityItem,
} from '../types/salon';
import { supabase } from './supabaseClient';
import { getFingerprint } from '../hooks/useFeatures';

const REGIMEN_STORAGE_KEY = 'lixxon_salon_regimen_v1';
const VANITY_STORAGE_KEY = 'lixxon_salon_vanity_v1';

// Comprehensive dictionary of cosmetic & pharmaceutical actives
const INCI_DICTIONARY: Record<string, Partial<InciIngredientDetail>> = {
  'water': { purpose: 'Solvent & vehicle', comedogenicRating: 0, safetyScore: 100, clinicalEvidence: 'A', description: 'Universal hydrating carrier.' },
  'aqua': { purpose: 'Solvent & vehicle', comedogenicRating: 0, safetyScore: 100, clinicalEvidence: 'A', description: 'Purified water carrier.' },
  'glycerin': { purpose: 'Humectant', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Tri-hydroxy alcohol; pulls atmospheric moisture deep into stratum corneum.' },
  'niacinamide': { purpose: 'Cell-communicating active (Vitamin B3)', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Reduces sebum secretion, fades post-inflammatory erythema, and upregulates ceramide synthesis.' },
  'sodium hyaluronate': { purpose: 'Multi-molecular humectant', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Salt form of hyaluronic acid with smaller molecular size for optimal epidermal hydration.' },
  'hyaluronic acid': { purpose: 'Humectant', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Binds up to 1,000x its molecular weight in water.' },
  'ascorbic acid': { purpose: 'Antioxidant & Collagen booster (Vitamin C)', comedogenicRating: 0, safetyScore: 90, isStarActive: true, clinicalEvidence: 'A', description: 'Pure L-Ascorbic Acid; neutralizes ROS, boosts pro-collagen 1 synthesis, and inhibits tyrosinase.' },
  'retinol': { purpose: 'Cellular renewal & anti-aging', comedogenicRating: 0, safetyScore: 85, isStarActive: true, clinicalEvidence: 'A', description: 'Converts via retinaldehyde to retinoic acid, accelerating epidermal turnover.' },
  'retinal': { purpose: 'Advanced retinoid (Retinaldehyde)', comedogenicRating: 0, safetyScore: 90, isStarActive: true, clinicalEvidence: 'A', description: 'One-step conversion to retinoic acid; 11x faster than retinol with lower irritation profile.' },
  'retinaldehyde': { purpose: 'Advanced retinoid', comedogenicRating: 0, safetyScore: 90, isStarActive: true, clinicalEvidence: 'A', description: 'Potent antibacterial and anti-photoaging retinoid.' },
  'tretinoin': { purpose: 'Pharmaceutical retinoic acid', comedogenicRating: 0, safetyScore: 80, isStarActive: true, clinicalEvidence: 'A', description: 'Prescription retinoic acid directly activating nuclear RAR receptors.' },
  'salicylic acid': { purpose: 'BHA Exfoliant', comedogenicRating: 0, safetyScore: 90, isStarActive: true, clinicalEvidence: 'A', description: 'Lipophilic beta-hydroxy acid that dissolves pore plug sebum and calms inflammation.' },
  'glycolic acid': { purpose: 'AHA Exfoliant', comedogenicRating: 0, safetyScore: 85, isStarActive: true, clinicalEvidence: 'A', description: 'Smallest molecule AHA; breaks down corneocyte desmosomes for luminous surface renewal.' },
  'lactic acid': { purpose: 'AHA Exfoliant & NMF', comedogenicRating: 0, safetyScore: 95, isStarActive: true, clinicalEvidence: 'A', description: 'Gentle exfoliating AHA that naturally acts as an intrinsic skin humectant.' },
  'azelaic acid': { purpose: 'Anti-inflammatory & Dicarboxylic active', comedogenicRating: 0, safetyScore: 98, isStarActive: true, clinicalEvidence: 'A', description: 'Selectively targets hyperactive melanocytes and inhibits cutibacterium acnes.' },
  'ceramide np': { purpose: 'Intercellular lipid', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Critical component of the skin bilayer; prevents TEWL and repairs micro-cracks.' },
  'ceramide ap': { purpose: 'Barrier repair lipid', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Stabilizes lipid matrix lamellae.' },
  'ceramide eop': { purpose: 'Barrier seal lipid', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Anchors stratum corneum lipid bilayers.' },
  'cholesterol': { purpose: 'Physiological lipid', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Part of the 3:1:1 golden physiological lipid ratio for rapid barrier restoration.' },
  'squalane': { purpose: 'Biocompatible emollient', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Hydrogenated olive/sugarcane derivative identical to skin’s native squalene sebum.' },
  'copper tripeptide-1': { purpose: 'Signaling peptide (GHK-Cu)', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Promotes wound healing, extracellular matrix synthesis, and skin elasticity remodeling.' },
  'palmitoyl pentapeptide-4': { purpose: 'Matrixyl peptide', comedogenicRating: 0, safetyScore: 98, isStarActive: true, clinicalEvidence: 'A', description: 'Stimulates procollagen and fibronectin synthesis.' },
  'centella asiatica extract': { purpose: 'Botanical soother (Cica)', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Contains madecassoside and asiaticoside; powerful anti-erythema soother.' },
  'zinc oxide': { purpose: 'Mineral UV Filter & Soother', comedogenicRating: 1, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Photostable broad-spectrum UVA1/UVA2/UVB reflection.' },
  'titanium dioxide': { purpose: 'Mineral UV Filter', comedogenicRating: 0, safetyScore: 95, clinicalEvidence: 'A', description: 'Broad-spectrum mineral scattering agent.' },
  'ectoin': { purpose: 'Extremolyte barrier protector', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Forms a protective hydration shell around cells, shielding from environmental pollution.' },
  'panthenol': { purpose: 'Provitamin B5', comedogenicRating: 0, safetyScore: 100, isStarActive: true, clinicalEvidence: 'A', description: 'Accelerates keratinization, softens roughness, and quenches itching/irritation.' },
  'tocopherol': { purpose: 'Vitamin E Antioxidant', comedogenicRating: 2, safetyScore: 95, isStarActive: true, clinicalEvidence: 'A', description: 'Lipid-soluble antioxidant; synergizes with Vitamin C.' },
  'alcohol denat': { purpose: 'Solvent & penetration enhancer', comedogenicRating: 0, safetyScore: 40, isIrritant: true, irritantReason: 'Strips skin surface lipids, accelerates TEWL, and compromises barrier in sensitive skin.', clinicalEvidence: 'B', description: 'Drying alcohol commonly used to give products a quick-dry matte finish.' },
  'fragrance': { purpose: 'Aromatic masking', comedogenicRating: 0, safetyScore: 35, isIrritant: true, irritantReason: 'Common cosmetic allergen; contains undocumented fragrance allergens.', clinicalEvidence: 'C', description: 'Synthetic fragrance mixture.' },
  'parfum': { purpose: 'Aromatic masking', comedogenicRating: 0, safetyScore: 35, isIrritant: true, irritantReason: 'Top cause of contact dermatitis and sensitization.', clinicalEvidence: 'C', description: 'Fragrance blend.' },
  'limonene': { purpose: 'Fragrance allergen / terpene', comedogenicRating: 0, safetyScore: 50, isIrritant: true, irritantReason: 'Oxidizes on air exposure into strong sensitizing hydroperoxides.', clinicalEvidence: 'B', description: 'Citrus terpene allergen.' },
  'linalool': { purpose: 'Fragrance allergen', comedogenicRating: 0, safetyScore: 50, isIrritant: true, irritantReason: 'Air oxidation creates skin allergens.', clinicalEvidence: 'B', description: 'Floral fragrance allergen.' },
  'isopropyl myristate': { purpose: 'Synthetic emollient', comedogenicRating: 5, safetyScore: 70, isIrritant: true, irritantReason: 'Highly comedogenic (Grade 5/5); prone to clogging pores and triggering closed comedones.', clinicalEvidence: 'A', description: 'Fast-spreading ester with very high pore-clogging potential.' },
  'coconut oil': { purpose: 'Plant lipid', comedogenicRating: 4, safetyScore: 85, isIrritant: false, irritantReason: 'High comedogenicity (Grade 4); unsuitable for acne-prone skin.', clinicalEvidence: 'B', description: 'High lauric acid lipid; comedogenic for facial pores.' },
  'sodium lauryl sulfate': { purpose: 'Anionic surfactant', comedogenicRating: 1, safetyScore: 45, isIrritant: true, irritantReason: 'Severe barrier stripping and protein denaturation.', clinicalEvidence: 'A', description: 'Harsh lathering detergent.' },
};

export const CULT_FORMULAS: { name: string; brand: string; inci: string }[] = [
  {
    name: 'C E Ferulic Combination Antioxidant',
    brand: 'SkinCeuticals',
    inci: 'Water, Ethoxydiglycol, L-Ascorbic Acid, Glycerin, Propylene Glycol, Laureth-23, Phenoxyethanol, Tocopherol, Triethanolamine, Ferulic Acid, Sodium Hyaluronate',
  },
  {
    name: 'Lotion P50 Balancing Exfoliator',
    brand: 'Biologique Recherche',
    inci: 'Water, Gluconolactone, Lactic Acid, Glycerin, Propylene Glycol, Niacinamide, Citric Acid, Ethoxydiglycol, Malic Acid, Vinegar, Salicylic Acid, Phytic Acid, Spiraea Ulmaria Extract',
  },
  {
    name: 'The Rich Cream with TFC8',
    brand: 'Augustinus Bader',
    inci: 'Aqua, Coco-Caprylate/Caprate, Helianthus Annuus Seed Oil, Squalane, Glycerin, Argania Spinosa Kernel Oil, Ethylhexyl Stearate, Persea Gratissima Oil, Polyglyceryl-4 Oleate, Magnesium Sulfate, Oenothera Biennis Oil, Panthenol, Tocopheryl Acetate, Zinc PCA, Retinyl Palmitate, Ceramide NP, Ceramide AP, Phytosphingosine, Cholesterol',
  },
  {
    name: 'Barrier Lipid Restorative Crème',
    brand: 'Lixxon Formulation Lab',
    inci: 'Aqua, Glycerin, Squalane, Niacinamide, Ceramide NP, Ceramide AP, Ceramide EOP, Cholesterol, Ectoin, Sodium Hyaluronate, Panthenol, Copper Tripeptide-1, Centella Asiatica Extract, Tocopherol',
  },
];

/**
 * Generates an automated, personalized clinical AM/PM regimen based on skin inputs.
 */
export function generatePersonalizedRegimen(
  skinType: SkinType,
  climate: ClimateType,
  concerns: SkinConcern[]
): ReaderRegimen {
  const morningSteps: RegimenStep[] = [];
  const eveningSteps: RegimenStep[] = [];

  // Step 1 AM: Cleansing
  if (skinType === 'dry' || skinType === 'sensitive') {
    morningSteps.push({
      step: 1,
      phase: 'AM',
      type: 'Gentle Cleanse',
      name: 'Rinse with Lukewarm Thermal Water or Milky Oat Cleanser',
      ph: '5.5',
      wait: 0,
      notes: 'Preserves the overnight lipid barrier; no stripping surfactants.',
    });
  } else {
    morningSteps.push({
      step: 1,
      phase: 'AM',
      type: 'Clarifying Cleanse',
      name: 'Low-Foam Amino Acid Gel Cleanser',
      ph: '5.2',
      wait: 0,
      notes: 'Removes overnight sebum without elevating cutaneous pH above 5.5.',
    });
  }

  // Step 2 AM: Targeted Antioxidant & Active Shield
  if (concerns.includes('hyperpigmentation') || concerns.includes('dullness')) {
    morningSteps.push({
      step: 2,
      phase: 'AM',
      type: 'Clinical Antioxidant',
      name: 'L-Ascorbic Acid 15% + Ferulic Acid 0.5%',
      active: 'Vitamin C (pH 3.0)',
      ph: '3.0',
      wait: 8,
      notes: 'Allow 8 minutes before next step for complete epidermal penetration and acid stabilization.',
    });
  } else if (concerns.includes('erythema_redness') || concerns.includes('barrier_repair')) {
    morningSteps.push({
      step: 2,
      phase: 'AM',
      type: 'Soothing Active',
      name: 'Azelaic Acid 10% + Centella Asiatica Fluid',
      active: 'Azelaic Acid & Cica',
      ph: '5.2',
      wait: 2,
      notes: 'Calms capillary inflammation, controls micro-vascular erythema, and protects reactive skin.',
    });
  } else {
    morningSteps.push({
      step: 2,
      phase: 'AM',
      type: 'Cellular Defense',
      name: 'Niacinamide 5% + Ectoin Shield Serum',
      active: 'Niacinamide & Ectoin',
      ph: '5.8',
      wait: 2,
      notes: 'Strengthens cellular resilience against urban particulates and regulates excess sebum.',
    });
  }

  // Step 3 AM: Barrier Hydration & Moisture
  if (skinType === 'dry' || climate === 'arid' || climate === 'cold') {
    morningSteps.push({
      step: 3,
      phase: 'AM',
      type: 'Lipid Replenishment',
      name: 'Multi-Ceramide (NP/AP/EOP) + Squalane Cream',
      active: 'Ceramide 3:1:1 Complex',
      ph: '5.6',
      wait: 1,
      notes: 'Seals moisture and prevents winter trans-epidermal water loss.',
    });
  } else {
    morningSteps.push({
      step: 3,
      phase: 'AM',
      type: 'Weightless Hydration',
      name: 'Polyglutamic Acid & Hyaluronic Gel-Cream',
      active: 'Polyglutamic Acid',
      ph: '5.7',
      wait: 1,
      notes: 'Delivers high water binding capacity without occlusive heaviness in humid weather.',
    });
  }

  // Step 4 AM: Broad-Spectrum Photoprotection
  morningSteps.push({
    step: 4,
    phase: 'AM',
    type: 'Photoprotection',
    name: skinType === 'sensitive' ? 'Pure Mineral Invisible Zinc Oxide SPF 50+' : 'Broad-Spectrum Fluid SPF 50+ PA++++',
    active: 'Zinc Oxide / Modern UV Filters',
    ph: '6.5',
    wait: 0,
    notes: 'Apply two full finger lengths. Non-negotiable foundation of all skincare efficacy.',
  });

  // PM Steps:
  // Step 1 PM: Double Cleanse
  eveningSteps.push({
    step: 1,
    phase: 'PM',
    type: 'First Cleanse',
    name: 'Squalane & Jojoba Lipid Dissolving Balm',
    ph: '6.0',
    wait: 0,
    notes: 'Breaks down waterproof SPF, silicone pigments, and particulate matter without tugging.',
  });

  eveningSteps.push({
    step: 2,
    phase: 'PM',
    type: 'Second Cleanse',
    name: 'pH-Balanced Gentle Gel Wash',
    ph: '5.2',
    wait: 0,
    notes: 'Sweeps away residual oil cleanly with zero tight or squeaky sensation.',
  });

  // Step 3 PM: Active Night Treatment (Based on cycling & concerns)
  if (concerns.includes('fine_lines') || concerns.includes('texture_pores')) {
    eveningSteps.push({
      step: 3,
      phase: 'PM',
      type: 'Cellular Renewal Active',
      name: 'Microencapsulated Retinaldehyde 0.05% - 0.1%',
      active: 'Retinaldehyde',
      ph: '6.0',
      wait: 10,
      notes: 'Apply to dry skin. Promotes profound neocollagenesis with lower irritation than retinol.',
    });
  } else if (concerns.includes('acne_blemishes')) {
    eveningSteps.push({
      step: 3,
      phase: 'PM',
      type: 'Clarifying Treatment',
      name: 'Salicylic Acid 2% + Zinc PCA Elixir',
      active: 'BHA & Zinc',
      ph: '3.8',
      wait: 5,
      notes: 'Penetrates pore infundibulum to dissolve keratolytic debris and eliminate bacterial colonies.',
    });
  } else {
    eveningSteps.push({
      step: 3,
      phase: 'PM',
      type: 'Peptide Remodeling',
      name: 'Copper Tripeptide-1 (GHK-Cu) 1% Matrix Serum',
      active: 'GHK-Cu Peptides',
      ph: '6.5',
      wait: 5,
      notes: 'Triggers dermal remodeling, collagen synthesis, and deep tissue recuperation.',
    });
  }

  // Step 4 PM: Barrier Seal & Night Recovery
  eveningSteps.push({
    step: 4,
    phase: 'PM',
    type: 'Overnight Barrier Seal',
    name: 'Phytosterols & Bio-Identical Lipid Night Balm',
    active: 'Cholesterol, Fatty Acids & Ceramides',
    ph: '5.8',
    wait: 0,
    notes: 'Locks in overnight repair cycle; supports natural circadian rhythm cellular synthesis.',
  });

  // Construct 7-Day Skin Cycling Cadence
  const weekly_schedule = {
    monday: 'Retinoid Night: Cellular Turnover (Apply Retinaldehyde)',
    tuesday: 'Exfoliation Night: AHA/BHA Lactic Acid smoothing (Skip Retinoid)',
    wednesday: 'Recovery Night 1: Deep Ceramides & Copper Peptides only',
    thursday: 'Recovery Night 2: Moisture Sandwiched Barrier Recharge',
    friday: 'Retinoid Night: Cellular Turnover (Apply Retinaldehyde)',
    saturday: 'Nourishing Treatment: Squalane & Hydrating Sheet Mask',
    sunday: 'Recovery & Reset: Minimalist Cleanse & Comfort Balm',
  };

  return {
    fingerprint: getFingerprint(),
    title: `${skinType.charAt(0).toUpperCase() + skinType.slice(1)} Clinical Protocol`,
    skin_type: skinType,
    climate,
    concerns,
    morning_steps: morningSteps,
    evening_steps: eveningSteps,
    weekly_schedule,
    synergy_score: 96,
    is_active: true,
  };
}

/**
 * Analyzes raw INCI ingredient text and generates a comprehensive toxicity/efficacy report.
 */
export function analyzeInciList(rawInci: string, title?: string): InciReport {
  // Clean and split ingredients
  const rawClean = rawInci
    .replace(/^ingredients?:/i, '')
    .replace(/\[|\]/g, '')
    .trim();

  const names = rawClean
    .split(/[,;•\n]+/)
    .map(n => n.trim().replace(/\.$/, ''))
    .filter(n => n.length > 1);

  const allIngredients: InciIngredientDetail[] = [];
  const starActives: InciIngredientDetail[] = [];
  const flaggedConcerns: InciIngredientDetail[] = [];
  let comedogenicMax = 0;
  let totalScoreSum = 0;

  for (const rawName of names) {
    const cleanKey = rawName.toLowerCase();
    // Search in dictionary
    const dictEntry = INCI_DICTIONARY[cleanKey] ||
      Object.entries(INCI_DICTIONARY).find(([k]) => cleanKey.includes(k))?.[1];

    const comedogenic = dictEntry?.comedogenicRating ?? 0;
    const safety = dictEntry?.safetyScore ?? 95;
    const isStar = Boolean(dictEntry?.isStarActive);
    const isIrritant = Boolean(dictEntry?.isIrritant);
    const purpose = dictEntry?.purpose || 'Texture / Emollient / Preservative';
    const evidence = dictEntry?.clinicalEvidence || 'B';
    const description = dictEntry?.description || 'Cosmetic formulation constituent.';

    if (comedogenic > comedogenicMax) comedogenicMax = comedogenic;
    totalScoreSum += safety;

    const item: InciIngredientDetail = {
      name: rawName,
      cleanName: cleanKey,
      purpose,
      comedogenicRating: comedogenic,
      safetyScore: safety,
      isStarActive: isStar,
      isIrritant,
      irritantReason: dictEntry?.irritantReason,
      clinicalEvidence: evidence,
      description,
    };

    allIngredients.push(item);
    if (isStar) starActives.push(item);
    if (isIrritant || comedogenic >= 3) flaggedConcerns.push(item);
  }

  const averageSafety = names.length > 0 ? Math.round(totalScoreSum / names.length) : 90;
  const penalty = flaggedConcerns.length * 8;
  const bonus = Math.min(starActives.length * 5, 20);
  const overallScore = Math.max(25, Math.min(100, averageSafety - penalty + bonus));

  let verdict: InciReport['verdict'] = 'Balanced Daily Formula';
  let verdictSummary = 'A balanced, modern cosmetic formulation with reliable skin tolerance.';

  if (overallScore >= 90 && starActives.length >= 2 && flaggedConcerns.length === 0) {
    verdict = 'Gold Standard Formulation';
    verdictSummary = 'Exceptional clinical synergy. High concentration of verified barrier-identical actives with zero volatile allergens or high comedogens.';
  } else if (flaggedConcerns.some(c => c.isIrritant)) {
    verdict = 'High Allergen / Irritant Risk';
    verdictSummary = 'Contains volatile sensitizers or drying alcohols that may compromise reactive barriers or trigger contact dermatitis with frequent use.';
  } else if (comedogenicMax >= 4) {
    verdict = 'Comedogenic Warning';
    verdictSummary = 'Contains ingredients with high pore-clogging ratings. Caution advised if you are prone to closed comedones or cystic congestion.';
  } else if (overallScore >= 80) {
    verdict = 'Barrier Safe & Restorative';
    verdictSummary = 'Gentle, non-stripping base formulation with skin-nurturing emollients and humectants.';
  }

  return {
    productTitle: title || 'Custom Cosmetic Formula',
    rawInci,
    totalIngredients: allIngredients.length,
    overallScore,
    comedogenicMax,
    starActives,
    flaggedConcerns,
    allIngredients,
    verdict,
    verdictSummary,
  };
}

/**
 * Computes shelf-life, elapsed days, and degradation risk for cosmetic products (PAO).
 */
export function calculatePaoStatus(openedOnDate: string, paoMonths: number): {
  daysElapsed: number;
  totalDays: number;
  percentRemaining: number;
  status: 'fresh' | 'warning' | 'expired';
  label: string;
} {
  const opened = new Date(openedOnDate);
  const now = new Date();
  const diffTime = Math.max(0, now.getTime() - opened.getTime());
  const daysElapsed = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const totalDays = Math.round(paoMonths * 30.44);

  const daysRemaining = totalDays - daysElapsed;
  const percentRemaining = Math.max(0, Math.min(100, Math.round((daysRemaining / totalDays) * 100)));

  if (daysRemaining <= 0) {
    return {
      daysElapsed,
      totalDays,
      percentRemaining: 0,
      status: 'expired',
      label: `Expired ${Math.abs(daysRemaining)} days ago — discard for barrier safety`,
    };
  }

  if (daysRemaining <= 30) {
    return {
      daysElapsed,
      totalDays,
      percentRemaining,
      status: 'warning',
      label: `Oxidation Watch: Only ${daysRemaining} days remaining`,
    };
  }

  return {
    daysElapsed,
    totalDays,
    percentRemaining,
    status: 'fresh',
    label: `Fresh & Active: ${daysRemaining} days remaining (${percentRemaining}%)`,
  };
}

/**
 * Generates an iCalendar (.ics) file string for the user to import into Apple Calendar / Google Calendar.
 */
export function generateRegimenIcsFile(regimen: ReaderRegimen): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const amSummary = `Lixxon Morning Skincare Ritual (${regimen.skin_type})`;
  const amDesc = regimen.morning_steps.map(s => `${s.step}. ${s.name} (${s.type})${s.wait ? ` [Wait ${s.wait}m]` : ''}`).join('\\n');

  const pmSummary = `Lixxon Evening Skincare Ritual (${regimen.skin_type})`;
  const pmDesc = regimen.evening_steps.map(s => `${s.step}. ${s.name} (${s.type})${s.wait ? ` [Wait ${s.wait}m]` : ''}`).join('\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lixxon Studio//Salon Clinical Regimen//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // Morning Daily Event
    'BEGIN:VEVENT',
    `UID:lixxon-am-${Date.now()}@lixxonstudio.com`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=UTC:${new Date().toISOString().slice(0, 10).replace(/-/g, '')}T080000Z`,
    `DTEND;TZID=UTC:${new Date().toISOString().slice(0, 10).replace(/-/g, '')}T081500Z`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:${amSummary}`,
    `DESCRIPTION:${amDesc}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT5M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Skincare Routine AM',
    'END:VALARM',
    'END:VEVENT',
    // Evening Daily Event
    'BEGIN:VEVENT',
    `UID:lixxon-pm-${Date.now()}@lixxonstudio.com`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=UTC:${new Date().toISOString().slice(0, 10).replace(/-/g, '')}T213000Z`,
    `DTEND;TZID=UTC:${new Date().toISOString().slice(0, 10).replace(/-/g, '')}T214500Z`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:${pmSummary}`,
    `DESCRIPTION:${pmDesc}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT5M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Skincare Routine PM',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Downloads a file to the user's browser.
 */
export function downloadTextFile(filename: string, content: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * LocalStorage + Supabase sync helpers
 */
export function loadLocalRegimen(): ReaderRegimen | null {
  try {
    const raw = localStorage.getItem(REGIMEN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLocalRegimen(regimen: ReaderRegimen): void {
  try {
    localStorage.setItem(REGIMEN_STORAGE_KEY, JSON.stringify(regimen));
    // Background sync to Supabase if configured
    supabase
      .from('reader_regimens')
      .upsert({
        fingerprint: regimen.fingerprint,
        title: regimen.title,
        skin_type: regimen.skin_type,
        climate: regimen.climate,
        concerns: regimen.concerns,
        morning_steps: regimen.morning_steps,
        evening_steps: regimen.evening_steps,
        weekly_schedule: regimen.weekly_schedule,
        synergy_score: regimen.synergy_score,
        is_active: regimen.is_active,
        updated_at: new Date().toISOString(),
      })
      .then(null, () => undefined);
  } catch {
    // ignore
  }
}

export function loadLocalVanity(): VanityItem[] {
  try {
    const raw = localStorage.getItem(VANITY_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveLocalVanity(items: VanityItem[]): void {
  try {
    localStorage.setItem(VANITY_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

