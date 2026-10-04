import { createClient } from '@supabase/supabase-js';
import { fetchWithRetry } from './fetchWithTimeout';

/**
 * Read a Vite env var, trying each name in order.
 *
 * Vite statically inlines every `VITE_`-prefixed var from the build environment into the bundle,
 * so this dynamic lookup works for any name listed below. A name that is NOT prefixed with
 * `VITE_` will never be readable here (browser bundle) — those are only usable in `api/`.
 */
export function viteEnv(...names: string[]): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>;
  for (const n of names) {
    const raw = env[n];
    if (typeof raw !== 'string') continue;
    const v = raw.trim();
    if (v && !isPlaceholder(v)) return v;
  }
  return undefined;
}

/** `.env.example` ships dummy values; a pasted placeholder must not count as "configured". */
function isPlaceholder(v: string): boolean {
  return /YOUR[-_]?(PROJECT|ANON|PUBLISHABLE|SUPABASE)|^public-anon-key-missing$|^x{4,}$/i.test(v);
}

/**
 * Names this project has used for the Supabase URL across Vercel/Supabase dashboards.
 * `VITE_PUBLIC_SUPABASE_URL` is the name currently configured in Vercel.
 */
const URL_NAMES = [
  'VITE_SUPABASE_URL',
  'VITE_PUBLIC_SUPABASE_URL',
  'VITE_SUPABASE_PROJECT_URL',
  'VITE_SUPABASE_PUBLIC_URL',
  'VITE_SUPABASE_PROJECT_REF_URL',
];

/**
 * Names used for the browser-safe key. Both legacy anon keys and new-style
 * `sb_publishable_…` keys are accepted — Supabase treats them interchangeably.
 */
const KEY_NAMES = [
  'VITE_SUPABASE_ANON_KEY',
  'VITE_PUBLIC_SUPABASE_ANON_KEY',
  'VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_KEY',
  'VITE_SUPABASE_PUBLIC_KEY',
];

export const supabaseUrl = viteEnv(...URL_NAMES);
export const supabaseAnonKey = viteEnv(...KEY_NAMES);

/** Which env var name each value came from (useful for diagnostics; never the value itself). */
export const supabaseUrlSource = URL_NAMES.find(n => viteEnv(n) === supabaseUrl);
export const supabaseAnonKeySource = KEY_NAMES.find(n => viteEnv(n) === supabaseAnonKey);

/**
 * A service-role / secret key must NEVER reach the browser. Refuse it rather than
 * silently shipping full database access inside the JS bundle.
 */
export function isSecretKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  const jwt = key.split('.')[1];
  if (!jwt || jwt.length < 8) return false;
  try {
    const payload = JSON.parse(atob(jwt.replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

/** True when the build has real, browser-safe Supabase credentials. */
export const supabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && !isSecretKey(supabaseAnonKey),
);

/** Human-readable reason the client is not configured (empty string when everything is fine). */
export const supabaseConfigError = (() => {
  if (!supabaseUrl && !supabaseAnonKey) return 'no Supabase URL or key found';
  if (!supabaseUrl) return `Supabase URL missing (found key via ${supabaseAnonKeySource})`;
  if (!supabaseAnonKey) return `Supabase key missing (found URL via ${supabaseUrlSource})`;
  if (isSecretKey(supabaseAnonKey)) {
    return `the client key looks like a SECRET/service-role key — refusing to use it in the browser. ` +
      `Use the publishable/anon key instead.`;
  }
  return '';
})();

if (!supabaseConfigured) {
  // Don't white-screen the whole site on a missing env var — render the shell and surface the problem.
  console.error(
    `[lixxon] Supabase is not configured (${supabaseConfigError}). Data will not load.\n` +
      `Looked for URL in: ${URL_NAMES.join(', ')}\n` +
      `Looked for key in: ${KEY_NAMES.join(', ')}\n` +
      `Only VITE_-prefixed variables reach the browser bundle, and they are baked in at BUILD time — ` +
      `after changing them in Vercel you must redeploy (a "Redeploy" without cache is safest).\n` +
      `Diagnose from the browser: ${typeof window !== 'undefined' ? window.location.origin : ''}/api/health ` +
      `(build stamp: ${typeof __SUPABASE_BUILD_STAMP__ === 'string' ? __SUPABASE_BUILD_STAMP__ : 'dev'})`,
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'public-anon-key-missing',
  {
    global: {
      fetch: (input, init) => fetchWithRetry(input, init, 12_000),
    },
  },
);

/**
 * Supabase infers joined relations (`post:posts(...)`) as arrays when the client has no generated
 * DB types. The queries in this codebase always join to-one relations, so this helper narrows the
 * result to the shape we actually receive without sprinkling `as unknown as` everywhere.
 */
export function rows<T>(data: unknown): T[] {
  return (data || []) as T[];
}
