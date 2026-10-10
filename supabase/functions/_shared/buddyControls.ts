// Chat controls: pause or resume one free door, stop or start one mind, stop or start every mind.
// Pure rules. The chat only reads the request. A change is made by the server, and only when Takeover is on.
// Takeover off means the request is saved as waiting and nothing changes.

import { DOOR_IDS, type DoorId } from "./doorRegistry.ts";

export const CONTROL_MINDS = ["analyst", "strategist", "ceo", "executioner"] as const;
export type ControlMind = (typeof CONTROL_MINDS)[number];

export type ControlAction =
  | { kind: "kill_mind"; mind: ControlMind }
  | { kind: "kill_all" }
  | { kind: "clear_kill" }
  | { kind: "pause_door"; door: DoorId }
  | { kind: "resume_door"; door: DoorId };

export type ControlParse = { ok: true; action: ControlAction } | { ok: false; refusal: string };

export const AUDITOR_REFUSAL = "The Auditor stays on. It checks every change, so Buddy will not switch it off.";
export const TAKEOVER_REFUSAL = "Buddy does not switch Takeover on or off. You do that yourself.";
export const MIXED_MINDS_REFUSAL = "Buddy can stop one mind or all of them, not a mix. Ask for one mind at a time.";

export const WAIT_LINE = "Saved. Takeover is off, so nothing has changed. It is waiting for you. Ask me again once Takeover is on.";
export const UNREADABLE_LINE = "I could not read Takeover just now, so nothing has changed. It is waiting for you.";

const DOOR_NAMES: Record<DoorId, RegExp> = {
  telegram: /\btelegram\b/i,
  bluesky: /\bbluesky\b/i,
  mastodon: /\bmastodon\b/i,
  tumblr: /\btumblr\b/i,
  discord: /\bdiscord\b/i,
  blogger: /\bblogger\b/i,
  medium: /\bmedium\b/i,
  youtube: /\byoutube\b/i,
  pixelfed: /\bpixelfed\b/i,
  wordpress_com: /\bwordpress(\.com)?\b/i,
  podcast: /\bpodcast\b/i,
  vimeo: /\bvimeo\b/i,
  flipboard: /\bflipboard\b/i,
  google_news: /\bgoogle news\b/i,
  microsoft_start: /\bmicrosoft start\b/i,
  smartnews: /\bsmartnews\b/i,
};

const MIND_NAMES: Record<ControlMind | "auditor", RegExp> = {
  analyst: /\banalyst\b/i,
  strategist: /\bstrategist\b/i,
  ceo: /\bceo\b/i,
  executioner: /\bexecutioner\b/i,
  auditor: /\bauditor\b/i,
};

const PAUSE_WORDS = /\b(pause|hold|stop|switch off|turn off|disable|kill|halt|shut off)\b/i;
const RESUME_WORDS = /\b(resume|unpause|restart|switch on|turn on|re-?enable|start|bring back)\b/i;
const TAKEOVER_SWITCH = /\btakeover\b.*\b(on|off)\b|\b(turn|switch)\s+(takeover\s+)?(on|off)\b.*\btakeover\b/i;
const CLEAR_KILL = /\b(clear|lift|remove)\b.*\bkill\b|\b(start|resume|restart|turn on|switch on|bring back)\s+(everything|all)\b/i;
const KILL_ALL = /\b(stop|kill|halt|pause|shut off)\s+(everything|all)\b|\b(all|every)\s+(the\s+)?minds?\b.*\b(stop|kill|halt|pause)\b/i;

function namedMinds(text: string): ControlMind[] {
  return CONTROL_MINDS.filter((mind) => MIND_NAMES[mind].test(text));
}

/**
 * Reads one chat control request. Returns null when the text is not a control request at all, so the
 * ordinary routes handle it. Questions must be filtered out by the caller first.
 */
export function parseControlRequest(text: string): ControlParse | null {
  if (TAKEOVER_SWITCH.test(text)) return { ok: false, refusal: TAKEOVER_REFUSAL };
  const pause = PAUSE_WORDS.test(text);
  const resume = RESUME_WORDS.test(text);

  // Doors need the word "door" or "doors", so "the medium pack" is never a door.
  if (/\bdoors?\b/i.test(text)) {
    const doors = DOOR_IDS.filter((door) => DOOR_NAMES[door].test(text));
    if (doors.length === 1) {
      if (pause && !resume) return { ok: true, action: { kind: "pause_door", door: doors[0] } };
      if (resume && !pause) return { ok: true, action: { kind: "resume_door", door: doors[0] } };
    }
    if (doors.length > 1) return null;
  }

  if (CLEAR_KILL.test(text)) return { ok: true, action: { kind: "clear_kill" } };
  if (KILL_ALL.test(text)) return { ok: true, action: { kind: "kill_all" } };

  const minds = namedMinds(text);
  const auditorNamed = MIND_NAMES.auditor.test(text);
  if (auditorNamed && (pause || resume)) return { ok: false, refusal: AUDITOR_REFUSAL };
  if (minds.length > 1 && pause) return { ok: false, refusal: MIXED_MINDS_REFUSAL };
  if (minds.length === 1 && pause && !resume) return { ok: true, action: { kind: "kill_mind", mind: minds[0] } };
  if (minds.length === 1 && resume && !pause) return { ok: true, action: { kind: "clear_kill" } };
  return null;
}

/** What the chat says once a change is made. Plain words, no jargon. */
export function controlDoneLine(action: ControlAction): string {
  switch (action.kind) {
    case "kill_mind":
      return `Stopped the ${MIND_LABEL[action.mind]}. It will not run until you start it again.`;
    case "kill_all":
      return "Stopped every mind. Nothing runs until you start them again.";
    case "clear_kill":
      return "Started the minds again. Nothing is stopped now.";
    case "pause_door":
      return `Paused the ${DOOR_LABEL[action.door]} door. Buddy will not post there until you resume it.`;
    case "resume_door":
      return `Resumed the ${DOOR_LABEL[action.door]} door.`;
  }
}

export const MIND_LABEL: Record<ControlMind, string> = {
  analyst: "Analyst",
  strategist: "Strategist",
  ceo: "CEO",
  executioner: "Executioner",
};

export const DOOR_LABEL: Record<DoorId, string> = {
  telegram: "Telegram",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  tumblr: "Tumblr",
  discord: "Discord",
  blogger: "Blogger",
  medium: "Medium",
  youtube: "YouTube",
  pixelfed: "Pixelfed",
  wordpress_com: "WordPress.com",
  podcast: "Podcast",
  vimeo: "Vimeo",
  flipboard: "Flipboard",
  google_news: "Google News",
  microsoft_start: "Microsoft Start",
  smartnews: "SmartNews",
};

export interface ControlCurrent {
  killScope: string;
  pausedDoors: readonly string[];
}

export interface ControlChange {
  kill_scope?: string;
  paused_doors?: string[];
}

/** The row change one action makes, given the current state. Pure, so the server only writes what this says. */
export function controlChange(action: ControlAction, current: ControlCurrent): ControlChange {
  switch (action.kind) {
    case "kill_mind":
      return { kill_scope: action.mind };
    case "kill_all":
      return { kill_scope: "all" };
    case "clear_kill":
      return { kill_scope: "none" };
    case "pause_door": {
      const next = current.pausedDoors.includes(action.door) ? [...current.pausedDoors] : [...current.pausedDoors, action.door];
      return { paused_doors: next };
    }
    case "resume_door":
      return { paused_doors: current.pausedDoors.filter((door) => door !== action.door) };
  }
}
