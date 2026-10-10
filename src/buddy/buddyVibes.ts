/** Buddy's four looks. The look is Buddy's own: it never follows the magazine's light or dark setting. */
export const VIBES = [
  { id: 'noir-gold', name: 'Noir Gold', note: 'Black and gold. The default.', light: false },
  { id: 'ivory-silk', name: 'Ivory Silk', note: 'Cream and gold, light.', light: true },
  { id: 'velvet-opera', name: 'Velvet Opera', note: 'Deep wine and gold.', light: false },
  { id: 'porcelain', name: 'Porcelain', note: 'Pale blue-grey, light.', light: true },
] as const;

export type BuddyVibeId = (typeof VIBES)[number]['id'];

export const DEFAULT_VIBE: BuddyVibeId = 'noir-gold';

/** Anything not in the list becomes the default, so a bad saved value never breaks the screen. */
export function parseVibe(value: unknown): BuddyVibeId {
  return VIBES.some((vibe) => vibe.id === value) ? (value as BuddyVibeId) : DEFAULT_VIBE;
}
