/** The Continue button waits this long, so the greeting has time to land (the animation runs 8 to 15 seconds). */
export const CONTINUE_DELAY_MS = 9500;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
