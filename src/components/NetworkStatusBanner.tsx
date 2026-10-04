import { useEffect, useState } from 'react';
import { REQUEST_ERROR_EVENT } from '../lib/requestStatus';

interface NetworkStatusBannerProps {
  onRetry?: () => void;
}

export default function NetworkStatusBanner({
  onRetry = () => window.location.reload(),
}: NetworkStatusBannerProps) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [requestFailed, setRequestFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      setRetrying(false);
    };
    const handleOffline = () => {
      setOnline(false);
      setRetrying(false);
    };
    const handleRequestError = () => {
      setRequestFailed(true);
      setRetrying(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(REQUEST_ERROR_EVENT, handleRequestError);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(REQUEST_ERROR_EVENT, handleRequestError);
    };
  }, []);

  if (!online) {
    return (
      <div role="status" aria-live="polite" className="border-b border-taupe/50 bg-taupe-light/60 px-4 py-3 text-charcoal">
        <div className="container-wide flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-sm font-medium">You’re offline</p>
          <p className="text-xs text-charcoal-muted">New stories and account data will load when your connection returns.</p>
        </div>
      </div>
    );
  }

  if (!requestFailed) return null;

  return (
    <div role="alert" aria-live="assertive" aria-busy={retrying} className="border-b border-bronze/40 bg-porcelain px-4 py-3 text-charcoal">
      <div className="container-wide flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">We couldn’t load some data</p>
          <p className="text-xs text-charcoal-muted">Check your connection, then retry this page.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setRetrying(true);
            onRetry();
          }}
          disabled={retrying}
          className="btn-bronze min-h-11 w-full px-5 py-3 text-xs uppercase tracking-editorial sm:w-auto"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </div>
  );
}
