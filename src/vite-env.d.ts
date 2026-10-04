/// <reference types="vite/client" />

/** Injected by vite.config.ts `define` — build-time values Vercel only exposes server-side. */
declare const __COMMIT_SHA__: string;
declare const __SENTRY_DSN__: string;
declare const __SUPABASE_BUILD_STAMP__: string;

interface ImportMetaEnv {
  /** Supabase URL. Aliases such as VITE_PUBLIC_SUPABASE_URL are accepted too (see lib/supabaseClient.ts). */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_PUBLIC_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PROJECT_URL?: string;
  /** Browser-safe key: legacy anon JWT or new-style sb_publishable_… key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_KEY?: string;
  readonly VITE_FLUTTERWAVE_PUBLIC_KEY?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_COMMIT_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & Record<string, string | boolean | undefined>;
}
