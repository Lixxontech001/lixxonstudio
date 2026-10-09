/** Path that keeps the original typed-command screen for now. */
export const BUDDY_CONTROLS_PATH = '/buddy/controls';

export function isBuddyControlsPath(pathname: string): boolean {
  const clean = (pathname.split(/[?#]/, 1)[0] || '/').replace(/\/+$/, '');
  return clean === BUDDY_CONTROLS_PATH;
}
