import { useState, useRef, useEffect, useCallback } from 'react';
import {Play, Pause, Square, Gauge} from 'lucide-react';

interface TTSProps {
  postId: string;
  title: string;
  content: string | null;
}

export default function TextToSpeech({ postId, title, content }: TTSProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rate, setRate] = useState(1);
  const [progress, setProgress] = useState(0);
  const [supported, setSupported] = useState(true);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const chunksRef = useRef<string[]>([]);
  const chunkIndexRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setSupported(false);
    }
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setProgress(0);
    chunkIndexRef.current = 0;
  }, [postId]);

  const stripMarkdown = (text: string): string => {
    return text
      .replace(/!\[.+?\]\(.+?\)/g, '')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/[#*`>_~-]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const buildChunks = useCallback((): string[] => {
    if (!content) return [title];
    const clean = stripMarkdown(content);
    const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
    const chunks: string[] = [];
    let current = '';
    for (const s of sentences) {
      if ((current + s).length > 200) {
        if (current) chunks.push(current.trim());
        current = s;
      } else {
        current += s;
      }
    }
    if (current) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [title];
  }, [content, title]);

  const speakChunk = useCallback((index: number) => {
    if (!window.speechSynthesis || index >= chunksRef.current.length) {
      setIsPlaying(false);
      setIsPaused(false);
      setProgress(0);
      chunkIndexRef.current = 0;
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunksRef.current[index]);
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = () => {
      chunkIndexRef.current = index + 1;
      setProgress(((index + 1) / chunksRef.current.length) * 100);
      if (index + 1 < chunksRef.current.length && !window.speechSynthesis.paused) {
        speakChunk(index + 1);
      } else if (index + 1 >= chunksRef.current.length) {
        setIsPlaying(false);
        setIsPaused(false);
        setProgress(0);
        chunkIndexRef.current = 0;
      }
    };
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [rate]);

  const handlePlay = () => {
    if (!supported) return;
    if (isPlaying && isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      return;
    }
    if (isPlaying && !isPaused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      return;
    }
    chunksRef.current = buildChunks();
    chunkIndexRef.current = 0;
    setProgress(0);
    setIsPlaying(true);
    setIsPaused(false);
    speakChunk(0);
  };

  const handleStop = () => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setProgress(0);
    chunkIndexRef.current = 0;
  };

  const cycleRate = () => {
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const currentIdx = rates.indexOf(rate);
    const nextRate = rates[(currentIdx + 1) % rates.length];
    setRate(nextRate);
    if (isPlaying && !isPaused) {
      window.speechSynthesis.cancel();
      setTimeout(() => speakChunk(chunkIndexRef.current), 50);
    }
  };

  if (!supported) return null;

  return (
    <div className="flex items-center gap-3 px-5 py-3 bg-taupe-light/40 rounded-sm border border-taupe/30">
      <button
        onClick={handlePlay}
        className="w-10 h-10 rounded-full bg-charcoal text-white flex items-center justify-center hover:bg-bronze transition-all flex-shrink-0"
        aria-label={isPlaying && !isPaused ? 'Pause' : 'Play'}
      >
        {isPlaying && !isPaused ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      {isPlaying && (
        <button
          onClick={handleStop}
          className="w-9 h-9 rounded-full border border-taupe flex items-center justify-center text-charcoal-muted hover:text-bronze hover:border-bronze transition-all flex-shrink-0"
          aria-label="Stop"
        >
          <Square size={14} />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-charcoal font-medium">
          {isPlaying ? (isPaused ? 'Paused' : 'Listening...') : 'Listen to this article'}
        </p>
        {isPlaying && (
          <div className="h-1 bg-taupe rounded-full mt-1.5 overflow-hidden">
            <div className="h-full bg-bronze transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      {isPlaying && (
        <button
          onClick={cycleRate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-charcoal-muted hover:text-bronze transition-colors flex-shrink-0 border border-taupe/40 rounded-sm"
          aria-label="Adjust speed"
        >
          <Gauge size={12} /> {rate}x
        </button>
      )}
    </div>
  );
}
