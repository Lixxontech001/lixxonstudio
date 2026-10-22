if (typeof globalThis.WebSocket === 'undefined') {
  class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readyState = 1;
    url = '';
    onopen: ((event: unknown) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessage: ((event: unknown) => void) | null = null;
    send() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = MockWebSocket;
}

// jsdom polyfills for browser APIs the app touches at mount time
// Only where a window exists: database tests run in plain Node and need none of these.
if (typeof window !== 'undefined') {
  if (typeof window.WebSocket === 'undefined') {
    window.WebSocket = globalThis.WebSocket;
  }
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
