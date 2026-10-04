import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  ttsReducer,
  initialState,
  describeVoices,
  groupVoicesByLanguage,
  pickVoiceForLanguage,
  loadPrefs,
  savePrefs,
  PREFS_KEY,
  DEFAULT_PREFS,
  type TtsAction,
  type TtsSentence,
  type TtsState,
  type SleepMode,
  type VoiceInfo,
  type TtsPreferences,
} from '../lib/tts';

export interface UseTtsOptions {
  /** Stable id — changing it stops playback (different article). */
  articleId: string;
  title: string;
  coverImage?: string | null;
  /** BCP-47 language of the article; picks the default voice. */
  lang?: string;
  /** Signed-in reader — preferences sync to reader_tts_preferences. */
  userId?: string | null;
  sentences: TtsSentence[];
  /** Called whenever the active sentence changes (highlight + scroll). */
  onSentence?: (index: number) => void;
}

export interface TtsController {
  state: TtsState;
  voices: VoiceInfo[];
  voicesByLanguage: Map<string, VoiceInfo[]>;
  prefs: TtsPreferences;
  /** Screen-reader announcement of the player state. */
  announcement: string;
  supported: boolean;
  playFrom: (index?: number) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  setVoice: (voiceURI: string) => void;
  setRate: (rate: number) => void;
  setPitch: (pitch: number) => void;
  setVolume: (volume: number) => void;
  setIntroOnly: (on: boolean) => void;
  setSkipHeadings: (on: boolean) => void;
  setSleep: (mode: SleepMode) => void;
}

/**
 * The listen-to-articles engine: one utterance per sentence (so highlighting and
 * prev/next are exact), Media Session lock-screen controls, a sleep timer, and
 * persisted voice/rate/pitch/volume (localStorage + account sync when signed in).
 * Playback deliberately survives route changes — only STOP or a new article ends it.
 */
export function useTts({
  articleId,
  title,
  coverImage,
  lang = 'en',
  userId,
  sentences,
  onSentence,
}: UseTtsOptions): TtsController {
  const sentencesRef = useRef<TtsSentence[]>(sentences);
  sentencesRef.current = sentences;
  const onSentenceRef = useRef(onSentence);
  onSentenceRef.current = onSentence;

  const reducer = useCallback(
    (s: TtsState, a: TtsAction) => ttsReducer(s, a, sentencesRef.current),
    []
  );
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const [prefs, setPrefs] = useState<TtsPreferences>(() => loadPrefs());
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const rawVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const prevStatusRef = useRef<TtsState['status']>('idle');
  const lastSpokenRef = useRef(-1);

  // --- voice enumeration (async on most platforms) -------------------------
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const load = () => {
      const raw = synth.getVoices();
      if (raw.length === 0) return;
      rawVoicesRef.current = raw;
      setVoices(describeVoices(raw));
    };
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, [supported]);

  const activeVoiceURI = useMemo(() => {
    if (state.voiceURI && voices.some((v) => v.voiceURI === state.voiceURI)) return state.voiceURI;
    return pickVoiceForLanguage(voices, lang, prefs)?.voiceURI ?? null;
  }, [state.voiceURI, voices, lang, prefs]);

  // --- persistence: localStorage always; account sync when signed in -------
  const persist = useCallback((patch: Partial<TtsPreferences>, langPrefix?: string) => {
    setPrefs((prev) => {
      const next: TtsPreferences = { ...prev, ...patch };
      if (langPrefix && patch.voiceURI) next.byLanguage = { ...prev.byLanguage, [langPrefix]: patch.voiceURI };
      savePrefs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    // guest/local restore of rate/pitch/volume/voice into the machine
    dispatch({ type: 'SET_RATE', rate: prefs.rate });
    dispatch({ type: 'SET_PITCH', pitch: prefs.pitch });
    dispatch({ type: 'SET_VOLUME', volume: prefs.volume });
    dispatch({ type: 'SET_VOICE', voiceURI: prefs.voiceURI });
    // only on mount / prefs identity change from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY) setPrefs(loadPrefs());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // --- account sync: the remote copy wins on load; changes save debounced ---
  const syncedRef = useRef(false);
  useEffect(() => {
    syncedRef.current = false;
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('reader_tts_preferences')
        .select('prefs')
        .eq('user_id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (data?.prefs) {
        const remote: TtsPreferences = { ...DEFAULT_PREFS, ...(data.prefs as Partial<TtsPreferences>) };
        setPrefs(remote);
        savePrefs(remote);
      }
      syncedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId || !syncedRef.current) return;
    const t = setTimeout(() => {
      void supabase
        .from('reader_tts_preferences')
        .upsert({ user_id: userId, prefs, updated_at: new Date().toISOString() });
    }, 800);
    return () => clearTimeout(t);
  }, [prefs, userId]);

  // --- driving speechSynthesis from state ---------------------------------
  const speakCurrent = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const sentence = sentencesRef.current[state.current];
    if (!sentence) return;
    lastSpokenRef.current = state.current;
    const utter = new SpeechSynthesisUtterance(sentence.text);
    const raw = rawVoicesRef.current.find((v) => v.voiceURI === activeVoiceURI);
    if (raw) utter.voice = raw;
    utter.lang = raw?.lang ?? lang;
    utter.rate = state.rate;
    utter.pitch = state.pitch;
    utter.volume = state.volume;
    utter.onend = () => {
      dispatch({ type: 'SENTENCE_ENDED', now: Date.now() });
    };
    utter.onboundary = () => {
      // Sentence-level sync: keep the active highlight pinned while the engine
      // walks this sentence's words.
      onSentenceRef.current?.(sentence.index);
    };
    synth.speak(utter);
    onSentenceRef.current?.(sentence.index);
    setAnnouncement(`Reading: ${sentence.text.slice(0, 80)}`);
  }, [activeVoiceURI, lang, state.current, state.rate, state.pitch, state.volume, supported]);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const prev = prevStatusRef.current;
    const now = state.status;
    if (now === 'playing') {
      // Plain pause/resume continues the current utterance; anything else
      // (next/prev while paused, rate change, fresh start) re-speaks the sentence.
      if (prev === 'paused' && lastSpokenRef.current === state.current) synth.resume();
      else speakCurrent();
    } else if (now === 'paused') {
      if (lastSpokenRef.current !== state.current) lastSpokenRef.current = -1; // re-speak on resume
      synth.pause();
      setAnnouncement('Paused');
    } else if (prev === 'playing' || prev === 'paused') {
      synth.cancel();
      lastSpokenRef.current = -1;
      setAnnouncement(now === 'ended' ? 'Finished reading.' : 'Stopped');
    }
    prevStatusRef.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.current]);

  // re-speak the current sentence when voice/rate/pitch/volume change mid-play
  useEffect(() => {
    if (supported && state.status === 'playing' && prevStatusRef.current === 'playing') {
      speakCurrent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVoiceURI, state.rate, state.pitch, state.volume]);

  // stop when a different article is loaded
  useEffect(() => {
    dispatch({ type: 'STOP' });
  }, [articleId]);

  // --- sleep timer --------------------------------------------------------
  useEffect(() => {
    if (!state.sleepDeadline) return;
    const check = () => {
      if (state.sleepDeadline && Date.now() >= state.sleepDeadline) {
        dispatch({ type: 'SLEEP_FIRE' });
        setAnnouncement('Sleep timer finished — playback stopped.');
      }
    };
    const t = setInterval(check, 5_000);
    return () => clearInterval(t);
  }, [state.sleepDeadline]);

  // --- Media Session (lock screen / notification controls) ----------------
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const artwork = coverImage || '/icon-512.png';
    try {
      ms.metadata = new MediaMetadata({
        title,
        artist: 'Lixxon Studio',
        album: 'Listen to articles',
        artwork: [
          { src: artwork, sizes: '512x512', type: 'image/png' },
          { src: artwork, sizes: '256x256', type: 'image/png' },
        ],
      });
    } catch { /* older browsers */ }
    const handler = (action: MediaSessionAction, fn: () => void) => {
      try {
        ms.setActionHandler(action, fn);
      } catch { /* unsupported action */ }
    };
    handler('play', () => dispatch({ type: 'RESUME' }));
    handler('pause', () => dispatch({ type: 'PAUSE' }));
    handler('stop', () => dispatch({ type: 'STOP' }));
    handler('nexttrack', () => dispatch({ type: 'NEXT', now: Date.now() }));
    handler('previoustrack', () => dispatch({ type: 'PREV', now: Date.now() }));
    try {
      ms.playbackState = state.status === 'playing' ? 'playing' : state.status === 'paused' ? 'paused' : 'none';
    } catch { /* ignore */ }
    return () => {
      for (const a of ['play', 'pause', 'stop', 'nexttrack', 'previoustrack'] as MediaSessionAction[]) {
        try {
          ms.setActionHandler(a, null);
        } catch { /* ignore */ }
      }
    };
  }, [title, coverImage, state.status]);

  // --- public controls ----------------------------------------------------
  const playFrom = useCallback((index = 0) => {
    dispatch({ type: 'PLAY_FROM', index, total: sentencesRef.current.length, now: Date.now() });
  }, []);
  const toggle = useCallback(() => {
    if (state.status === 'playing') dispatch({ type: 'PAUSE' });
    else if (state.status === 'paused') dispatch({ type: 'RESUME' });
    else playFrom(0);
  }, [state.status, playFrom]);
  const pause = useCallback(() => dispatch({ type: 'PAUSE' }), []);
  const resume = useCallback(() => dispatch({ type: 'RESUME' }), []);
  const stop = useCallback(() => dispatch({ type: 'STOP' }), []);
  const next = useCallback(() => dispatch({ type: 'NEXT', now: Date.now() }), []);
  const prev = useCallback(() => dispatch({ type: 'PREV', now: Date.now() }), []);

  const setVoice = useCallback((voiceURI: string) => {
    dispatch({ type: 'SET_VOICE', voiceURI });
    persist({ voiceURI }, lang.split(/[-_]/)[0]);
  }, [persist, lang]);

  const setRate = useCallback((rate: number) => {
    dispatch({ type: 'SET_RATE', rate });
    persist({ rate });
  }, [persist]);
  const setPitch = useCallback((pitch: number) => {
    dispatch({ type: 'SET_PITCH', pitch });
    persist({ pitch });
  }, [persist]);
  const setVolume = useCallback((volume: number) => {
    dispatch({ type: 'SET_VOLUME', volume });
    persist({ volume });
  }, [persist]);
  const setIntroOnly = useCallback((on: boolean) => {
    dispatch({ type: 'SET_INTRO_ONLY', on, total: sentencesRef.current.length });
    persist({ introOnly: on });
  }, [persist]);
  const setSkipHeadings = useCallback((on: boolean) => {
    dispatch({ type: 'SET_SKIP_HEADINGS', on, total: sentencesRef.current.length });
    persist({ skipHeadings: on });
  }, [persist]);
  const setSleep = useCallback((mode: SleepMode) => {
    dispatch({ type: 'SET_SLEEP', mode, now: Date.now() });
  }, []);

  const voicesByLanguage = useMemo(() => groupVoicesByLanguage(voices), [voices]);

  return {
    state: { ...state, voiceURI: activeVoiceURI },
    voices,
    voicesByLanguage,
    prefs,
    announcement,
    supported,
    playFrom,
    toggle,
    pause,
    resume,
    stop,
    next,
    prev,
    setVoice,
    setRate,
    setPitch,
    setVolume,
    setIntroOnly,
    setSkipHeadings,
    setSleep,
  };
}
