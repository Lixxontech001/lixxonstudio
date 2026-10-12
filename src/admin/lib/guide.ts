// The owner guide, part one: where it lives, the line shown next to each action, and the way back.
// Every page keeps only this small part, so the help next to a button is always to hand. The full steps live in
// `guideSections.ts`, which is loaded only when the owner opens the guide itself.
//
// Rules kept here: English only; no engine words (Vault, RPC, Postgres, RLS, JWT, OAuth); no em dash;
// no country, city or currency names. One or two plain sentences per action.

import { BRAIN_SLOTS } from '../../../supabase/functions/_shared/brains';
import { DOOR_IDS, DOORS } from '../../../supabase/functions/_shared/doorRegistry';

/** The one address of the guide. */
export const GUIDE_PATH = '/admin/guide';
/** The exact words every in-place link uses. */
export const GUIDE_LINK_LABEL = "Don't get it? Open the guide";
/** Where Back goes when the owner opened the guide without coming from a page, and the fallback for a bad one. */
export const GUIDE_BACK_DEFAULT = '/admin/automation/keys';
/** The line shown in place when an anchor has no section (should not happen; the page still stays useful). */
export const GUIDE_MISSING_SHORT = 'Open the guide for the steps.';

export interface GuideSection {
  /** The anchor id. Stable: pages and tests point at it. */
  id: string;
  /** The group heading on the guide page. */
  group: string;
  /** The heading of one owner action, in plain words. */
  title: string;
  /** One or two plain sentences. This is the line shown next to the action itself. */
  short: string;
  /** The numbered steps on the guide page. */
  steps: readonly string[];
}

/** The one or two sentences shown next to each action, keyed by the guide anchor. */
export const GUIDE_SHORTS: Readonly<Record<string, string>> = {
  keys: 'One saved key for each service the site uses. Nothing here posts, sends or charges.',
  'save-key': 'Paste a key once and press Save. It is never shown again after that.',
  'test-key': 'Test makes one read-only request. It never posts, sends, charges or changes anything.',
  'delete-key': 'Delete removes the saved key for good. Nothing else on the site changes.',
  vapid: 'Make the phone alert keys on Keys, then open /admin/settings on your phone and tap Register this device.',
  takeover: 'Takeover is off by default. While it is off the minds cannot change the site.',
  kill: 'Kill stops nothing, one mind, or all of them. The choice is saved until you change it.',
  connections: 'The details for the free places Buddy can post to. Saving stores the details only.',
  // One line per brain, in the fixed try order, from the same slot data the Brains page shows.
  ...Object.fromEntries(BRAIN_SLOTS.map((slot) => [slot.id, slot.id === 'gemini'
    // The owner's own example for the first brain, kept word for word.
    ? 'Get a free key at aistudio.google.com. Paste once. It is never shown again. Test does not publish.'
    : slot.access === 'skip'
      ? 'You do not need a key for this brain yet. Buddy skips it, so Test is off.'
      : `Make the key at ${slot.keySite}. Paste once. Test does not publish.`])),
  // One line per place Buddy can post to, from the same door data the Connections page shows.
  ...Object.fromEntries(DOOR_IDS.map((id) => [`door-${id}`, `${DOORS[id].summary} Saving stores the details only.`])),
};

/** Every anchor that has a line and a section: the page anchors first, then the brains and the places. */
export const GUIDE_ANCHOR_IDS: readonly string[] = Object.keys(GUIDE_SHORTS);

/** The line shown next to an action. Never empty: an unknown anchor gets the plain fallback line. */
export function guideShort(id: string): string {
  return GUIDE_SHORTS[id] ?? GUIDE_MISSING_SHORT;
}

/** True when the anchor has a real section on the guide page. */
export function hasGuideSection(id: string): boolean {
  return id in GUIDE_SHORTS;
}

const SAFE_BACK = /^\/admin\/[A-Za-z0-9\-._~/%!$&'()*+,;=:@?#]*$/;

/**
 * A page to return to, or null. Only a path inside the admin area is allowed, so a crafted link can never
 * send the owner somewhere else: no scheme, no host, no double slash, no parent step, no spaces.
 */
export function safeGuideBack(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return null;
  if (!SAFE_BACK.test(trimmed)) return null;
  if (trimmed.includes('//')) return null;
  if (/(^|\/)\.\.(\/|$)/.test(trimmed)) return null;
  return trimmed;
}

/** Reads ?back= from a search string and returns a safe page to return to, with the plain fallback. */
export function guideBackTarget(search: string): string {
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get('back');
  } catch {
    raw = null;
  }
  return safeGuideBack(raw) ?? GUIDE_BACK_DEFAULT;
}

/** The link a page uses to open one section of the guide, carrying the page and field to come back to. */
export function guideHref(sectionId: string, back?: string | null): string {
  const safe = safeGuideBack(back ?? null);
  const query = safe ? `?back=${encodeURIComponent(safe)}` : '';
  return `${GUIDE_PATH}${query}${hasGuideSection(sectionId) ? `#${sectionId}` : ''}`;
}
