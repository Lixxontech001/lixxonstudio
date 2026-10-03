import { useEffect } from 'react';
import { useNavigation } from '../context/NavigationContext';

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/**
 * Global keyboard shortcuts:  /  focus search · g h home · g s shop · g a account · ? help
 * Article pages add j / k (next / previous article) and b (bookmark) via custom events.
 */
export function useKeyboardShortcuts() {
  const { navigate } = useNavigation();
  useEffect(() => {
    let chord = '';
    let timer: number | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('input[type="search"], input[name="q"], [data-search-input]');
        if (input) input.focus(); else navigate({ name: 'search', query: '', page: 1 });
        return;
      }
      if (e.key === '?') { window.dispatchEvent(new CustomEvent('lixxon:shortcuts')); return; }
      if (e.key === 'Escape') { window.dispatchEvent(new CustomEvent('lixxon:escape')); return; }
      if (['j', 'k', 'b'].includes(e.key)) { window.dispatchEvent(new CustomEvent('lixxon:key', { detail: e.key })); return; }
      if (e.key === 'g') { chord = 'g'; window.clearTimeout(timer); timer = window.setTimeout(() => { chord = ''; }, 800); return; }
      if (chord === 'g') {
        chord = '';
        if (e.key === 'h') navigate({ name: 'home', page: 1 });
        if (e.key === 's') navigate({ name: 'shop' });
        if (e.key === 'a') navigate({ name: 'account' });
        if (e.key === 'b') navigate({ name: 'bookmarks' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}
