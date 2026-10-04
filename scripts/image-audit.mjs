#!/usr/bin/env node
/**
 * Image content audit — scans posts.cover_image and product images for URLs that
 * cannot render (Pexels photo-page URLs, http:// links, non-https values) and,
 * optionally, for dead links. Prints offending rows for repair.
 *
 *   node scripts/image-audit.mjs            # audit (exit 1 if offenders)
 *   node scripts/image-audit.mjs --check    # + HEAD-check every remote URL (dead links)
 *   node scripts/image-audit.mjs --sql      # print the idempotent SQL repair statements
 *
 * Credentials: the same env names the app accepts (server-side ones work here too):
 *   SUPABASE_URL / SUPABASE_ANON_KEY (or any VITE_* alias from README Appendix B).
 * The repair itself ships as supabase/migrations/20261004090000_fix_image_urls.sql.
 */

const URL_NAMES = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'VITE_PUBLIC_SUPABASE_URL',
  'VITE_SUPABASE_PROJECT_URL', 'VITE_SUPABASE_PUBLIC_URL', 'VITE_SUPABASE_PROJECT_REF_URL',
];
const KEY_NAMES = [
  'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY', 'VITE_PUBLIC_SUPABASE_ANON_KEY',
  'VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_KEY', 'VITE_SUPABASE_PUBLIC_KEY',
];

function firstEnv(names) {
  for (const n of names) {
    const v = (process.env[n] || '').trim();
    if (v) return v;
  }
  return null;
}

/** Same rules as src/lib/images.ts normalizeImageUrl (kept in sync deliberately). */
function classify(url) {
  const u = (url || '').trim();
  if (!u) return { kind: 'empty', url: u };
  if (/^https?:\/\/(?:www\.)?pexels\.com\/photo\//i.test(u)) return { kind: 'pexels-photo-page', url: u };
  if (/^https?:\/\/images\.pexels\.com\/photos\/\d+\/?(\?|$)/i.test(u)) return { kind: 'pexels-folder-only', url: u };
  if (/^http:\/\//i.test(u)) return { kind: 'insecure-http', url: u };
  if (!/^https:\/\//i.test(u)) return { kind: 'non-https', url: u };
  return { kind: 'ok', url: u };
}

async function fetchRows(baseUrl, key, table, columns) {
  const qs = new URLSearchParams({ select: columns });
  const res = await fetch(`${baseUrl}/rest/v1/${table}?${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function headCheck(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    return { status: res.status, dead: res.status === 404 || res.status === 410 };
  } catch (e) {
    return { status: String(e), dead: true };
  }
}

const SQL_REPAIR = `-- idempotent repair (safe to run repeatedly) — also shipped as
-- supabase/migrations/20261004090000_fix_image_urls.sql
UPDATE posts SET cover_image =
  'https://images.pexels.com/photos/' || m.id || '/pexels-photo-' || m.id || '.jpeg?auto=compress&cs=tinysrgb&w=1600'
FROM (SELECT id, substring(cover_image from 'pexels\\.com/photo/(?:[^/]*-)?([0-9]+)') AS pid
      FROM posts WHERE cover_image ~* 'pexels\\.com/photo/(?:[^/]*-)?[0-9]+') m
WHERE posts.id = m.id AND m.pid IS NOT NULL;`;

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--sql')) {
    console.log(SQL_REPAIR);
    return;
  }

  const baseUrl = firstEnv(URL_NAMES);
  const key = firstEnv(KEY_NAMES);
  if (!baseUrl || !key) {
    console.error('Missing Supabase credentials. Set SUPABASE_URL + SUPABASE_ANON_KEY (or the VITE_* aliases).');
    process.exit(2);
  }

  const posts = await fetchRows(baseUrl, key, 'posts', 'id,slug,cover_image');
  const products = await fetchRows(baseUrl, key, 'products', 'id,slug,image_url,gallery');

  const entries = [];
  for (const p of posts) entries.push({ table: 'posts', id: p.id, slug: p.slug, column: 'cover_image', ...classify(p.cover_image) });
  for (const p of products) {
    entries.push({ table: 'products', id: p.id, slug: p.slug, column: 'image_url', ...classify(p.image_url) });
    for (const [i, g] of (p.gallery || []).entries()) {
      entries.push({ table: 'products', id: p.id, slug: p.slug, column: `gallery[${i}]`, ...classify(g) });
    }
  }

  const offenders = entries.filter((e) => e.kind !== 'ok');
  console.log(`Image audit: ${entries.length} URLs checked — ${entries.length - offenders.length} OK, ${offenders.length} offender(s).\n`);
  for (const o of offenders) {
    console.log(`[${o.kind}] ${o.table}/${o.slug ?? o.id} ${o.column}: ${o.url || '(empty)'}`);
  }

  if (args.has('--check') && offenders.length >= 0) {
    const unique = [...new Set(entries.filter((e) => e.kind === 'ok').map((e) => e.url))];
    console.log(`\nHEAD-checking ${unique.length} unique remote URLs…`);
    for (const u of unique) {
      const r = await headCheck(u);
      if (r.dead) console.log(`[dead-link ${r.status}] ${u}`);
    }
  }

  if (offenders.length > 0) {
    console.log('\nRun `node scripts/image-audit.mjs --sql` for the repair statements, or apply the migration.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
