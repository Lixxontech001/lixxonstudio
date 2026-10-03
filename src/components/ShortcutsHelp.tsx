import { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';

const ROWS: [string, string][] = [
  ['/', 'Focus search'], ['?', 'Show this help'], ['g then h', 'Go home'], ['g then s', 'Go to shop'],
  ['g then a', 'Your account'], ['g then b', 'Bookmarks'], ['j / k', 'Next / previous article'], ['b', 'Bookmark article'], ['Esc', 'Close dialogs'],
];

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(o => !o);
    const hide = () => setOpen(false);
    window.addEventListener('lixxon:shortcuts', show);
    window.addEventListener('lixxon:escape', hide);
    return () => { window.removeEventListener('lixxon:shortcuts', show); window.removeEventListener('lixxon:escape', hide); };
  }, []);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="fixed inset-0 z-[70] bg-charcoal/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-sm w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 font-serif text-xl text-charcoal"><Keyboard size={18} className="text-bronze" /> Keyboard shortcuts</h2>
          <button onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-charcoal-muted hover:text-charcoal"><X size={18} /></button>
        </div>
        <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
          {ROWS.map(([k, d]) => (<div key={k} className="contents"><dt><kbd className="px-2 py-0.5 border border-taupe rounded text-xs bg-taupe-light/60 font-mono">{k}</kbd></dt><dd className="text-charcoal-light">{d}</dd></div>))}
        </dl>
      </div>
    </div>
  );
}
