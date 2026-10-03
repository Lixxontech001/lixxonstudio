import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard focus trap for drawers / dialogs (WCAG 2.4.3).
 * - moves focus into the container when it opens
 * - keeps Tab / Shift+Tab inside
 * - Escape calls onClose
 * - restores focus to the previously focused element on close
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onClose?: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const first = container.querySelector<HTMLElement>(FOCUSABLE);
    (first || container).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(n => !n.hidden && n.getAttribute('aria-hidden') !== 'true' && (n.offsetParent !== null || getComputedStyle(n).display !== 'none'));
      if (nodes.length === 0) { e.preventDefault(); return; }
      const firstEl = nodes[0], lastEl = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.({ preventScroll: true }); };
  }, [active, onClose]);
  return ref;
}
