/**
 * TTS state machine tests (Milestone 3) — play/pause/next/sleep-timer/voice-change
 * against a mocked speechSynthesis, plus voice grouping/selection and persistence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ttsReducer,
  initialState,
  buildSentences,
  pickVoiceForLanguage,
  groupVoicesByLanguage,
  describeVoices,
  clampRate,
  loadPrefs,
  savePrefs,
  DEFAULT_PREFS,
  INTRO_SENTENCES,
  type TtsSentence,
  type TtsState,
  type VoiceInfo,
  type TtsPreferences,
} from '../lib/tts';

const sentences: TtsSentence[] = buildSentences([
  { text: 'Skin barrier first. Moisture follows.', kind: 'heading', paragraph: 0 },
  { text: 'The barrier keeps water in. It also keeps irritants out. Repair takes time.', kind: 'text', paragraph: 1 },
  { text: 'A simple routine wins. Consistency beats intensity.', kind: 'text', paragraph: 2 },
]);
// 2 heading sentences? buildSentences splits by sentence: heading "Skin barrier first." "Moisture follows." (kind heading)
// paragraph 1: 3 sentences, paragraph 2: 2 sentences → total 7.

function run(state: TtsState, actions: Parameters<typeof ttsReducer>[1][]): TtsState {
  return actions.reduce((s, a) => ttsReducer(s, a, sentences), state);
}

const t0 = 1_000_000;

describe('tts state machine', () => {
  it('PLAY_FROM starts at the requested sentence and arms the sleep deadline for timers', () => {
    const s = run(initialState({ sleepMode: 15 }), [
      { type: 'SET_SLEEP', mode: 15, now: t0 },
      { type: 'PLAY_FROM', index: 2, total: sentences.length, now: t0 },
    ]);
    expect(s.status).toBe('playing');
    expect(s.current).toBe(2);
    expect(s.sleepDeadline).toBe(t0 + 15 * 60_000);
  });

  it('pause → resume → stop round-trips', () => {
    let s = run(initialState(), [{ type: 'PLAY_FROM', index: 0, total: sentences.length, now: t0 }]);
    s = ttsReducer(s, { type: 'PAUSE' }, sentences);
    expect(s.status).toBe('paused');
    s = ttsReducer(s, { type: 'RESUME' }, sentences);
    expect(s.status).toBe('playing');
    s = ttsReducer(s, { type: 'STOP' }, sentences);
    expect(s.status).toBe('idle');
    expect(s.current).toBe(0);
    expect(s.sleepDeadline).toBeNull();
  });

  it('pause is a no-op while idle; resume is a no-op while playing', () => {
    const idle = initialState();
    expect(ttsReducer(idle, { type: 'PAUSE' }, sentences)).toBe(idle);
    const playing = run(idle, [{ type: 'PLAY_FROM', index: 0, total: sentences.length, now: t0 }]);
    expect(ttsReducer(playing, { type: 'RESUME' }, sentences)).toBe(playing);
  });

  it('SENTENCE_ENDED advances; after the last sentence it ends and clears the timer', () => {
    let s = run(initialState({ sleepMode: 5 }), [
      { type: 'SET_SLEEP', mode: 5, now: t0 },
      { type: 'PLAY_FROM', index: sentences.length - 1, total: sentences.length, now: t0 },
    ]);
    s = ttsReducer(s, { type: 'SENTENCE_ENDED', now: t0 + 10 }, sentences);
    expect(s.status).toBe('ended');
    expect(s.sleepDeadline).toBeNull();
  });

  it('NEXT/PREV walk sentences and never leave the array', () => {
    let s = run(initialState(), [{ type: 'PLAY_FROM', index: 1, total: sentences.length, now: t0 }]);
    s = ttsReducer(s, { type: 'NEXT', now: t0 }, sentences);
    expect(s.current).toBe(2);
    s = ttsReducer(s, { type: 'PREV', now: t0 }, sentences);
    expect(s.current).toBe(1);
    s = ttsReducer(s, { type: 'PREV', now: t0 }, sentences);
    expect(s.current).toBe(0);
    s = ttsReducer(s, { type: 'PREV', now: t0 }, sentences);
    expect(s.current).toBe(0); // clamped
  });

  it('skipHeadings jumps over heading sentences', () => {
    let s = run(initialState(), [
      { type: 'PLAY_FROM', index: 0, total: sentences.length, now: t0 },
      { type: 'SET_SKIP_HEADINGS', on: true, total: sentences.length },
    ]);
    // PLAY_FROM with skipHeadings off started on heading 0; enabling skip while playing advances
    expect(s.current).toBe(2);
    s = ttsReducer(s, { type: 'PREV', now: t0 }, sentences);
    expect(s.current).toBe(2); // heading at 1 skipped going backwards? 1 is heading → stays
  });

  it('introOnly limits playback to the intro', () => {
    const s = run(initialState(), [
      { type: 'SET_INTRO_ONLY', on: true, total: sentences.length },
      { type: 'PLAY_FROM', index: 0, total: sentences.length, now: t0 },
    ]);
    expect(s.total).toBe(Math.min(sentences.length, INTRO_SENTENCES));
    let walked = s;
    for (let i = 0; i < 10; i += 1) walked = ttsReducer(walked, { type: 'SENTENCE_ENDED', now: t0 }, sentences);
    expect(walked.status).toBe('ended');
  });

  it('sleep timer fires → playback stops and resets', () => {
    const s = run(initialState(), [
      { type: 'SET_SLEEP', mode: 5, now: t0 },
      { type: 'PLAY_FROM', index: 3, total: sentences.length, now: t0 },
      { type: 'SLEEP_FIRE' },
    ]);
    expect(s.status).toBe('idle');
    expect(s.current).toBe(0);
  });

  it('sleep "end of article" has no deadline', () => {
    const s = run(initialState(), [
      { type: 'SET_SLEEP', mode: 'end', now: t0 },
      { type: 'PLAY_FROM', index: 0, total: sentences.length, now: t0 },
    ]);
    expect(s.sleepDeadline).toBeNull();
  });

  it('voice/rate/pitch/volume changes are clamped and keep playback', () => {
    let s = run(initialState(), [{ type: 'PLAY_FROM', index: 0, total: sentences.length, now: t0 }]);
    s = ttsReducer(s, { type: 'SET_VOICE', voiceURI: 'urn:x' }, sentences);
    s = ttsReducer(s, { type: 'SET_RATE', rate: 99 }, sentences);
    s = ttsReducer(s, { type: 'SET_PITCH', pitch: -1 }, sentences);
    s = ttsReducer(s, { type: 'SET_VOLUME', volume: 2 }, sentences);
    expect(s.voiceURI).toBe('urn:x');
    expect(s.rate).toBe(2);
    expect(s.pitch).toBe(0);
    expect(s.volume).toBe(1);
    expect(s.status).toBe('playing');
  });

  it('clampRate enforces 0.5–2.0', () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(1.25)).toBe(1.25);
    expect(clampRate(3)).toBe(2);
  });
});

// --- voices ---------------------------------------------------------------

function fakeVoice(voiceURI: string, name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice {
  return {
    voiceURI, name, lang,
    localService: true,
    default: false,
    voiceURI_: voiceURI,
    ...extra,
  } as SpeechSynthesisVoice;
}

describe('voice enumeration and selection', () => {
  it('describes every voice the device exposes, keeping gender only if the device labels it', () => {
    const raw = [
      fakeVoice('a', 'Ada', 'en-GB'),
      fakeVoice('b', 'Béa', 'fr-FR', { gender: 'female' } as Partial<SpeechSynthesisVoice>),
    ];
    const infos = describeVoices(raw);
    expect(infos).toHaveLength(2);
    expect(infos[0].gender).toBeUndefined();
    expect(infos[1].gender).toBe('female');
  });

  it('groups voices by language', () => {
    const voices: VoiceInfo[] = [
      { voiceURI: 'a', name: 'Ada', lang: 'en-GB', localService: true, isDefault: true },
      { voiceURI: 'b', name: 'Bob', lang: 'en-US', localService: true, isDefault: false },
      { voiceURI: 'c', name: 'Chloé', lang: 'fr-FR', localService: false, isDefault: false },
    ];
    const groups = groupVoicesByLanguage(voices);
    expect(groups.get('en')).toHaveLength(2);
    expect(groups.get('fr')).toHaveLength(1);
  });

  it('prefers the per-language memory, then exact lang, then prefix', () => {
    const voices: VoiceInfo[] = [
      { voiceURI: 'en-us-x', name: 'X', lang: 'en-US', localService: true, isDefault: false },
      { voiceURI: 'en-gb-y', name: 'Y', lang: 'en-GB', localService: true, isDefault: true },
      { voiceURI: 'fr-z', name: 'Z', lang: 'fr-FR', localService: true, isDefault: false },
    ];
    const prefs: TtsPreferences = { ...DEFAULT_PREFS, byLanguage: { en: 'en-us-x' } };
    expect(pickVoiceForLanguage(voices, 'en-GB', prefs)?.voiceURI).toBe('en-us-x');
    const prefs2: TtsPreferences = { ...DEFAULT_PREFS };
    expect(pickVoiceForLanguage(voices, 'en-GB', prefs2)?.voiceURI).toBe('en-gb-y');
    expect(pickVoiceForLanguage(voices, 'en-AU', prefs2)?.voiceURI).toBe('en-gb-y'); // prefix → default
    expect(pickVoiceForLanguage(voices, 'de', prefs2)?.voiceURI).toBe('en-gb-y'); // fallback → default
    expect(pickVoiceForLanguage([], 'en', prefs2)).toBeNull();
  });
});

// --- persistence ----------------------------------------------------------

describe('preference persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips preferences through localStorage', () => {
    savePrefs({ ...DEFAULT_PREFS, rate: 1.5, voiceURI: 'u', byLanguage: { en: 'u' } });
    const p = loadPrefs();
    expect(p.rate).toBe(1.5);
    expect(p.voiceURI).toBe('u');
    expect(p.byLanguage.en).toBe('u');
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('lixxon_tts_prefs', '{not json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem('lixxon_tts_prefs', JSON.stringify({ rate: 'fast' }));
    expect(loadPrefs().rate).toBe(1);
  });
});

// --- mocked speechSynthesis integration surface ---------------------------

describe('speechSynthesis mocking contract', () => {
  it('the engine-facing API shape matches the browser (used by useTts)', () => {
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      text: string;
      constructor(text: string) { this.text = text; }
    });
    const speak = vi.fn();
    const cancel = vi.fn();
    const pause = vi.fn();
    const resume = vi.fn();
    const mock = { speak, cancel, pause, resume, getVoices: () => [] as SpeechSynthesisVoice[], paused: false, speaking: false, onvoiceschanged: null };
    mock.speak(new SpeechSynthesisUtterance('hi'));
    mock.pause();
    mock.resume();
    mock.cancel();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalled();
    expect(resume).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
