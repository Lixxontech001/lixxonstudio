import { describe, it, expect, afterEach, vi } from 'vitest';
import { isSecretKey } from '../lib/supabaseClient';

const ANON_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIn0.sig';
const SERVICE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.sig';

describe('isSecretKey', () => {
  it('flags new-style secret keys', () => {
    expect(isSecretKey('sb_secret_abc123')).toBe(true);
  });
  it('flags service_role JWTs', () => {
    expect(isSecretKey(SERVICE_JWT)).toBe(true);
  });
  it('allows publishable keys and anon JWTs', () => {
    expect(isSecretKey('sb_publishable_abc123')).toBe(false);
    expect(isSecretKey(ANON_JWT)).toBe(false);
    expect(isSecretKey(undefined)).toBe(false);
  });
});

/**
 * Vercel projects describe the Supabase URL/key under several different names depending on how the
 * integration was installed. The client must resolve all of them — a mismatch silently ships a site
 * that loads nothing from Supabase.
 */
describe('supabase env aliases', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const load = async () => {
    vi.resetModules();
    return await import('../lib/supabaseClient');
  };

  it('resolves VITE_PUBLIC_* names (the ones configured in Vercel)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.stubEnv('VITE_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_test');
    const m = await load();
    expect(m.supabaseUrl).toBe('https://project.supabase.co');
    expect(m.supabaseAnonKey).toBe('sb_publishable_test');
    expect(m.supabaseConfigured).toBe(true);
    expect(m.supabaseUrlSource).toBe('VITE_PUBLIC_SUPABASE_URL');
  });

  it('treats .env.example placeholders as unconfigured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://YOUR-PROJECT-REF.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'YOUR_ANON_KEY');
    const m = await load();
    expect(m.supabaseConfigured).toBe(false);
  });

  it('refuses to build a client with a secret key in the browser', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.stubEnv('VITE_PUBLIC_SUPABASE_ANON_KEY', 'sb_secret_leaked');
    const m = await load();
    expect(m.supabaseConfigured).toBe(false);
    expect(m.supabaseConfigError).toMatch(/SECRET/);
  });
});
