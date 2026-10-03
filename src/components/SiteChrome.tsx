import { useEffect, useState } from 'react';
import { Megaphone, X, Wrench } from 'lucide-react';
import { useSiteSettings } from '../hooks/useV3';
import { useAuth } from '../context/AuthContext';

/** Skip link for keyboard / screen-reader users (first focusable element on the page). */
export function SkipLink() {
  return (
    <a href="#main" onClick={e => { e.preventDefault(); const m = document.querySelector('main'); if (m) { m.setAttribute('tabindex', '-1'); m.focus(); m.scrollIntoView(); } }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:bg-charcoal focus:text-white focus:text-sm focus:rounded-sm">
      Skip to content
    </a>
  );
}

/** Announcement bar driven by `site_settings.announcement` (admin-editable, dismissable per message). */
export function AnnouncementBar() {
  const settings = useSiteSettings();
  const a = settings.announcement as { enabled?: boolean; text?: string; link?: string; link_label?: string } | undefined;
  const [hidden, setHidden] = useState(true);
  useEffect(() => { if (a?.enabled && a.text) setHidden(sessionStorage.getItem('ann_dismissed') === a.text); }, [a?.enabled, a?.text]);
  if (!a?.enabled || !a.text || hidden) return null;
  return (
    <div role="region" aria-label="Announcement" className="bg-charcoal text-cream text-xs md:text-sm print:hidden">
      <div className="container-wide py-2.5 flex items-center gap-3">
        <Megaphone size={14} className="text-bronze flex-shrink-0" />
        <p className="flex-1 text-center">{a.text}{a.link && <a href={a.link} className="ml-2 underline underline-offset-2 text-bronze hover:text-white">{a.link_label || 'Learn more'}</a>}</p>
        <button onClick={() => { sessionStorage.setItem('ann_dismissed', a.text || ''); setHidden(true); }} aria-label="Dismiss announcement" className="p-1 text-cream/60 hover:text-white"><X size={14} /></button>
      </div>
    </div>
  );
}

/** Maintenance mode (admins still see the site). */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const settings = useSiteSettings();
  const { isAdmin } = useAuth();
  const m = settings.maintenance as { enabled?: boolean; message?: string } | undefined;
  if (!m?.enabled || isAdmin || window.location.pathname.startsWith('/admin')) return <>{children}</>;
  return (
    <main className="min-h-screen flex items-center justify-center p-8 text-center bg-cream">
      <div>
        <Wrench size={32} strokeWidth={1.25} className="mx-auto text-bronze mb-6" />
        <h1 className="font-serif text-4xl text-charcoal mb-3">Back shortly</h1>
        <p className="text-charcoal-light max-w-sm mx-auto">{m.message || 'We are polishing a few things. Please check back soon.'}</p>
      </div>
    </main>
  );
}
