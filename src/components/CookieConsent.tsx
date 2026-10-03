import { useState, useEffect } from 'react';
import { X, Cookie } from 'lucide-react';
import { Link } from '../context/NavigationContext';

const CONSENT_KEY = 'lixxon_cookie_consent';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY);
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    setVisible(false);
  };

  const handleDismiss = () => {
    localStorage.setItem(CONSENT_KEY, 'dismissed');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-50 animate-fade-up">
      <div className="bg-charcoal text-white rounded-sm luxury-shadow-lg p-5 border border-white/10">
        <div className="flex items-start gap-3">
          <Cookie size={20} className="text-bronze flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm leading-relaxed text-white/80">
              We use minimal cookies to improve your reading experience. By continuing, you agree to our use of cookies.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleAccept}
                className="px-5 py-2 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all"
              >
                Accept
              </button>
              <Link to={{ name: 'privacy' }} className="text-xs text-white/50 hover:text-bronze transition-colors" onClick={handleDismiss}>
                Learn more
              </Link>
            </div>
          </div>
          <button onClick={handleDismiss} className="text-white/40 hover:text-white transition-colors flex-shrink-0" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
