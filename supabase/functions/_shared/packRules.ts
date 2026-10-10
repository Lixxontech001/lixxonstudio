// The content packs' plain rules: the four gated channels, the product cap, the copy length limits, and the copy checks.
// The database enforces the same rules (supabase/migrations/20261010100000_minds_packs.sql). A test keeps the two in step.
// Pure logic, no database and no network.

/** The four gated channels. No fifth gated channel. YouTube is an auto channel in Phase 6, not here. */
export const PACK_CHANNELS = ["instagram", "tiktok", "facebook", "pinterest"] as const;
export type PackChannel = (typeof PACK_CHANNELS)[number];

export const PACK_PRODUCT_CAP = 3;
export const CAPTION_MAX = 2200;
export const PIN_TITLE_MAX = 100;
export const PIN_DESCRIPTION_MAX = 500;

export function isPackChannel(value: unknown): value is PackChannel {
  return typeof value === "string" && (PACK_CHANNELS as readonly string[]).includes(value);
}

/** Words and symbols that never appear in copy a reader sees: country names, the local clock, non-USD money, dashes. */
const COPY_BLOCKS: RegExp[] = [
  /nigeria|nigerian|lagos|abuja|naira/i,
  /\bWAT\b/,
  /\b(NGN|GBP|EUR)\b/,
  /[\u2014\u2013\u00a3\u20ac\u20a6]/,
];

/** Why a piece of copy cannot be used, or null when it is clean. Mirrors public.minds_copy_is_clean. */
export function copyProblem(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  return COPY_BLOCKS.some((pattern) => pattern.test(text)) ? "copy_not_clean" : null;
}

/** Products on one pack: at most the cap, no repeats. Returns the plain reason, or null when fine. */
export function productProblem(productIds: readonly string[]): string | null {
  if (productIds.length > PACK_PRODUCT_CAP) return "at most 3 products on a pack";
  if (new Set(productIds).size !== productIds.length) return "repeated_product";
  return null;
}
