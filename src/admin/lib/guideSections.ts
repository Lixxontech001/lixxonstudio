// The owner guide, part two: the numbered steps for every action. This file is loaded only when the owner opens
// the guide itself (see AdminGuide), because the line next to a button only needs part one. It is built from the
// same brain and door data those pages use, so a new brain or place shows up here without a second list to keep.
//
// Rules kept here: English only; no engine words (Vault, RPC, Postgres, RLS, JWT, OAuth); no em dash;
// no country, city or currency names.

import { BRAIN_SLOTS } from '../../../supabase/functions/_shared/brains';
import { DOOR_IDS, DOORS } from '../../../supabase/functions/_shared/doorRegistry';
import { GUIDE_MISSING_SHORT, GUIDE_SHORTS, type GuideSection } from './guide';

/** The steps for each hand written action, in guide order. */
const STEPS: Readonly<Record<string, readonly string[]>> = {
  keys: [
    'Open Keys from the left menu under Operations.',
    'A row says Saved or Not configured. Press Refresh status to read the list again. A refresh tests nothing.',
  ],
  'save-key': [
    'Copy the key from the service first. The section for it on this page says where to get it.',
    'Paste it into the box and press Save. An empty box does nothing.',
    'To change a saved key, paste a new one and press Replace. The old one is gone.',
  ],
  'test-key': [
    'Press Test on the row. The result appears at the top of the page.',
    'Some rows can only be checked for shape, and they say so. Those are not a live check.',
  ],
  'delete-key': [
    'Press Delete on the row, then confirm.',
    'The row goes back to Not configured, and the service stops until a key is saved again.',
  ],
  vapid: [
    'On Keys, make the phone alert keys. A contact address is needed. The pair is saved for you.',
    'Open /admin/settings on your phone and tap Register this device.',
    'Buddy then sends an alert for the briefing kinds and for a finished job. A missing pair is a quiet skip.',
  ],
  takeover: [
    'Open Minds from the left menu under Operations.',
    'Leave it off and the minds only read and report. Turn it on to let the allowed work run by itself.',
    'Each act is written to the daily log. The minds never publish, send, spend or change prices.',
  ],
  kill: [
    'Open Minds and find Kill below Takeover.',
    'Pick All to stop every mind, one name to stop that mind, or None to let them work again.',
    'Nothing runs while a mind is stopped.',
  ],
  minds: [
    'Open Minds from the left menu under Operations.',
    'Takeover decides whether the minds may make the changes they are allowed to make.',
    'Kill stops one mind or all of them. Each act is written to the daily log.',
  ],
  'video-look': [
    'Open Video look from the left menu under Operations.',
    'Set the length in seconds, the caption size and the caption colour, then press Save this look.',
    'The pack video uses only those three. The title, movement, end card and watermark stay as they are.',
  ],
  packs: [
    'Ask Buddy for the day: type "run today" or "make the packs".',
    'See them in Buddy, under Changes, in Your jobs.',
    'Each pack holds at most three products, and every one of them is already on the article. Buddy never posts a pack.',
  ],
  'i-posted-this': [
    'Post the pack by hand on the channel.',
    'Open Buddy, then Changes, then Your jobs, and press I posted this on that pack.',
    'The pack then says it is posted by you, and Buddy stops asking about it.',
  ],
  'buddy-chat': [
    'Type what you want in plain words, for example "how are sales" or "run today".',
    'Buddy can read your published article titles, your shop products and what you told it.',
    'Takeover on the Minds page decides what the minds may change. With it off, nothing on the site changes.',
  ],
  'product-slots': [
    'Make the product in the shop first. Buddy does not create products.',
    'Ask Buddy to put one on an article: "Swap the Calm Skin Routine Guide onto the skin guide".',
    'The swap takes one product off and puts another on. An article keeps at most three.',
    'Readers see them at the end of the article, under Shop this article.',
  ],
  connections: [
    'Open Connections from the Minds page, or type /admin/ai/connections.',
    'Find the place, type its details and press Save once for each detail.',
    'It says Connected only when every detail is saved. Press Test connection to check. The test never posts.',
    'Instagram, TikTok, Facebook and Pinterest stay manual. You post those by hand.',
  ],
};

const GROUP_OF: Readonly<Record<string, string>> = {
  keys: 'Start here', 'save-key': 'Start here', 'test-key': 'Start here', 'delete-key': 'Start here',
  vapid: 'Phone alerts',
  minds: 'Minds', takeover: 'Minds', kill: 'Minds',
  'video-look': 'Video and packs', packs: 'Video and packs', 'i-posted-this': 'Video and packs',
  'product-slots': 'Your articles',
  'buddy-chat': 'Buddy',
  connections: 'Connections',
};

const TITLE_OF: Readonly<Record<string, string>> = {
  keys: 'The Keys page',
  'save-key': 'Save a key',
  'test-key': 'Test a key',
  'delete-key': 'Delete a saved key',
  vapid: 'Phone alerts',
  minds: 'The Minds page',
  takeover: 'Takeover',
  kill: 'Kill (stop the minds)',
  'video-look': 'Video look (length and captions)',
  packs: 'Packs (the day run)',
  'i-posted-this': 'I posted this',
  'buddy-chat': 'Talking to Buddy',
  'product-slots': 'Products on an article',
  connections: 'Connect a free place',
};

const SAVE_AND_TEST = 'Paste it into the Key box and press Save. Press Test for one read-only check that does not publish.';

/** One section per brain, in the fixed try order, built from the same slot data the Brains page uses. */
function brainSection(slot: (typeof BRAIN_SLOTS)[number]): GuideSection {
  if (slot.access === 'skip') {
    return {
      id: slot.id,
      group: 'Brains',
      title: `${slot.label} (skipped for now)`,
      short: GUIDE_SHORTS[slot.id],
      steps: [
        `Leave the box empty. ${slot.accessNote}`,
        'Buddy moves to the next brain in the list instead.',
      ],
    };
  }
  const steps = [
    `Open ${slot.keySite} and sign in.`,
    `Make a free key. ${slot.accessNote}`,
  ];
  if (slot.extraSecretNames.length > 0) steps.push('Copy the account ID the brain asks for as well. Both boxes are needed.');
  steps.push(SAVE_AND_TEST);
  return {
    id: slot.id,
    group: 'Brains',
    title: slot.id === 'gemini' ? 'Google Gemini (the first brain)' : slot.label,
    short: GUIDE_SHORTS[slot.id],
    steps,
  };
}

/** One section per place Buddy can post to, built from the same door data the Connections page uses. */
function doorSection(id: (typeof DOOR_IDS)[number]): GuideSection {
  const door = DOORS[id];
  const fields = door.fields.map((field) => field.label).join(' and ');
  return {
    id: `door-${id}`,
    group: 'Connections',
    title: door.label,
    short: GUIDE_SHORTS[`door-${id}`],
    steps: [
      `Open ${door.label} and sign in. Have these ready: ${fields}.`,
      'Type each one on the Connections page and press Save. Saved values are never shown again.',
      'When every detail is saved it says Connected. Press Test connection then. The test never posts.',
    ],
  };
}

/** The hand written actions, in the order the guide shows them. */
function handWritten(id: string): GuideSection {
  return {
    id,
    group: GROUP_OF[id],
    title: TITLE_OF[id],
    short: GUIDE_SHORTS[id] ?? GUIDE_MISSING_SHORT,
    steps: STEPS[id] ?? [],
  };
}

/** Every section, in the order the guide shows them: key actions, the brains, the rest by hand, then the places. */
export const GUIDE_SECTIONS: readonly GuideSection[] = [
  ...['keys', 'save-key', 'test-key', 'delete-key'].map(handWritten),
  ...BRAIN_SLOTS.map(brainSection),
  ...['vapid', 'minds', 'takeover', 'kill', 'video-look', 'packs', 'i-posted-this', 'product-slots', 'buddy-chat', 'connections'].map(handWritten),
  ...DOOR_IDS.map(doorSection),
];

export function guideSection(id: string): GuideSection | null {
  return GUIDE_SECTIONS.find((section) => section.id === id) ?? null;
}

export interface GuideGroup {
  group: string;
  sections: GuideSection[];
}

/** The sections in display order, grouped under their headings. */
export function guideGroups(): GuideGroup[] {
  const groups: GuideGroup[] = [];
  for (const section of GUIDE_SECTIONS) {
    const last = groups[groups.length - 1];
    if (last && last.group === section.group) last.sections.push(section);
    else groups.push({ group: section.group, sections: [section] });
  }
  return groups;
}
