/**
 * Listen-to-articles engine (pure core).
 *
 * The reducer here is the single source of truth for the player state machine
 * (idle → playing ⇄ paused → stopped, sentence navigation, sleep timer, voice and
 * rate changes). It is deliberately free of DOM/speech APIs so every transition is
 * unit-testable with a mocked speechSynthesis (see src/__tests__/tts.test.ts).
 */

export type TtsStatus = 'idle' | 'playing' | 'paused' | 'ended';

export type SleepMode = 'off' | 'end' | number; // number = minutes (5/15/30)

export interface TtsSentence {
  /** Stable index used in DOM (data-tts-sentence) and for navigation. */
  index: number;
  text: string;
  /** 'heading' sentences can be skipped via skipHeadings. */
  kind: 'text' | 'heading';
  /** Index of the paragraph this sentence belongs to (click-to-play). */
  paragraph: number;
}

export interface TtsPreferences {
  voiceURI: string | null;
  rate: number;
  pitch: number;
  volume: number;
  /** Remembered voice per language prefix, e.g. { en: 'urn:...', fr: 'urn:...' }. */
  byLanguage: Record<string, string | null>;
  introOnly: boolean;
  skipHeadings: boolean;
}

export interface TtsState {
  status: TtsStatus;
  current: number; // sentence index
  rate: number;
  pitch: number;
  volume: number;
  voiceURI: string | null;
  introOnly: boolean;
  skipHeadings: boolean;
  sleepMode: SleepMode;
  sleepDeadline: number | null; // epoch ms, for timer modes
  total: number; // number of speakable sentences
}

export type TtsAction =
  | { type: 'PLAY_FROM'; index: number; total: number; now: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'NEXT'; now: number }
  | { type: 'PREV'; now: number }
  | { type: 'SENTENCE_ENDED'; now: number }
  | { type: 'SET_VOICE'; voiceURI: string | null }
  | { type: 'SET_RATE'; rate: number }
  | { type: 'SET_PITCH'; pitch: number }
  | { type: 'SET_VOLUME'; volume: number }
  | { type: 'SET_INTRO_ONLY'; on: boolean; total: number }
  | { type: 'SET_SKIP_HEADINGS'; on: boolean; total: number }
  | { type: 'SET_SLEEP'; mode: SleepMode; now: number }
  | { type: 'SLEEP_FIRE' };

export const MIN_RATE = 0.5;
export const MAX_RATE = 2.0;
export const INTRO_SENTENCES = 5;

export function initialState(overrides: Partial<TtsState> = {}): TtsState {
  return {
    status: 'idle',
    current: 0,
    rate: 1,
    pitch: 1,
    volume: 1,
    voiceURI: null,
    introOnly: false,
    skipHeadings: false,
    sleepMode: 'off',
    sleepDeadline: null,
    total: 0,
    ...overrides,
  };
}

export function clampRate(rate: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

/** Index of the first speakable sentence at/after `from` under the current filters. */
export function nextSpeakable(state: TtsState, sentences: TtsSentence[], from: number, dir: 1 | -1): number | null {
  const limit = state.introOnly ? Math.min(sentences.length, INTRO_SENTENCES) : sentences.length;
  for (let i = from; i >= 0 && i < limit; i += dir) {
    const s = sentences[i];
    if (!s) break;
    if (state.skipHeadings && s.kind === 'heading') continue;
    return i;
  }
  return null;
}

/**
 * The state machine. All transitions are pure; side effects (speechSynthesis,
 * DOM highlight, media session) are driven by comparing prev/next state.
 */
export function ttsReducer(state: TtsState, action: TtsAction, sentences: TtsSentence[] = []): TtsState {
  switch (action.type) {
    case 'PLAY_FROM': {
      const total = state.introOnly ? Math.min(action.total, INTRO_SENTENCES) : action.total;
      const probe: TtsState = { ...state, total };
      const start = nextSpeakable(probe, sentences, Math.max(0, Math.min(action.index, Math.max(0, total - 1))), 1);
      return {
        ...state,
        status: 'playing',
        current: start ?? 0,
        total,
        sleepDeadline: sleepDeadline(state.sleepMode, action.now),
      };
    }
    case 'PAUSE':
      return state.status === 'playing' ? { ...state, status: 'paused' } : state;
    case 'RESUME':
      return state.status === 'paused' ? { ...state, status: 'playing' } : state;
    case 'STOP':
      return { ...state, status: 'idle', current: 0, sleepDeadline: null };
    case 'NEXT': {
      if (state.status !== 'playing' && state.status !== 'paused') return state;
      const next = nextSpeakable(state, sentences, state.current + 1, 1);
      return next === null ? { ...state, status: 'ended', sleepDeadline: null } : { ...state, current: next };
    }
    case 'PREV': {
      if (state.status !== 'playing' && state.status !== 'paused') return state;
      const prev = nextSpeakable(state, sentences, state.current - 1, -1);
      return prev === null ? state : { ...state, current: prev };
    }
    case 'SENTENCE_ENDED': {
      if (state.status !== 'playing') return state;
      const next = nextSpeakable(state, sentences, state.current + 1, 1);
      if (next === null) return { ...state, status: 'ended', sleepDeadline: null };
      return {
        ...state,
        current: next,
        // "sleep at end of article" is naturally satisfied: playback ends here.
        sleepDeadline: sleepDeadline(state.sleepMode, action.now),
      };
    }
    case 'SET_VOICE':
      return { ...state, voiceURI: action.voiceURI };
    case 'SET_RATE':
      return { ...state, rate: clampRate(action.rate) };
    case 'SET_PITCH':
      return { ...state, pitch: Math.min(2, Math.max(0, action.pitch)) };
    case 'SET_VOLUME':
      return { ...state, volume: Math.min(1, Math.max(0, action.volume)) };
    case 'SET_INTRO_ONLY':
      return {
        ...state,
        introOnly: action.on,
        total: action.on ? Math.min(action.total, INTRO_SENTENCES) : action.total,
      };
    case 'SET_SKIP_HEADINGS': {
      const next = { ...state, skipHeadings: action.on };
      // If the current sentence is now filtered out, advance to the next speakable one.
      const cur = sentences[state.current];
      if (action.on && cur?.kind === 'heading' && state.status === 'playing') {
        const n = nextSpeakable(next, sentences, state.current + 1, 1);
        return n === null ? { ...next, status: 'ended' } : { ...next, current: n };
      }
      return next;
    }
    case 'SET_SLEEP': {
      const next = { ...state, sleepMode: action.mode };
      return { ...next, sleepDeadline: sleepDeadline(action.mode, action.now) };
    }
    case 'SLEEP_FIRE':
      return state.status === 'playing' || state.status === 'paused'
        ? { ...state, status: 'idle', current: 0, sleepDeadline: null }
        : state;
    default:
      return state;
  }
}

function sleepDeadline(mode: SleepMode, now: number): number | null {
  return typeof mode === 'number' ? now + mode * 60_000 : null;
}

// ---------------------------------------------------------------------------
// Preferences persistence (localStorage for guests; synced per account when the
// reader is signed in — see src/hooks/useTts.ts).
// ---------------------------------------------------------------------------

export const PREFS_KEY = 'lixxon_tts_prefs';

export const DEFAULT_PREFS: TtsPreferences = {
  voiceURI: null,
  rate: 1,
  pitch: 1,
  volume: 1,
  byLanguage: {},
  introOnly: false,
  skipHeadings: false,
};

export function loadPrefs(): TtsPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<TtsPreferences>;
    return {
      voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : null,
      rate: clampRate(typeof parsed.rate === 'number' ? parsed.rate : 1),
      pitch: typeof parsed.pitch === 'number' ? Math.min(2, Math.max(0, parsed.pitch)) : 1,
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : 1,
      byLanguage: typeof parsed.byLanguage === 'object' && parsed.byLanguage ? parsed.byLanguage : {},
      introOnly: parsed.introOnly === true,
      skipHeadings: parsed.skipHeadings === true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: TtsPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* storage disabled */ }
}

// ---------------------------------------------------------------------------
// Voice selection
// ---------------------------------------------------------------------------

export interface VoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  /** Only present when the device labels it — never invented. */
  gender?: string;
  localService: boolean;
  isDefault: boolean;
}

export function describeVoices(voices: readonly SpeechSynthesisVoice[]): VoiceInfo[] {
  return voices.map((v) => {
    const extra = v as SpeechSynthesisVoice & { gender?: string };
    const info: VoiceInfo = {
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      isDefault: v.default,
    };
    if (typeof extra.gender === 'string' && extra.gender) info.gender = extra.gender;
    return info;
  });
}

/** Group voices by language prefix (en, fr, …), sorted by name inside each group. */
export function groupVoicesByLanguage(voices: VoiceInfo[]): Map<string, VoiceInfo[]> {
  const groups = new Map<string, VoiceInfo[]>();
  for (const v of voices) {
    const prefix = v.lang.toLowerCase().split(/[-_]/)[0] || 'und';
    const list = groups.get(prefix) ?? [];
    list.push(v);
    groups.set(prefix, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

/**
 * Best voice for a language: remembered per-language choice → remembered global
 * choice → exact lang → lang prefix → default voice → first voice.
 */
export function pickVoiceForLanguage(
  voices: VoiceInfo[],
  lang: string,
  prefs: TtsPreferences
): VoiceInfo | null {
  if (voices.length === 0) return null;
  const prefix = lang.toLowerCase().split(/[-_]/)[0];
  const remembered = prefs.byLanguage[prefix];
  if (remembered) {
    const v = voices.find((x) => x.voiceURI === remembered);
    if (v) return v;
  }
  if (prefs.voiceURI) {
    const v = voices.find((x) => x.voiceURI === prefs.voiceURI);
    if (v && v.lang.toLowerCase().split(/[-_]/)[0] === prefix) return v;
  }
  return (
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === prefix && v.isDefault) ??
    voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === prefix) ??
    voices.find((v) => v.isDefault) ??
    voices[0]
  );
}

// ---------------------------------------------------------------------------
// Sentence segmentation (markdown-lite text → speakable sentences)
// ---------------------------------------------------------------------------

const SENTENCE_RE = /[^.!?…]+[.!?…]+["'”’)]*|[^.!?…]+$/g;

/** Split a paragraph into sentences, keeping paragraph + heading context. */
export function buildSentences(
  blocks: { text: string; kind: 'text' | 'heading'; paragraph: number }[]
): TtsSentence[] {
  const out: TtsSentence[] = [];
  let index = 0;
  for (const b of blocks) {
    const text = b.text.trim();
    if (!text) continue;
    const parts = text.match(SENTENCE_RE) ?? [text];
    for (const part of parts) {
      const t = part.trim();
      if (!t) continue;
      out.push({ index, text: t, kind: b.kind, paragraph: b.paragraph });
      index += 1;
    }
  }
  return out;
}

/** Strip markdown syntax for speech (links speak their text, images vanish). */
export function speechText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~=]+/g, '')
    .trim();
}

/** True when the optional premium TTS path is enabled (feature flag). */
export function isTtsPremiumEnabled(): boolean {
  try {
    const flags = JSON.parse(localStorage.getItem('lixxon_feature_flags') ?? '{}') as Record<string, unknown>;
    return flags.tts_premium === true;
  } catch {
    return false;
  }
}
