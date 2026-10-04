import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Session, User } from '@supabase/supabase-js';

/** Role keys are rows in `admin_roles` now — custom roles are allowed. */
export type AdminRole = string | null;

/** Everything the database tells us about the signed-in admin (`admin_me()`). */
export interface AdminAccess {
  user_id: string;
  email: string | null;
  role: string;
  role_label: string | null;
  display_name: string | null;
  status: 'active' | 'suspended';
  is_founder: boolean;
  is_owner: boolean;
  mfa_enrolled: boolean;
  permissions: string[];
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  email: string | null;
  loading: boolean;
  /** true only when the user has an ACTIVE row in app_admins (checked server-side) */
  isAdmin: boolean;
  adminRole: AdminRole;
  /** The database's answer to "what may this admin do?" — the UI only mirrors it. */
  adminAccess: AdminAccess | null;
  can: (permission: string) => boolean;
  isFounder: boolean;
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

/**
 * Fallback for a deployment where the M5 migration has not been applied yet: behave like
 * the old client-side role map, but only for the three built-in roles. Once `admin_me()`
 * exists this never runs, because the database is the source of truth.
 */
const LEGACY_ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  editor: [
    'content.read', 'content.write', 'content.publish', 'content.delete', 'content.moderate',
    'media.read', 'media.write', 'media.delete', 'taxonomy.manage', 'collections.manage',
    'marketing.newsletter', 'marketing.campaigns', 'analytics.read', 'analytics.export',
  ],
  moderator: ['content.read', 'content.moderate', 'media.read'],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminAccess, setAdminAccess] = useState<AdminAccess | null>(null);

  const loadAdmin = useCallback(async (sess: Session | null) => {
    if (!sess?.user) { setAdminAccess(null); return; }
    const { data, error } = await supabase.rpc('admin_me');
    if (!error && data && typeof data === 'object') {
      const me = data as unknown as AdminAccess;
      if (me.status === 'active' || me.status === 'suspended') {
        setAdminAccess({ ...me, permissions: Array.isArray(me.permissions) ? me.permissions : [] });
        if (me.status === 'active') supabase.rpc('admin_touch').then(() => undefined, () => undefined);
        return;
      }
      setAdminAccess(null);
      return;
    }
    // `admin_me()` missing (migration not deployed yet) — fall back to the old role read.
    const missingFunction = error && (error.code === 'PGRST202' || /admin_me/.test(error.message || ''));
    if (missingFunction) {
      const { data: row } = await supabase.from('app_admins').select('role').eq('user_id', sess.user.id).maybeSingle();
      const role = (row as { role?: string } | null)?.role;
      if (role) {
        setAdminAccess({
          user_id: sess.user.id,
          email: sess.user.email?.toLowerCase() || null,
          role,
          role_label: role,
          display_name: null,
          status: 'active',
          is_founder: role === 'owner',
          is_owner: role === 'owner',
          mfa_enrolled: false,
          permissions: LEGACY_ROLE_PERMISSIONS[role] || [],
        });
        return;
      }
    }
    setAdminAccess(null);
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
    setAdminAccess(null);
  };

  const refreshAdmin = async () => loadAdmin(session);

  const can = useCallback((permission: string) => {
    if (!adminAccess || adminAccess.status !== 'active') return false;
    if (adminAccess.is_founder || adminAccess.is_owner) return true;
    return adminAccess.permissions.includes(permission);
  }, [adminAccess]);

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user || null,
      email: session?.user?.email?.toLowerCase() || null,
      loading,
      isAdmin: adminAccess !== null && adminAccess.status === 'active',
      adminRole: adminAccess?.role ?? null,
      adminAccess,
      can,
      isFounder: Boolean(adminAccess?.is_founder),
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
