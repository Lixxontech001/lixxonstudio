type RevealObserver = IntersectionObserver;

/**
 * Installs the progressive-enhancement reveal behaviour. The CSS remains
 * visible unless this function can safely install an IntersectionObserver.
 */
export function initReveal(): void {
  const root = document.documentElement;
  root.classList.remove('js-reveal');

  if (!('IntersectionObserver' in window)) return;

  let revealObserver: RevealObserver | null = null;
  let revealTimeout: number | null = null;

  const revealAll = () => {
    document.querySelectorAll('.reveal:not(.revealed)').forEach((element) => {
      element.classList.add('revealed');
      revealObserver?.unobserve(element);
    });
  };

  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    revealObserver = new window.IntersectionObserver(
      (entries) => {
        try {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('revealed');
              revealObserver?.unobserve(entry.target);
            }
          });
        } catch {
          root.classList.remove('js-reveal');
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    );

    root.classList.add('js-reveal');

    const revealInViewport = () => {
      const viewportBottom = window.innerHeight || document.documentElement.clientHeight;
      document.querySelectorAll('.reveal:not(.revealed)').forEach((element) => {
        try {
          if (element.getBoundingClientRect().top <= viewportBottom) {
            element.classList.add('revealed');
            revealObserver?.unobserve(element);
          }
        } catch {
          // IntersectionObserver will handle the element if its layout is not ready yet.
        }
      });
    };

    const observeReveals = () => {
      if (typeof window === 'undefined') return;
      if (revealTimeout) window.clearTimeout(revealTimeout);
      // Do this before the debounce so content in or above the viewport never
      // spends a paint hidden behind the animation gate.
      revealInViewport();
      revealTimeout = window.setTimeout(() => {
        document.querySelectorAll('.reveal:not(.revealed)').forEach((element) => {
          revealObserver?.observe(element);
        });
      }, 50);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') revealAll();
    };

    const mutationObserver = new MutationObserver(observeReveals);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('load', revealAll);
    window.addEventListener('pageshow', revealAll);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.setTimeout(revealAll, 3000);
    observeReveals();
  } catch {
    root.classList.remove('js-reveal');
  }
}
