import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Names the Supabase URL / browser key may be configured under in Vercel.
 * Keep in sync with src/lib/supabaseClient.ts and api/feeds.ts + api/og.tsx.
 */
const URL_NAMES = [
  'VITE_SUPABASE_URL',
  'VITE_PUBLIC_SUPABASE_URL',
  'VITE_SUPABASE_PROJECT_URL',
  'VITE_SUPABASE_PUBLIC_URL',
  'VITE_SUPABASE_PROJECT_REF_URL',
];
const KEY_NAMES = [
  'VITE_SUPABASE_ANON_KEY',
  'VITE_PUBLIC_SUPABASE_ANON_KEY',
  'VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_KEY',
  'VITE_SUPABASE_PUBLIC_KEY',
];

export default defineConfig(({ mode }) => {
  // `.env*` files PLUS real process env (Vercel injects its variables into the build process).
  const env: Record<string, string> = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...(process.env as Record<string, string>) };
  const swEnabled = env.VITE_DISABLE_SW !== '1';
  console.log(`[lixxon] SW enabled: ${swEnabled ? 'yes' : 'no'}`);
  const buildId = env.VERCEL_GIT_COMMIT_SHA || env.VITE_COMMIT_SHA || new Date().toISOString();
  const versionPlugin: Plugin = {
    name: 'lixxon-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ buildId }, null, 2)}\n`,
      });
    },
  };

  const found = (names: string[]) => names.filter((n) => env[n]);

  const urlNames = found(URL_NAMES);
  const keyNames = found(KEY_NAMES);
  const supabaseReady = urlNames.length > 0 && keyNames.length > 0;

  // Loud but non-fatal: a build with no Supabase credentials ships a site that can never load data.
  // (Fatal builds are opt-in via REQUIRE_SUPABASE_ENV=1.)
  if (!supabaseReady) {
    console.warn(
      '\n\x1b[33m[lixxon] ⚠  Supabase credentials were NOT visible to this build.\x1b[0m\n' +
        `  URL vars found: ${urlNames.join(', ') || 'none'}\n` +
        `  KEY vars found: ${keyNames.join(', ') || 'none'}\n` +
        '  Vite only inlines VITE_-prefixed vars from the BUILD environment, so after adding them\n' +
        '  in Vercel you must redeploy (uncheck "Use existing Build Cache").\n',
    );
    if (process.env.REQUIRE_SUPABASE_ENV === '1') {
      throw new Error('[lixxon] REQUIRE_SUPABASE_ENV=1 but no Supabase credentials were found at build time.');
    }
  } else {
    console.log(`[lixxon] Supabase env detected — url via ${urlNames[0]}, key via ${keyNames[0]}`);
  }

  return {
    server: {
      host: true,
      allowedHosts: true,
    },
    preview: {
      host: true,
      allowedHosts: true,
    },
    plugins: [react(), versionPlugin],
    define: {
      // Vercel commit SHA when available, otherwise a unique build timestamp.
      __COMMIT_SHA__: JSON.stringify(buildId),
      // Sentry DSN is a publishable value (it ships in every browser bundle by design).
      // Vercel stores it as SENTRY_DSN, which Vite will not inline on its own.
      __SENTRY_DSN__: JSON.stringify(env.VITE_SENTRY_DSN || env.SENTRY_DSN || ''),
      // Build-time fingerprint used by /api/health to confirm what the deployed bundle saw.
      __SUPABASE_BUILD_STAMP__: JSON.stringify(
        supabaseReady ? `${urlNames[0]}+${keyNames[0]}` : 'UNCONFIGURED',
      ),
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
      include: ['react', 'react-dom', 'react-helmet-async', '@supabase/supabase-js'],
    },
    build: {
      target: 'es2020',
      minify: 'terser',
      terserOptions: { module: true, compress: { module: true, passes: 2 }, mangle: { module: true }, format: { comments: false } },
      cssCodeSplit: true,
      // Admin is reached through a route-level dynamic import; do not make readers
      // download its shared chunk as a modulepreload dependency.
      modulePreload: {
        resolveDependencies(_filename, deps) {
          return deps.filter(dep => !dep.includes('admin-pages'));
        },
      },
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Route-level modules stay out of the shared admin chunk. The lazy
            // article intake/calendar and System Check remain size-budgeted as
            // separate chunks rather than inflating the core admin route bundle.
            if (id.includes('/src/admin/pages/AutomationRuns.tsx')) return 'automation-runs';
            if (id.includes('/src/lib/automationDistribution.ts')) return 'automation-distribution';
            if (id.includes('/src/admin/pages/AutomationCheck.tsx')) return 'automation-check';
            if (id.includes('/src/admin/pages/ArticleQueueCalendar.tsx')) return 'article-intake';
            if (id.includes('/src/admin/components/VapidGenerator.tsx')) return 'vapid-generator';
            if (id.includes('/src/admin/')) return 'admin-pages';
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'react-vendor';
            if (id.includes('node_modules/react-helmet-async')) return 'helmet';
            if (id.includes('node_modules/@supabase/supabase-js')) return 'supabase';
            if (id.includes('node_modules/lucide-react')) return 'icons';
            if (id.includes('node_modules/@vercel/analytics')) return 'vercel';
          },
        },
      },
    },
  };
});
