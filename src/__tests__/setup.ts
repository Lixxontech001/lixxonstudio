// jsdom polyfills for browser APIs the app touches at mount time
// Only where a window exists: database tests run in plain Node and need none of these.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
  if (!('IntersectionObserver' in window)) {
    class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; }
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  }
  if (!('ResizeObserver' in window)) {
    class RO { observe() {} unobserve() {} disconnect() {} }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  }
  window.scrollTo = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
}
