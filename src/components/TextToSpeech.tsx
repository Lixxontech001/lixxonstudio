import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, Square, SkipBack, SkipForward, Gauge, Timer, Mic2, ListTree, Sparkles,
} from 'lucide-react';
import type { RefObject } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTts } from '../hooks/useTts';
import {
  buildSentences,
  speechText,
  type SleepMode,
  type TtsSentence,
} from '../lib/tts';
import { attachSentenceSpans, highlightSentence, sentenceIndexFromEvent } from '../lib/ttsDom';

interface TTSProps {
  postId: string;
  title: string;
  content: string | null;
  coverImage?: string | null;
  lang?: string;
  /** The article body element — sentence spans are attached to it for highlighting. */
  containerRef?: RefObject<HTMLElement>;
}

const SLEEP_OPTIONS: { label: string; value: string }[] = [
  { label: 'Off', value: 'off' },
  { label: 'End of article', value: 'end' },
  { label: '5 minutes', value: '5' },
  { label: '15 minutes', value: '15' },
  { label: '30 minutes', value: '30' },
];

export default function TextToSpeech({ postId, title, content, coverImage, lang, containerRef }: TTSProps) {
  const proseRef = containerRef;
  const { user } = useAuth();
  const [sentences, setSentences] = useState<TtsSentence[]>([]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const lastScrolledRef = useRef(-1);

  // Build sentence spans in the rendered article (idempotent).
  useEffect(() => {
    const el = proseRef?.current;
    if (!el) return;
    const list = attachSentenceSpans(el);
    setSentences(list);
  }, [content, proseRef]);

  const onSentence = useMemo(() => (index: number) => {
    const el = proseRef?.current ?? null;
    highlightSentence(el, index);
    if (lastScrolledRef.current !== index) {
      lastScrolledRef.current = index;
      const span = el?.querySelector(`span[data-tts-sentence="${index}"]`);
      span?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [proseRef]);

  const tts = useTts({
    articleId: postId,
    title,
    coverImage,
    lang,
    userId: user?.id ?? null,
    sentences,
    onSentence,
  });

  // Click any paragraph to start reading from there.
  useEffect(() => {
    const el = proseRef?.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const idx = sentenceIndexFromEvent(e.target);
      if (idx !== null) tts.playFrom(idx);
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [proseRef, tts]);

  // Keyboard shortcuts while the player is active (never while typing).
  useEffect(() => {
    const active = tts.state.status === 'playing' || tts.state.status === 'paused';
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); tts.toggle(); }
      else if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); tts.next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'j') { e.preventDefault(); tts.prev(); }
      else if (e.key === 'Escape') { tts.stop(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tts]);

  if (!tts.supported) {
    return (
      <p className="text-xs text-charcoal-muted px-5 py-3 bg-taupe-light/40 rounded-sm border border-taupe/30">
        Audio playback is not supported in this browser — the article is fully readable below.
      </p>
    );
  }

  const { state, voices, voicesByLanguage, announcement } = tts;
  const progress = state.total > 0 ? Math.round(((state.current + 1) / state.total) * 100) : 0;
  const noVoices = voices.length === 0;

  return (
    <section
      aria-label="Listen to this article"
      className="px-5 py-4 bg-taupe-light/40 rounded-sm border border-taupe/30"
    >
      <div aria-live="polite" className="sr-only">{announcement}</div>

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={tts.prev}
          className="w-9 h-9 rounded-full border border-taupe flex items-center justify-center text-charcoal-muted hover:text-bronze hover:border-bronze transition-all flex-shrink-0"
          aria-label="Previous sentence"
          disabled={state.status === 'idle'}
        >
          <SkipBack size={14} />
        </button>
        <button
          onClick={tts.toggle}
          className="w-11 h-11 rounded-full bg-charcoal text-white flex items-center justify-center hover:bg-bronze transition-all flex-shrink-0"
          aria-label={state.status === 'playing' ? 'Pause reading' : 'Play article'}
        >
          {state.status === 'playing' ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <button
          onClick={tts.next}
          className="w-9 h-9 rounded-full border border-taupe flex items-center justify-center text-charcoal-muted hover:text-bronze hover:border-bronze transition-all flex-shrink-0"
          aria-label="Next sentence"
          disabled={state.status === 'idle'}
        >
          <SkipForward size={14} />
        </button>
        <button
          onClick={tts.stop}
          className="w-9 h-9 rounded-full border border-taupe flex items-center justify-center text-charcoal-muted hover:text-bronze hover:border-bronze transition-all flex-shrink-0"
          aria-label="Stop reading"
          disabled={state.status === 'idle'}
        >
          <Square size={13} />
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-charcoal font-medium">
            {state.status === 'playing' ? 'Listening…' : state.status === 'paused' ? 'Paused' : state.status === 'ended' ? 'Finished' : 'Listen to this article'}
          </p>
          <div className="h-1 bg-taupe rounded-full mt-1.5 overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Reading progress">
            <div className="h-full bg-bronze transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <button
          onClick={() => setVoiceOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-charcoal-muted hover:text-bronze transition-colors flex-shrink-0 border border-taupe/40 rounded-sm"
          aria-expanded={voiceOpen}
          aria-label="Voice and speed settings"
        >
          <Gauge size={12} /> <span className="hidden sm:inline">Voice</span>
        </button>
      </div>

      {voiceOpen && (
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="tts-voice" className="flex items-center gap-1.5 text-xs font-medium text-charcoal mb-1.5">
              <Mic2 size={12} /> Voice
            </label>
            {noVoices ? (
              <p className="text-xs text-charcoal-muted">
                No system voices are available on this device yet — playback will use the browser default.
              </p>
            ) : (
              <select
                id="tts-voice"
                value={state.voiceURI ?? ''}
                onChange={(e) => tts.setVoice(e.target.value)}
                className="w-full text-sm border border-taupe rounded-sm px-3 py-2 bg-white text-charcoal"
              >
                {[...voicesByLanguage.entries()].map(([prefix, list]) => (
                  <optgroup key={prefix} label={prefix.toUpperCase()}>
                    {list.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} — {v.lang}{v.gender ? ` (${v.gender})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="tts-rate" className="text-xs font-medium text-charcoal">Speed {state.rate.toFixed(2)}x</label>
              <input
                id="tts-rate"
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={state.rate}
                onChange={(e) => tts.setRate(Number(e.target.value))}
                className="w-full accent-bronze"
              />
            </div>
            <div>
              <label htmlFor="tts-pitch" className="text-xs font-medium text-charcoal">Pitch {state.pitch.toFixed(2)}</label>
              <input
                id="tts-pitch"
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={state.pitch}
                onChange={(e) => tts.setPitch(Number(e.target.value))}
                className="w-full accent-bronze"
              />
            </div>
            <div>
              <label htmlFor="tts-volume" className="text-xs font-medium text-charcoal">Volume {Math.round(state.volume * 100)}%</label>
              <input
                id="tts-volume"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={state.volume}
                onChange={(e) => tts.setVolume(Number(e.target.value))}
                className="w-full accent-bronze"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-charcoal">
              <input type="checkbox" checked={state.introOnly} onChange={(e) => tts.setIntroOnly(e.target.checked)} className="accent-bronze" />
              <Sparkles size={12} /> Read intro only
            </label>
            <label className="flex items-center gap-2 text-xs text-charcoal">
              <input type="checkbox" checked={state.skipHeadings} onChange={(e) => tts.setSkipHeadings(e.target.checked)} className="accent-bronze" />
              <ListTree size={12} /> Skip headings
            </label>
            <label className="flex items-center gap-2 text-xs text-charcoal">
              <Timer size={12} />
              <span className="sr-only">Sleep timer</span>
              <select
                aria-label="Sleep timer"
                value={String(state.sleepMode)}
                onChange={(e) => {
                  const v = e.target.value;
                  tts.setSleep(v === 'off' || v === 'end' ? (v as SleepMode) : Number(v) as SleepMode);
                }}
                className="border border-taupe rounded-sm px-2 py-1 bg-white text-charcoal text-xs"
              >
                {SLEEP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>Sleep: {o.label}</option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-[11px] text-charcoal-muted leading-relaxed">
            Shortcuts: <kbd className="px-1 border border-taupe rounded">Space</kbd> play/pause ·
            <kbd className="px-1 border border-taupe rounded">←</kbd> <kbd className="px-1 border border-taupe rounded">→</kbd> sentences ·
            <kbd className="px-1 border border-taupe rounded">Esc</kbd> stop. Tap any paragraph to start from there.
          </p>
        </div>
      )}
    </section>
  );
}

/** Sentence list builder used by tests and the article reader. */
export function sentencesFromMarkdown(content: string | null, title: string): TtsSentence[] {
  const blocks = (content ? speechText(content) : title)
    .split(/\n{2,}/)
    .map((text, paragraph) => ({ text, kind: 'text' as const, paragraph }));
  return buildSentences(blocks);
}
