import type { ReactNode } from 'react';
import MfaGate from '../admin/MfaGate';
import { useAuth } from '../context/AuthContext';

/** Shown to anyone who is not signed in to Admin. Buddy uses the same owner sign-in as Admin. */
function BuddySignInNotice() {
  return (
    <div className="mx-auto max-w-xl rounded-sm border border-taupe/40 bg-white p-6 text-center shadow-sm">
      <h1 className="mt-3 font-serif text-2xl text-charcoal">Sign in to Buddy</h1>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-muted">Buddy is an owner/admin surface. It uses the existing Admin sign-in, permissions and MFA; installing this app does not grant access.</p>
      <a href="/admin/login" className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-charcoal px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal">
        Open Admin sign-in
      </a>
    </div>
  );
}

/** Buddy's gate: a signed-in Admin with a verified code (MFA) sees the children. Nothing else. */
export function BuddyAccessGate({ children }: { children: ReactNode }) {
  const { session, loading, isAdmin, refreshAdmin } = useAuth();
  if (loading) return <div className="min-h-screen bg-taupe-light p-8 text-center text-sm text-charcoal-muted" role="status">Checking your Admin sign-in…</div>;
  if (!session) return <main className="min-h-screen bg-taupe-light p-5 pt-16"><BuddySignInNotice /></main>;
  if (!isAdmin) {
    return <main className="min-h-screen bg-taupe-light p-5 pt-16"><div className="mx-auto max-w-xl rounded-sm border border-taupe/40 bg-white p-6 text-center"><h1 className="mt-3 font-serif text-2xl">Buddy is restricted</h1><p className="mt-2 text-sm text-charcoal-muted">This account does not have active Admin access. Nothing was sent.</p><a href="/admin/login" className="mt-4 inline-flex min-h-11 items-center justify-center rounded-sm border border-charcoal px-4 py-2 text-sm underline">Open Admin sign-in</a></div></main>;
  }
  return <MfaGate onVerified={refreshAdmin}>{children}</MfaGate>;
}

export default BuddyAccessGate;
