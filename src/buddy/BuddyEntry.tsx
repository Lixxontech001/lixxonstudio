import BuddyPwaApp, { BuddyAccessGate } from './BuddyPwaApp';
import { BUDDY_CONTROLS_PATH, isBuddyControlsPath } from './buddyPaths';

/** Placeholder while Buddy's chat is being built. It holds no data and offers no actions. */
export function BuddyPlaceholder() {
  return (
    <main className="min-h-screen bg-[#E9E5DC] px-5 py-16 text-[#2B2620]">
      <div className="mx-auto max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[#6E6456]">Lixxon Studio</p>
        <h1 className="mt-3 font-serif text-4xl font-light">Buddy</h1>
        <p className="mt-5 text-base leading-relaxed text-[#4A4238]">
          Buddy is being rebuilt as a private chat. This page is a placeholder for now.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[#6E6456]">
          Nothing here sends, posts or changes anything. Your articles, shop and Admin are not affected.
        </p>
        <a
          href={BUDDY_CONTROLS_PATH}
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-sm border border-[#2B2620] px-4 py-2 text-sm text-[#2B2620] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2B2620]"
        >
          Open the old Buddy controls
        </a>
      </div>
    </main>
  );
}

/** Chooses the placeholder or the old controls. Both sit behind the same owner sign-in and MFA gate. */
export default function BuddyEntry({ pathname }: { pathname: string }) {
  if (isBuddyControlsPath(pathname)) return <BuddyPwaApp />;
  return (
    <BuddyAccessGate>
      <BuddyPlaceholder />
    </BuddyAccessGate>
  );
}
