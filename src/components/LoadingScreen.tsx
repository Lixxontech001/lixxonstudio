import { useEffect, useState } from 'react';

interface LoadingScreenProps {
  onComplete: () => void;
}

export default function LoadingScreen({ onComplete }: LoadingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setProgress(40), 300),
      setTimeout(() => setProgress(70), 800),
      setTimeout(() => setProgress(95), 1500),
      setTimeout(() => setProgress(100), 2000),
      setTimeout(() => setFadeOut(true), 2300),
      setTimeout(() => onComplete(), 2800),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center animated-bg transition-opacity duration-500 ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-accent-500/20 blur-3xl blob-1 pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-secondary-500/20 blur-3xl blob-2 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Logo on white pill so it's fully visible on the dark background */}
        <div className="bg-white rounded-2xl px-8 py-5 shadow-2xl">
          <img
            src="/assets/images/lixxon_studio.png"
            alt="Lixxon Studio"
            className="h-14 w-auto object-contain"
          />
        </div>

        {/* Progress bar */}
        <div className="w-64 h-[2px] bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent-500 to-secondary-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <p className="text-white/40 text-sm font-medium tracking-widest uppercase">
          Loading experience
        </p>
      </div>
    </div>
  );
}
