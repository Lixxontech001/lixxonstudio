import { useEffect, useState } from 'react';

interface QueryStatusNoticeProps {
  loading: boolean;
  hasData: boolean;
  error: string | null;
  onRetry: () => void;
}

export default function QueryStatusNotice({ loading, hasData, error, onRetry }: QueryStatusNoticeProps) {
  const [slow, setSlow] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!loading || hasData || error) {
      setSlow(false);
      setTimedOut(false);
      return;
    }

    setSlow(false);
    setTimedOut(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 6000);
    const timeoutTimer = window.setTimeout(() => setTimedOut(true), 15000);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
    };
  }, [loading, hasData, error]);

  if (error || timedOut) {
    return (
      <section className="container-wide py-8" role="alert" aria-live="assertive">
        <div className="border border-bronze/40 bg-taupe-light/30 p-6 md:p-8">
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-2">Stories unavailable</p>
          <p className="font-serif text-2xl text-charcoal">
            We couldn’t load the latest stories right now.
          </p>
          <p className="text-charcoal-muted mt-2 max-w-xl">
            {timedOut && !error
              ? 'The connection is taking too long. Please try again or reload the page.'
              : 'Please try again. If the problem continues, reload the page.'}
          </p>
          <div className="flex flex-wrap gap-3 mt-5">
            <button type="button" onClick={onRetry} className="btn-bronze min-h-11 px-5 py-3 text-xs uppercase tracking-editorial">
              Retry
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-outline-luxury min-h-11 px-5 py-3 text-xs uppercase tracking-editorial"
            >
              Reload page
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (loading && !hasData && slow) {
    return (
      <section className="container-wide py-6" role="status" aria-live="polite">
        <div className="border border-taupe/50 bg-porcelain p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-charcoal">Still loading — this is taking longer than usual</p>
          <button type="button" onClick={onRetry} className="btn-outline-luxury min-h-11 px-5 py-3 text-xs uppercase tracking-editorial shrink-0">
            Retry
          </button>
        </div>
      </section>
    );
  }

  return null;
}
