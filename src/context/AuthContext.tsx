import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Session, User } from '@supabase/supabase-js';

export type AdminRole = 'owner' | 'editor' | 'moderator' | null;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  email: string | null;
  loading: boolean;
  /** true only when the user has a row in app_admins (checked server-side via RLS) */
  isAdmin: boolean;
  adminRole: AdminRole;
  /** admin: password sign-in */
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  /** customers/readers: passwordless magic link (free, built into Supabase Auth) */
  signInWithMagicLink: (email: string, redirectTo?: string) => Promise<{ error: string | null }>;
  /** 6-digit OTP sent in the same email — for users who prefer typing a code */
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshAdmin: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminRole, setAdminRole] = useState<AdminRole>(null);

  const loadAdmin = useCallback(async (sess: Session | null) => {
    if (!sess?.user) { setAdminRole(null); return; }
    const { data } = await supabase.from('app_admins').select('role').eq('user_id', sess.user.id).maybeSingle();
    setAdminRole((data?.role as AdminRole) || null);
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadAdmin(data.session);
      if (active) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, sess) => {
      setSession(sess);
      await loadAdmin(sess);
      setLoading(false);
      if (event === 'SIGNED_IN' && sess) {
        // attach any guest orders placed with this email to the new account (idempotent, server-side)
        setTimeout(() => { supabase.rpc('claim_my_orders').then(() => undefined, () => undefined); }, 0);
      }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [loadAdmin]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  };

  const signInWithMagicLink = async (email: string, redirectTo?: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: redirectTo || `${window.location.origin}/account`, shouldCreateUser: true },
    });
    return { error: error?.message || null };
  };

  const verifyOtp = async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: 'email' });
    return { error: error?.message || null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAdminRole(null);
  };

  const refreshAdmin = async () => loadAdmin(session);

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user || null,
      email: session?.user?.email?.toLowerCase() || null,
      loading,
      isAdmin: adminRole !== null,
      adminRole,
      signIn,
      signInWithMagicLink,
      verifyOtp,
      signOut,
      refreshAdmin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
