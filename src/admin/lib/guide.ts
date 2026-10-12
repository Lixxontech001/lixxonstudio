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
  minds: 'The five minds work behind the scenes, and Buddy is the only voice you hear.',
  takeover: 'Takeover is off by default. While it is off the minds cannot change the site.',
  kill: 'Kill stops nothing, one mind, or all of them. The choice is saved until you change it.',
  'video-look': 'Length, caption size and caption colour are the only things the pack video takes from here.',
  packs: 'A pack is one article with its products, its voice and its vertical video, made for one day.',
  'i-posted-this': 'The mark writes your own record only. Buddy never posts for you.',
  'buddy-chat': 'Type to Buddy in plain words. Nothing in this chat changes the site by itself.',
  'product-slots': 'Up to three live products sit on one article. You make the product, and Buddy places it.',
  connections: 'The details for the free places Buddy can post to. Saving stores the details only.',
  // One line per brain, in the fixed try order, from the same slot data the Brains page shows.
  ...Object.fromEntries(BRAIN_SLOTS.map((slot) => [slot.id, slot.id === 'gemini'
    // The owner's own example for the first brain, kept word for word.
    ? 'Get a free key at aistudio.google.com. Paste once. It is never shown again. Test does not publish.'
    : slot.access === 'skip'
      ? 'You do not need a key for this brain yet. Buddy skips it, so Test is off.'
      : `Make the key at ${slot.keySite}. Paste once.`])),
  // One line per place Buddy can post to, from the same door data the Connections page shows.
  ...Object.fromEntries(DOOR_IDS.map((id) => [`door-${id}`, DOORS[id].summary])),
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

const SAFE_BACK_ADMIN = /^\/admin\/[A-Za-z0-9\-._~/%!$&'()*+,;=:@?#]*$/;
const SAFE_BACK_BUDDY = /^\/buddy(?:\/controls)?(?:#[A-Za-z][A-Za-z0-9_:.-]{0,80})?$/;

/**
 * A page to return to, or null. Only a path inside the admin area, or Buddy's own page, is allowed, so a crafted
 * link can never send the owner somewhere else: no scheme, no host, no double slash, no parent step, no spaces.
 */
export function safeGuideBack(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return null;
  if (!SAFE_BACK_ADMIN.test(trimmed) && !SAFE_BACK_BUDDY.test(trimmed)) return null;
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
