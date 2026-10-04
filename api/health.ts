// /api/health — deployment self-check for the Supabase wiring.
//
// Reports WHICH environment-variable names the deployment can see (never their values),
// then does one anonymous REST read against Supabase so you can tell apart
// "credentials missing" from "credentials work but RLS/data is the problem".
//
// Open https://<your-site>/api/health in a browser and read the JSON.
export const config = { runtime: 'edge' };

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

const SERVER_ONLY_NAMES = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

function first(names: string[], env: Record<string, string | undefined>) {
  for (const n of names) {
    const v = env[n]?.trim();
    if (v) return { name: n, value: v };
  }
  return null;
}

/** Classify a key without leaking it. */
function keyKind(key: string): string {
  if (key.startsWith('sb_publishable_')) return 'publishable (sb_publishable_…)';
  if (key.startsWith('sb_secret_')) return 'SECRET (sb_secret_…) — must not be used in the browser';
  const payload = key.split('.')[1];
  if (payload) {
    try {
      const p = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      if (p?.role === 'service_role') return 'SECRET (service_role JWT) — must not be used in the browser';
      if (p?.role === 'anon') return 'anon (legacy JWT, role=anon)';
    } catch { /* not a JWT */ }
  }
  return 'unrecognised';
}

export default async function handler(): Promise<Response> {
  const env = process.env as Record<string, string | undefined>;

  const url = first(URL_NAMES, env);
  const key = first(KEY_NAMES, env);

  const seen = (names: string[]) => names.filter(n => Boolean(env[n]?.trim()));

  const report: Record<string, unknown> = {
    ok: false,
    hint:
      'Vite inlines VITE_-prefixed variables at BUILD time. After changing them in Vercel you must ' +
      'redeploy without the build cache. Only VITE_* names reach the browser bundle.',
    envVarsVisibleToThisFunction: {
      supabaseUrlNamesPresent: seen(URL_NAMES),
      supabaseKeyNamesPresent: seen(KEY_NAMES),
      serverOnlyNamesPresent: seen(SERVER_ONLY_NAMES),
      sentryNamesPresent: seen(['SENTRY_DSN', 'VITE_SENTRY_DSN', 'SENTRY_AUTH_TOKEN']),
      otherPublicNamesPresent: seen([
        'VITE_SITE_URL',
        'VITE_FLUTTERWAVE_PUBLIC_KEY',
        'VERCEL_GIT_COMMIT_SHA',
        'VERCEL_ENV',
      ]),
    },
  };

  if (!url || !key) {
    report.problem =
      `Frontend Supabase credentials are incomplete in this deployment: ` +
      `${url ? '' : 'no VITE_* Supabase URL found. '}${key ? '' : 'no VITE_* Supabase key found.'}`;
    return json(report, 503);
  }

  report.resolved = {
    urlFrom: url.name,
    urlHost: (() => { try { return new URL(url.value).host; } catch { return url.value; } })(),
    keyFrom: key.name,
    keyKind: keyKind(key.value),
  };

  // One anonymous read through PostgREST — proves the key + RLS path the site itself uses.
  try {
    const res = await fetch(`${url.value}/rest/v1/posts?select=id&limit=1`, {
      headers: { apikey: key.value, Authorization: `Bearer ${key.value}`, Prefer: 'count=exact' },
    });
    const body = await res.text();
    report.rest = {
      status: res.status,
      contentRange: res.headers.get('content-range') ?? null,
      bodySample: body.slice(0, 300),
    };
    report.ok = res.ok;
    if (!res.ok) report.problem = `PostgREST refused the anon read (HTTP ${res.status}). ${body.slice(0, 200)}`;
    else if (!res.headers.get('content-range')?.match(/\/[1-9]/)) {
      report.problem =
        'Credentials work, but the `posts` table returned 0 rows to the anon role — check that rows exist ' +
        "with status='published' AND RLS grants anon SELECT.";
    }
  } catch (e) {
    report.rest = { error: String(e) };
    report.problem = 'Could not reach the Supabase URL above from Vercel.';
  }

  return json(report, report.ok ? 200 : 503);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
