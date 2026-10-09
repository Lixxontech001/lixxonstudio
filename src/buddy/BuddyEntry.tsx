import BuddyPwaApp, { BuddyAccessGate } from './BuddyPwaApp';
import { isBuddyControlsPath } from './buddyPaths';
import BuddyChat from './BuddyChat';

/** Buddy's chat at /buddy, or the old controls at /buddy/controls. Both sit behind the owner sign-in and MFA gate. */
export default function BuddyEntry({ pathname }: { pathname: string }) {
  if (isBuddyControlsPath(pathname)) return <BuddyPwaApp />;
  return (
    <BuddyAccessGate>
      <BuddyChat />
    </BuddyAccessGate>
  );
}
