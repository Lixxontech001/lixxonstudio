import { createClient } from '@supabase/supabase-js';

/** Read a Vite env var, trying each name in order. */
function viteEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = (import.meta.env as Record<string, string | undefined>)[n];
    if (v) return v;
  }
  return undefined;
}

export const supabaseUrl = viteEnv('VITE_SUPABASE_URL', 'VITE_SUPABASE_PROJECT_URL');
export const supabaseAnonKey = viteEnv('VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_KEY');

/** True when the build has real Supabase credentials. */
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!supabaseConfigured) {
  // Don't white-screen the whole site on a missing env var — render the shell and surface the problem.
  console.error('[lixxon] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. Data will not load.');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'public-anon-key-missing',
);

/**
 * Supabase infers joined relations (`post:posts(...)`) as arrays when the client has no generated
 * DB types. The queries in this codebase always join to-one relations, so this helper narrows the
 * result to the shape we actually receive without sprinkling `as unknown as` everywhere.
 */
export function rows<T>(data: unknown): T[] {
  return (data || []) as T[];
}
