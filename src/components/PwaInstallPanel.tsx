import { useEffect, useState } from 'react';

export type InstallableSurface = 'reader' | 'owner' | 'buddy';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const SURFACES: Array<{ id: InstallableSurface; title: string; href: string; description: string }> = [
  { id: 'owner', title: 'Owner/Admin', href: '/admin/dashboard', description: 'Secure controls, daily kit and owner alerts.' },
  { id: 'buddy', title: 'Buddy', href: '/buddy', description: 'A safe assistant with an offline-safe review queue.' },
  { id: 'reader', title: 'Reader', href: '/', description: 'The existing magazine and shop app.' },
];

export default function PwaInstallPanel({ currentApp }: { currentApp: InstallableSurface }) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  // display-mode is shared by same-origin PWAs, so it cannot reliably identify this app.
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
      setMessage('This app was installed on this device.');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const installCurrentApp = async () => {
    if (!installEvent) {
      setShowInstructions(true);
      setMessage('Use your browser menu to install this app; the install prompt is not available in this browser yet.');
      return;
    }
    const prompt = installEvent;
    setInstallEvent(null);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(choice.outcome === 'accepted' ? 'Install accepted. Follow the browser prompt to finish.' : 'Install dismissed. You can install later from the browser menu.');
    } catch {
      setMessage('The browser could not open its install prompt. Use the browser menu instructions below.');
      setShowInstructions(true);
    }
  };

  const current = SURFACES.find((surface) => surface.id === currentApp)!;

  return (
    <section aria-labelledby="pwa-install-title" className="mb-6 rounded-sm border border-taupe/30 bg-white p-5 sm:p-6">
      <h2 id="pwa-install-title" className="text-base font-medium text-charcoal">Installable Lixxon apps</h2>
      <p className="mt-1 text-sm leading-relaxed text-charcoal-muted">
        Each app has its own install identity. Installing Owner/Admin or Buddy does not change the existing Reader app or grant admin access.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {SURFACES.map((surface) => (
          <div key={surface.id} className="rounded-sm border border-taupe/30 bg-taupe-light/40 p-3">
            <h3 className="text-sm font-medium text-charcoal">{surface.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-charcoal-muted">{surface.description}</p>
            <a href={surface.href} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm text-bronze underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze">
              Open {surface.title}<span aria-hidden="true">→</span>
            </a>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={installCurrentApp}
          disabled={installed}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-charcoal px-4 py-2 text-sm font-medium text-white hover:bg-bronze focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60"
        >
          {installed ? `${current.title} installed` : installEvent ? `Install ${current.title}` : `Install ${current.title} / show instructions`}
        </button>
        <p role="status" aria-live="polite" className="text-sm text-charcoal-muted">{message}</p>
      </div>

      {showInstructions && !installed && (
        <div className="mt-4 rounded-sm border border-bronze/30 bg-taupe-light/40 p-4 text-sm text-charcoal" role="note">
          <p className="font-medium">Android Chrome install steps</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-charcoal-muted">
            <li>Open the {current.title} link above in Chrome over HTTPS.</li>
            <li>Open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
            <li>Confirm the app name, then launch it from your home screen. Admin permissions still require an authorized sign-in and MFA when configured.</li>
          </ol>
        </div>
      )}
    </section>
  );
}
