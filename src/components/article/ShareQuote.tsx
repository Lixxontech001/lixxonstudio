import { displayImageUrl } from '../../lib/images';
import { useEffect, useRef, useState } from 'react';
import { Quote, Download, Twitter, X } from 'lucide-react';
import { trackSocialShare } from '../../hooks/usePlatform';

/**
 * Select text inside the article → floating "Share quote" button → renders a branded
 * quote card with the Canvas API (no third-party service) that can be downloaded or tweeted.
 */
export default function ShareQuote({ postId, title, url }: { postId: string; title: string; url: string }) {
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [quote, setQuote] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onUp = () => {
      const s = window.getSelection();
      const text = s?.toString().trim() || '';
      if (!s || !text || text.length < 15 || text.length > 320 || s.rangeCount === 0) { setSel(null); return; }
      const node = s.anchorNode?.parentElement;
      if (!node?.closest('.article-prose')) { setSel(null); return; }
      const r = s.getRangeAt(0).getBoundingClientRect();
      setSel({ text, x: r.left + r.width / 2, y: r.top + window.scrollY - 8 });
    };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('touchend', onUp); };
  }, []);

  const render = (text: string) => {
    const c = canvasRef.current || document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#E9E5DC'; ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = '#B08D57'; ctx.fillRect(80, 80, 4, 470);
    ctx.fillStyle = '#1A1A1A';
    ctx.font = 'italic 44px Georgia, "Times New Roman", serif';
    const words = text.split(/\s+/); const lines: string[] = []; let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > 980 && line) { lines.push(line); line = w; } else line = t;
      if (lines.length === 7) break;
    }
    if (line && lines.length < 7) lines.push(line);
    if (lines.length === 7 && words.join(' ').length > lines.join(' ').length) lines[6] = lines[6].replace(/\s\S*$/, '…');
    const startY = 315 - (lines.length * 58) / 2;
    lines.forEach((l, i) => ctx.fillText(i === 0 ? `“${l}` : l, 120, startY + i * 58 + 20));
    const last = lines[lines.length - 1];
    ctx.fillText('”', 120 + ctx.measureText(last).width + 4, startY + (lines.length - 1) * 58 + 20);
    ctx.font = '22px Georgia, serif'; ctx.fillStyle = '#5A5A5A';
    ctx.fillText(title.length > 70 ? title.slice(0, 68) + '…' : title, 120, 560);
    ctx.font = 'bold 20px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#B08D57';
    ctx.letterSpacing = '4px';
    ctx.fillText('LIXXON STUDIO', 120, 596);
    setCard(c.toDataURL('image/png'));
  };

  const open = () => { if (!sel) return; setQuote(sel.text); render(sel.text); setSel(null); window.getSelection()?.removeAllRanges(); };

  const download = () => {
    if (!card) return;
    const a = document.createElement('a'); a.href = card; a.download = 'lixxon-quote.png'; a.click();
    trackSocialShare(postId, 'quote-card');
  };

  return (
    <>
      {sel && (
        <button onClick={open} style={{ left: sel.x, top: sel.y }} className="absolute z-40 -translate-x-1/2 -translate-y-full px-3 py-2 bg-charcoal text-white text-xs rounded-sm shadow-lg flex items-center gap-1.5 hover:bg-bronze transition-colors print:hidden">
          <Quote size={12} /> Share quote
        </button>
      )}
      <canvas ref={canvasRef} className="hidden" aria-hidden />
      {card && (
        <div role="dialog" aria-modal="true" aria-label="Share this quote" className="fixed inset-0 z-[60] bg-charcoal/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCard(null)}>
          <div className="bg-white rounded-sm max-w-2xl w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-xl text-charcoal">Share this quote</h3>
              <button onClick={() => setCard(null)} aria-label="Close" className="p-2 text-charcoal-muted hover:text-charcoal"><X size={18} /></button>
            </div>
            <img src={displayImageUrl(card)} alt={`Quote card: ${quote}`} className="w-full rounded-sm border border-taupe/40" />
            <div className="flex flex-wrap gap-3 mt-5">
              <button onClick={download} className="inline-flex items-center gap-2 px-5 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze transition-colors"><Download size={14} /> Download image</button>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`“${quote.slice(0, 200)}${quote.length > 200 ? '…' : ''}”`)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" onClick={() => trackSocialShare(postId, 'twitter')} className="inline-flex items-center gap-2 px-5 py-3 border border-taupe text-charcoal text-xs tracking-editorial uppercase rounded-sm hover:border-bronze transition-colors"><Twitter size={14} /> Post on X</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
