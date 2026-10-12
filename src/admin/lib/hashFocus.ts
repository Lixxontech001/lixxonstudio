// Coming back from the guide: the address ends in #some-field, and that field may only appear after the page has
// loaded its data. These helpers look for the element a few times, then stop. Nothing else happens: no click, no
// submit, no value is read or written.

/** The id inside a hash, or null when the hash is empty or not a plain element id. */
export function hashTargetId(hash: string): string | null {
  const raw = typeof hash === 'string' && hash.startsWith('#') ? hash.slice(1) : '';
  return /^[A-Za-z][A-Za-z0-9_:.-]{0,80}$/.test(raw) ? raw : null;
}

/**
 * Looks for the element an address hash names, waiting a short while because the field may be drawn after the
 * page reads its data. It is brought into view, and focused when the owner types in it. Returns a cancel function.
 */
export function restoreHashFocus(
  hash: string,
  doc: Document = document,
  tries = 12,
  intervalMs = 150,
): () => void {
  const id = hashTargetId(hash);
  if (!id) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let left = Math.max(1, tries);
  const look = () => {
    const element = doc.getElementById(id);
    if (element) {
      element.scrollIntoView?.({ block: 'center' });
      const typed = /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(element.tagName) || element.hasAttribute('tabindex');
      if (typed && typeof (element as HTMLElement).focus === 'function') (element as HTMLElement).focus({ preventScroll: true });
      return;
    }
    if (--left > 0) timer = setTimeout(look, intervalMs);
  };
  look();
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}
