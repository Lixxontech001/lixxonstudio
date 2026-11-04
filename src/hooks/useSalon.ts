import { useState, useEffect, useCallback } from 'react';
import type {
  ReaderRegimen,
  VanityItem,
  SalonHouseProtocol,
  SkinType,
  ClimateType,
  SkinConcern,
  InciReport,
} from '../types/salon';
import {
  generatePersonalizedRegimen,
  analyzeInciList,
  generateRegimenIcsFile,
  downloadTextFile,
  loadLocalRegimen,
  saveLocalRegimen,
  loadLocalVanity,
  saveLocalVanity,
} from '../lib/salonEngine';
import { awardPoints, unlockBadge } from '../lib/achievements';
import { supabase } from '../lib/supabaseClient';
import { getFingerprint } from './useFeatures';

const DEFAULT_HOUSE_PROTOCOLS: SalonHouseProtocol[] = [
  {
    id: 'hp-1',
    title: 'The Barrier Glass Protocol',
    slug: 'barrier-glass-protocol',
    tagline: 'Maximal hydration and lipid restoration for reactive skin barriers.',
    skin_type: 'sensitive',
    target_concerns: ['barrier_repair', 'erythema_redness', 'deep_hydration'],
    difficulty: 'intermediate',
    morning_steps: [
      { step: 1, phase: 'AM', type: 'Gentle Cleanse', name: 'Milky Oat Lipid Cleanser', ph: '5.5', wait: 0, notes: 'Rinse with lukewarm water only' },
      { step: 2, phase: 'AM', type: 'Essence', name: 'Polyglutamic Acid & Centella Essence', ph: '5.8', wait: 1, notes: 'Pat gently onto damp skin' },
      { step: 3, phase: 'AM', type: 'Repair Lipid', name: 'Ectoin & 3:1:1 Ceramide Complex', ph: '6.0', wait: 2, notes: 'Restores stratum corneum micro-tears' },
      { step: 4, phase: 'AM', type: 'Photoprotection', name: 'Mineral SPF 50+ Invisible Zinc', ph: '6.5', wait: 0, notes: 'Full two-finger measurement' },
    ],
    evening_steps: [
      { step: 1, phase: 'PM', type: 'First Cleanse', name: 'Squalane & Jojoba Melting Balm', ph: '6.0', wait: 0, notes: 'Dissolve SPF and environmental particulates' },
      { step: 2, phase: 'PM', type: 'Second Cleanse', name: 'Low-Foam Amino Acid Gel', ph: '5.2', wait: 0, notes: 'Gentle residue sweep' },
      { step: 3, phase: 'PM', type: 'Recovery Active', name: 'Copper Tripeptide-1 (GHK-Cu) 1% Serum', ph: '6.5', wait: 5, notes: 'Stimulates collagen I & III synthesis' },
      { step: 4, phase: 'PM', type: 'Night Seal', name: 'Cholesterol & Squalane Comfort Balm', ph: '5.9', wait: 0, notes: 'Lock trans-epidermal water loss' },
    ],
    weekly_cadence: 'Daily Gentle Cadence: Zero direct peeling acids until barrier score reaches 100%.',
    curator_name: 'Dr. H. Vance, Formulation Chemist',
    is_published: true,
    cloned_count: 248,
    created_at: new Date().toISOString(),
  },
  {
    id: 'hp-2',
    title: 'The Clinical Retinoid & Cellular Renewal Masterclass',
    slug: 'clinical-retinoid-renewal',
    tagline: 'Gold-standard cellular turnover without retinoid dermatitis peeling.',
    skin_type: 'combination',
    target_concerns: ['fine_lines', 'texture_pores', 'hyperpigmentation'],
    difficulty: 'advanced',
    morning_steps: [
      { step: 1, phase: 'AM', type: 'Cleanse', name: 'Enzyme Hydrating Cleanser', ph: '5.5', wait: 0, notes: 'Gentle sweep' },
      { step: 2, phase: 'AM', type: 'Clinical Antioxidant', name: 'Pure L-Ascorbic Acid 15% + Ferulic 0.5%', ph: '3.0', wait: 10, notes: 'Neutralizes ROS and free radicals' },
      { step: 3, phase: 'AM', type: 'Hydration', name: 'Niacinamide 4% & Hyaluronic Multi-Weight', ph: '5.5', wait: 1, notes: 'Strengthens tolerance' },
      { step: 4, phase: 'AM', type: 'Photoprotection', name: 'High-Protection Hybrid Fluid SPF 50', ph: '6.2', wait: 0, notes: 'Mandatory with nightly retinoids' },
    ],
    evening_steps: [
      { step: 1, phase: 'PM', type: 'Cleanse', name: 'Replenishing Oil Cleanser', ph: '5.8', wait: 0, notes: 'Remove sunscreen and sebum' },
      { step: 2, phase: 'PM', type: 'Buffer Base', name: 'Lightweight Hyaluronic Emulsion', ph: '5.5', wait: 3, notes: 'Sandwich base for zero peel' },
      { step: 3, phase: 'PM', type: 'Active Retinoid', name: 'Microencapsulated Retinaldehyde 0.1%', ph: '6.0', wait: 15, notes: 'Direct precursor to retinoic acid' },
      { step: 4, phase: 'PM', type: 'Buffer Top', name: 'Phytoceramide Rich Recovery Crème', ph: '5.7', wait: 0, notes: 'Sandwich top seal' },
    ],
    weekly_cadence: 'Skin Cycling: Mon/Thu Retinaldehyde | Tue Glycolic Acid | Wed/Fri/Sat/Sun Recovery.',
    curator_name: 'Lixxon Clinical Research',
    is_published: true,
    cloned_count: 512,
    created_at: new Date().toISOString(),
  },
];

export function useSalon() {
  const [regimen, setRegimen] = useState<ReaderRegimen | null>(null);
  const [vanity, setVanity] = useState<VanityItem[]>([]);
  const [houseProtocols, setHouseProtocols] = useState<SalonHouseProtocol[]>(DEFAULT_HOUSE_PROTOCOLS);
  const [loading, setLoading] = useState(true);

  // Load from local storage and remote
  useEffect(() => {
    const localReg = loadLocalRegimen();
    if (localReg) {
      setRegimen(localReg);
    }
    const localVan = loadLocalVanity();
    if (localVan.length > 0) {
      setVanity(localVan);
    }

    // Attempt remote fetch
    const fetchRemote = async () => {
      try {
        const fp = getFingerprint();
        // Fetch house protocols
        const { data: protocols } = await supabase
          .from('salon_house_protocols')
          .select('*')
          .eq('is_published', true)
          .order('cloned_count', { ascending: false });

        if (protocols && protocols.length > 0) {
          setHouseProtocols(protocols as unknown as SalonHouseProtocol[]);
        }

        // Fetch user vanity
        const { data: remoteVanity } = await supabase
          .from('reader_vanity_items')
          .select('*')
          .eq('fingerprint', fp)
          .eq('is_emptied', false);

        if (remoteVanity && remoteVanity.length > 0) {
          setVanity(remoteVanity as unknown as VanityItem[]);
          saveLocalVanity(remoteVanity as unknown as VanityItem[]);
        }
      } catch {
        // Fallback silently to local state
      } finally {
        setLoading(false);
      }
    };

    fetchRemote();
  }, []);

  // Generate a custom regimen
  const createRegimen = useCallback((skinType: SkinType, climate: ClimateType, concerns: SkinConcern[]) => {
    const newRegimen = generatePersonalizedRegimen(skinType, climate, concerns);
    setRegimen(newRegimen);
    saveLocalRegimen(newRegimen);

    // Gamification point booster & badge unlock!
    awardPoints(100, 'Architected personalized clinical regimen');
    unlockBadge('formulation_master');
    return newRegimen;
  }, []);

  // Clone an official house protocol into the user's active regimen
  const cloneHouseProtocol = useCallback((protocol: SalonHouseProtocol) => {
    const newRegimen: ReaderRegimen = {
      fingerprint: getFingerprint(),
      title: protocol.title,
      skin_type: (protocol.skin_type as SkinType) || 'combination',
      climate: 'temperate',
      concerns: (protocol.target_concerns as SkinConcern[]) || ['barrier_repair'],
      morning_steps: protocol.morning_steps,
      evening_steps: protocol.evening_steps,
      weekly_schedule: {
        monday: protocol.weekly_cadence,
        tuesday: 'Gentle Recovery',
        wednesday: 'Active Night',
        thursday: 'Recovery',
        friday: 'Active Night',
        saturday: 'Nourishment',
        sunday: 'Reset',
      },
      synergy_score: 98,
      is_active: true,
    };
    setRegimen(newRegimen);
    saveLocalRegimen(newRegimen);

    awardPoints(75, `Cloned Studio Protocol: ${protocol.title}`);
    return newRegimen;
  }, []);

  // Add a product bottle to the digital vanity shelf
  const addVanityItem = useCallback((item: Omit<VanityItem, 'id' | 'fingerprint' | 'is_emptied'>) => {
    const newItem: VanityItem = {
      ...item,
      id: `vanity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fingerprint: getFingerprint(),
      is_emptied: false,
    };

    setVanity(prev => {
      const next = [newItem, ...prev];
      saveLocalVanity(next);
      return next;
    });

    awardPoints(40, `Added ${item.product_name} to Vanity Shelf`);

    // Remote sync
    supabase
      .from('reader_vanity_items')
      .insert({
        fingerprint: newItem.fingerprint,
        product_name: newItem.product_name,
        brand: newItem.brand,
        category: newItem.category,
        opened_on: newItem.opened_on,
        pao_months: newItem.pao_months,
        estimated_price: newItem.estimated_price || 0,
        key_actives: newItem.key_actives || [],
      })
      .then(null, () => undefined);

    return newItem;
  }, []);

  // Remove / empty item from vanity shelf
  const removeVanityItem = useCallback((id: string) => {
    setVanity(prev => {
      const next = prev.filter(i => i.id !== id);
      saveLocalVanity(next);
      return next;
    });

    supabase
      .from('reader_vanity_items')
      .update({ is_emptied: true })
      .eq('id', id)
      .then(null, () => undefined);
  }, []);

  // Export regimen to Calendar (.ics)
  const exportToCalendar = useCallback(() => {
    if (!regimen) return;
    const icsData = generateRegimenIcsFile(regimen);
    const safeTitle = regimen.title.toLowerCase().replace(/[^a-z0-9]/g, '-');
    downloadTextFile(`lixxon-routine-${safeTitle}.ics`, icsData, 'text/calendar;charset=utf-8');
    awardPoints(30, 'Exported Clinical Protocol to Calendar');
  }, [regimen]);

  // Decode INCI text
  const decodeInci = useCallback((rawInci: string, title?: string): InciReport => {
    const report = analyzeInciList(rawInci, title);
    awardPoints(25, 'Decrypted cosmetic formulation INCI deck');
    return report;
  }, []);

  return {
    regimen,
    vanity,
    houseProtocols,
    loading,
    createRegimen,
    cloneHouseProtocol,
    addVanityItem,
    removeVanityItem,
    exportToCalendar,
    decodeInci,
  };
}

