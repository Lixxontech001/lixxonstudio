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
      vary: res.headers.get('vary') ?? null,
      cacheControl: res.headers.get('cache-control') ?? null,
      bodySample: body.slice(0, 300),
    };
    report.ok = res.ok;
    if (!res.ok) report.problem = `PostgREST refused the anon read (HTTP ${res.status}). ${body.slice(0, 200)}`;
  } catch (e) {
    report.rest = { error: String(e) };
    report.ok = false;
    report.problem = 'Could not reach the Supabase URL above from Vercel.';
  }

  // The homepage's exact join query (useSupabase.ts usePaginatedPosts):
  //   posts.select('*, category:categories(*), author:authors(*)', { count: 'exact' })
  //        .eq('status', 'published').order('published_at', { ascending: false }).range(0, 0)
  // Reproducing it here proves the whole path the homepage depends on, and reports the
  // caching headers (vary / cache-control) the CDN sees for that payload.
  try {
    const select = '*,category:categories(*),author:authors(*)';
    const res = await fetch(
      `${url.value}/rest/v1/posts?select=${encodeURIComponent(select)}&status=eq.published&order=published_at.desc&limit=1`,
      { headers: { apikey: key.value, Authorization: `Bearer ${key.value}`, Prefer: 'count=exact' } }
    );
    const body = await res.text();
    const contentRange = res.headers.get('content-range');
    const total = contentRange ? Number(contentRange.split('/')[1]) : NaN;
    report.homepageQuery = {
      select: '*, category:categories(*), author:authors(*)',
      filters: "status=eq.published, order=published_at.desc, limit=1 (count=exact)",
      status: res.status,
      publishedCount: Number.isFinite(total) ? total : null,
      contentRange: contentRange ?? null,
      vary: res.headers.get('vary') ?? null,
      cacheControl: res.headers.get('cache-control') ?? null,
      bodySample: body.slice(0, 300),
    };
    if (!res.ok) {
      report.ok = false;
      report.problem = `The homepage join query failed (HTTP ${res.status}). ${body.slice(0, 200)}`;
    } else if (!contentRange?.match(/\/[1-9]/)) {
      report.problem =
        'Credentials work, but the `posts` table returned 0 rows to the anon role — check that rows exist ' +
        "with status='published' AND RLS grants anon SELECT.";
    }
  } catch (e) {
    report.homepageQuery = { error: String(e) };
    report.ok = false;
    report.problem = 'Could not run the homepage join query against Supabase from Vercel.';
  }

  // Batch 2 deep probe: the ranked search RPC the search page calls, with one
  // deliberate typo and its synonym expansion — the exact payload shape the client sends.
  // A failure here is reported as a warning rather than a 503: the site is still up,
  // and the two probes above are what `ok` means.
  const warnings: string[] = [];
  try {
    const res = await fetch(`${url.value}/rest/v1/rpc/search_everything`, {
      method: 'POST',
      headers: {
        apikey: key.value,
        Authorization: `Bearer ${key.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_query: 'niacinamid',
        p_terms: ['niacinamid', 'niacinamide', 'nicotinamide', 'vitamin b3'],
        p_limit: 3,
        p_offset: 0,
      }),
    });
    const body = await res.text();
    let rows: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) rows = parsed as Array<Record<string, unknown>>;
    } catch { /* not JSON — reported below */ }

    const ok = res.ok && rows.length > 0;
    report.search = {
      endpoint: 'rpc/search_everything',
      probe: "typo 'niacinamid' + synonyms",
      status: res.status,
      results: rows.length,
      kinds: [...new Set(rows.map(r => r.result_kind).filter(Boolean))],
      topHit: rows[0] ? { slug: rows[0].slug, score: rows[0].score } : null,
      ok,
      ...(ok ? {} : { bodySample: body.slice(0, 300) }),
    };
    if (!ok) warnings.push(`Search RPC not returning results (HTTP ${res.status}). ${body.slice(0, 200)}`);
  } catch (e) {
    report.search = { endpoint: 'rpc/search_everything', ok: false, error: String(e) };
    warnings.push('Could not reach the search RPC from Vercel.');
  }
  // Batch 3 warning-only probe. This fingerprint is intentionally unique so the
  // health check never reads or changes a real reader's private history.
  try {
    const fingerprint = `health_probe_${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 64);
    const headers = {
      apikey: key.value,
      Authorization: `Bearer ${key.value}`,
      'Content-Type': 'application/json',
    };
    const [continueResponse, feedResponse] = await Promise.all([
      fetch(`${url.value}/rest/v1/rpc/continue_reading`, {
        method: 'POST', headers,
        body: JSON.stringify({ p_fingerprint: fingerprint, p_limit: 3 }),
      }),
      fetch(`${url.value}/rest/v1/rpc/for_you_feed`, {
        method: 'POST', headers,
        body: JSON.stringify({ p_fingerprint: fingerprint, p_limit: 6 }),
      }),
    ]);
    const [continueBody, feedBody] = await Promise.all([continueResponse.text(), feedResponse.text()]);
    let continueRows: unknown[] = [];
    let feedRows: Array<Record<string, unknown>> = [];
    let continueParsed = false;
    let feedParsed = false;
    try {
      const parsed = JSON.parse(continueBody);
      if (Array.isArray(parsed)) { continueRows = parsed; continueParsed = true; }
    } catch { /* included in the warning below */ }
    try {
      const parsed = JSON.parse(feedBody);
      if (Array.isArray(parsed)) { feedRows = parsed as Array<Record<string, unknown>>; feedParsed = true; }
    } catch { /* included in the warning below */ }
    const probeOk = continueResponse.ok && feedResponse.ok && continueParsed && feedParsed;
    report.personalisation = {
      ok: probeOk,
      continueReading: { status: continueResponse.status, results: continueRows.length },
      status: feedResponse.status,
      ...(probeOk ? {} : { bodySample: `${continueBody.slice(0, 150)} ${feedBody.slice(0, 150)}` }),
    };
    report.forYou = {
      results: feedRows.length,
      firstReason: typeof feedRows[0]?.reason === 'string' ? feedRows[0].reason : null,
    };
    if (!probeOk) warnings.push(`Personalisation RPC probe failed (continue ${continueResponse.status}, feed ${feedResponse.status}).`);
  } catch (e) {
    report.personalisation = { ok: false, error: String(e) };
    report.forYou = { results: 0, firstReason: null };
    warnings.push('Could not reach the personalisation RPCs from Vercel.');
  }

  if (warnings.length) report.warnings = warnings;

  return json(report, report.ok ? 200 : 503);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
