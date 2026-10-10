// The Brains page rows: one per brain, in the fixed try order from brains.ts. Pure: no network.
// The Google key and the seven new brain keys are saved through the same Vault RPCs as the other keys.
import { BRAIN_SLOTS, brainSecretNames, type BrainSlot } from '../../supabase/functions/_shared/brains';

export interface BrainRow {
  slot: BrainSlot;
  /** The Vault name for the main key (the Google entry for Gemini). */
  keyName: string;
  keyLabel: string;
  /** The second box, for brains that need an identifier (Cloudflare's account ID). Null otherwise. */
  identifier: { name: string; label: string } | null;
  /** Skipped brains keep their row and their save box, but Test is off because Buddy does not call them yet. */
  testable: boolean;
}

export function brainRows(): BrainRow[] {
  return [...BRAIN_SLOTS]
    .sort((a, b) => a.order - b.order)
    .map((slot) => ({
      slot,
      keyName: slot.secretName,
      keyLabel: slot.secretName.endsWith('_token') ? 'Token' : 'Key',
      identifier: slot.extraSecretNames[0] ? { name: slot.extraSecretNames[0], label: 'Account ID' } : null,
      testable: slot.access === 'free_no_card',
    }));
}

/** The list without any brain entries. The Brains page is the one place that shows them. */
export function withoutBrainKeys<T extends { name: string }>(items: T[]): T[] {
  const names = new Set(brainSecretNames());
  return items.filter((item) => !names.has(item.name));
}
