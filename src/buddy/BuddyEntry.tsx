import { useEffect } from 'react';
import BuddyChat from './BuddyChat';
import { BuddyAccessGate } from './BuddyAccessGate';
import { isBuddyControlsPath } from './buddyPaths';

/** Buddy's one home. The old typed-command screen is gone; its old address now leads here. */
export const BUDDY_HOME_PATH = '/buddy';

function goTo(path: string) {
  window.location.replace(path);
}

/**
 * Buddy at /buddy: the greeting, then the chat. Behind the owner sign-in and MFA gate.
 * /buddy/controls is not a screen any more; it moves the owner to /buddy (Vercel does this too).
 */
export default function BuddyEntry({ pathname, redirect = goTo }: { pathname: string; redirect?: (path: string) => void }) {
  const isOldControls = isBuddyControlsPath(pathname);

  useEffect(() => {
    if (isOldControls) redirect(BUDDY_HOME_PATH);
  }, [isOldControls, redirect]);

  if (isOldControls) {
    return (
      <div className="min-h-screen bg-taupe-light p-8 text-center text-sm text-charcoal-muted" role="status">
        Opening Buddy…
      </div>
    );
  }

  return (
    <BuddyAccessGate>
      <BuddyChat />
    </BuddyAccessGate>
  );
}
