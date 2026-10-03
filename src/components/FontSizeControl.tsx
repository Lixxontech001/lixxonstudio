import { useState, useEffect } from 'react';
import { Type, Minus, Plus } from 'lucide-react';

const FONT_KEY = 'lixxon_font_size';
type FontSize = 'small' | 'medium' | 'large';

export function useFontSize() {
  const [fontSize, setFontSize] = useState<FontSize>('medium');

  useEffect(() => {
    const stored = localStorage.getItem(FONT_KEY) as FontSize | null;
    if (stored === 'small' || stored === 'large') setFontSize(stored);
  }, []);

  const change = (size: FontSize) => {
    setFontSize(size);
    localStorage.setItem(FONT_KEY, size);
  };

  return { fontSize, setFontSize: change };
}

export function FontSizeControl({ fontSize, setFontSize }: { fontSize: FontSize; setFontSize: (s: FontSize) => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-taupe-light/40 rounded-sm border border-taupe/30">
      <Type size={14} strokeWidth={1.5} className="text-charcoal-muted flex-shrink-0" />
      <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted hidden sm:inline">Text</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setFontSize('small')}
          className={`w-8 h-8 rounded-sm flex items-center justify-center transition-all ${fontSize === 'small' ? 'bg-charcoal text-white' : 'text-charcoal-muted hover:text-bronze'}`}
          aria-label="Small text"
          title="Small"
        >
          <Minus size={12} />
        </button>
        <button
          onClick={() => setFontSize('medium')}
          className={`w-8 h-8 rounded-sm flex items-center justify-center transition-all text-sm ${fontSize === 'medium' ? 'bg-charcoal text-white' : 'text-charcoal-muted hover:text-bronze'}`}
          aria-label="Medium text"
          title="Medium"
        >
          A
        </button>
        <button
          onClick={() => setFontSize('large')}
          className={`w-8 h-8 rounded-sm flex items-center justify-center transition-all ${fontSize === 'large' ? 'bg-charcoal text-white' : 'text-charcoal-muted hover:text-bronze'}`}
          aria-label="Large text"
          title="Large"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
