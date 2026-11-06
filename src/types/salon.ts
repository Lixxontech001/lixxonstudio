export type SkinType = 'dry' | 'oily' | 'combination' | 'sensitive' | 'normal';
export type ClimateType = 'temperate' | 'humid' | 'arid' | 'cold' | 'urban';
export type SkinConcern =
  | 'barrier_repair'
  | 'hyperpigmentation'
  | 'fine_lines'
  | 'acne_blemishes'
  | 'texture_pores'
  | 'erythema_redness'
  | 'dullness'
  | 'deep_hydration';

export type BarrierStatus = 'resilient' | 'stressed' | 'compromised' | 'post_peel';
export type SensitivityLevel = 'none' | 'flushing' | 'rosacea' | 'neuro_reactive';
export type ActiveTolerance = 'novice' | 'intermediate' | 'advanced';
export type PollutionLevel = 'low' | 'moderate' | 'high_urban';

export interface ExtendedSkinProfile {
  skinType: string;
  barrierStatus: BarrierStatus;
  sensitivityLevel: SensitivityLevel;
  activeTolerance: ActiveTolerance;
  climate: string;
  pollutionLevel: PollutionLevel;
  primaryGoal: string;
  secondaryGoal: string;
  concerns: string[];
}

export interface ReasoningStep {
  phase: string;
  title: string;
  detail: string;
  status: 'pending' | 'running' | 'done';
}

export interface FormulationDiagnosis {
  compatibilityScore: number;
  conflictWarnings: string[];
  pHSequence: { step: string; ph: string; waitMinutes: number }[];
  amRoutine: { step: number; product: string; note: string }[];
  pmRoutine: { step: number; product: string; note: string }[];
  milestones: { week: number; expectation: string }[];
  contingencyProtocol: string;
}

export interface RegimenStep {
  step: number;
  phase: 'AM' | 'PM';
  type: string;
  name: string;
  active?: string;
  ph?: string;
  wait?: number; // wait minutes before next step
  notes?: string;
}

export interface ReaderRegimen {
  id?: string;
  user_id?: string | null;
  fingerprint: string;
  title: string;
  skin_type: SkinType;
  climate: ClimateType;
  concerns: SkinConcern[];
  morning_steps: RegimenStep[];
  evening_steps: RegimenStep[];
  weekly_schedule: {
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
  };
  synergy_score: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type VanityCategory =
  | 'cleanser'
  | 'toner'
  | 'essence'
  | 'serum'
  | 'moisturizer'
  | 'sunscreen'
  | 'treatment'
  | 'eye_cream'
  | 'oil'
  | 'mask';

export interface VanityItem {
  id: string;
  user_id?: string | null;
  fingerprint: string;
  product_name: string;
  brand: string;
  category: VanityCategory;
  opened_on: string; // YYYY-MM-DD
  pao_months: number; // e.g. 3, 6, 12, 24
  volume_ml?: number;
  estimated_price?: number;
  key_actives: string[];
  safety_score?: number;
  is_emptied: boolean;
  notes?: string;
  created_at?: string;
}

export interface SalonHouseProtocol {
  id: string;
  title: string;
  slug: string;
  tagline: string;
  skin_type: string;
  target_concerns: string[];
  difficulty: 'novice' | 'intermediate' | 'advanced' | 'master';
  morning_steps: RegimenStep[];
  evening_steps: RegimenStep[];
  weekly_cadence: string;
  curator_name: string;
  is_published: boolean;
  cloned_count: number;
  created_at: string;
}

export interface InciIngredientDetail {
  name: string;
  cleanName: string;
  purpose: string;
  comedogenicRating: number; // 0-5
  safetyScore: number; // 1-100 (100 = completely benign)
  isStarActive: boolean;
  isIrritant: boolean;
  irritantReason?: string;
  clinicalEvidence: 'A' | 'B' | 'C' | 'D'; // A: Peer-reviewed gold standard, B: Strong clinical, C: In-vitro / preliminary, D: Marketing / unknown
  description: string;
}

export interface InciReport {
  productTitle?: string;
  rawInci: string;
  totalIngredients: number;
  overallScore: number; // 0-100
  comedogenicMax: number; // 0-5
  starActives: InciIngredientDetail[];
  flaggedConcerns: InciIngredientDetail[];
  allIngredients: InciIngredientDetail[];
  verdict: 'Gold Standard Formulation' | 'Barrier Safe & Restorative' | 'High Allergen / Irritant Risk' | 'Comedogenic Warning' | 'Balanced Daily Formula';
  verdictSummary: string;
}

