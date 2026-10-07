#!/usr/bin/env node
/**
 * optimize-media.mjs — audit, optimize, or dedupe Supabase Storage images in place.
 *
 * Phase 1 of the cached-egress fix: same URLs, same formats, fewer bytes.
 * No new dependencies: @supabase/supabase-js (already in package.json) for
 * Storage I/O + the ImageMagick CLI preinstalled on ubuntu-latest for encoding.
 *
 *   TASK=audit    Inventory every object (size, type), top 20, oversized flags,
 *                 duplicate suspects, DB reference coverage, per-page KB
 *                 estimates, and a best-effort Storage-logs peek. Read-only.
 *   TASK=optimize Resize (down to MAX_WIDTH, never upscale) + recompress JPEG /
 *                 PNG / WebP in place, keeping the same format and extension.
 *                 Re-uploads with upsert only when the output is at least
 *                 MIN_SAVING smaller; sets the exact same path, the original
 *                 content type, and `cache-control: public, max-age=31536000,
 *                 immutable`. GIF/SVG/AVIF/TIFF and non-images are never touched.
 *   TASK=dedupe   Find byte-identical objects (sha256) and — only in a live run
 *                 with DEDUPE_CONFIRM=DELETE — delete the spare copies when at
 *                 least one copy is still referenced by the database. Groups
 *                 with no referenced copy are NEVER auto-deleted (manual review).
 *
 * Environment (all set by .github/workflows/optimize-media.yml):
 *   SUPABASE_URL, SUPABASE_SECRET_KEY (service role — Action runner only, never
 *     the browser), STORAGE_BUCKETS (comma-separated, default "media"),
 *     TASK (default "optimize"), DRY_RUN ("true"|"false", default "true"),
 *     MAX_WIDTH (default 1600), QUALITY (default 82), MIN_SAVING (default 0.15),
 *     MAX_FILES (default 250, safety cap per run), DEDUPE_CONFIRM (must be the
 *     literal "DELETE" for a live dedupe), SUPABASE_ACCESS_TOKEN +
 *     SUPABASE_PROJECT_REF (optional: Storage-logs peek).
 *
 * Exit codes: 0 ok · 1 optimize saved nothing (dry or live) / live dedupe
 * without confirmation / any hard error.
 */

import { createClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------- config ---

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(raw, fallback, min, max) {
  const n = Number.parseFloat(String(raw ?? ''));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SECRET_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim();
const BUCKETS = (process.env.STORAGE_BUCKETS || 'media')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TASK = (process.env.TASK || 'optimize').trim().toLowerCase();
const DRY_RUN = (process.env.DRY_RUN || 'true').trim().toLowerCase() !== 'false';
const MAX_WIDTH = clampInt(process.env.MAX_WIDTH, 1600, 200, 4000);
const QUALITY = clampInt(process.env.QUALITY, 82, 40, 95);
const MIN_SAVING = clampFloat(process.env.MIN_SAVING, 0.15, 0, 0.9);
const MAX_FILES = clampInt(process.env.MAX_FILES, 250, 1, 2000);
const DEDUPE_CONFIRM = (process.env.DEDUPE_CONFIRM || '').trim();
const MGMT_TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const PROJECT_REF = (process.env.SUPABASE_PROJECT_REF || '').trim();

const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const OPTIMIZABLE = new Set(['jpg', 'jpeg', 'png', 'webp']);
const SKIPPED_FORMATS = new Set(['gif', 'svg', 'avif', 'tif', 'tiff', 'bmp', 'ico']);
const PNG_QUANT_MIN_BYTES = 400_000; // only quantize PNGs at/above this size
const HEAD_TIMEOUT_MS = 8000;
const HEAD_BUDGET = 40; // max remote HEAD requests for the page-load estimates
const ENCODE_TIMEOUT_MS = 180_000;

if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required.');
if (!SECRET_KEY) throw new Error('The SUPABASE_SECRET_KEY repository secret is not configured.');
if (BUCKETS.length === 0) throw new Error('STORAGE_BUCKETS is empty.');
if (!['audit', 'optimize', 'dedupe'].includes(TASK)) {
  throw new Error(`TASK must be audit|optimize|dedupe, got "${TASK}".`);
}

const supabase = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --------------------------------------------------------------- helpers ---

const fmtBytes = (n) => {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};
const fmtKb = (n) => `${(n / 1024).toFixed(0)} KB`;
const pct = (saved, orig) => (orig > 0 ? `${((saved / orig) * 100).toFixed(1)}%` : '—');

function table(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

async function summarize(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    await appendFile(file, `${markdown}\n`, 'utf8');
  } catch {
    /* step summary is a nicety, never a requirement */
  }
}

const extOf = (p) => extname(p).toLowerCase().replace(/^\./, '');

function guessContentType(p, fallback = '') {
  if (fallback && fallback !== 'application/octet-stream') return fallback;
  const ext = extOf(p);
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'avif') return 'image/avif';
  return fallback || 'application/octet-stream';
}

/** Map a public/signed Storage URL back to { bucket, path }; null for other URLs. */
function storageUrlToRef(url) {
  if (typeof url !== 'string') return null;
  const marker = '/storage/v1/object/';
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const rest = url.slice(i + marker.length).split('?')[0].split('#')[0];
  const parts = rest.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  if (parts.length < 2) return null;
  let bucket;
  let pathParts;
  if (['public', 'authenticated'].includes(parts[0])) {
    bucket = parts[1];
    pathParts = parts.slice(2);
  } else if (parts[0] === 'sign') {
    bucket = parts[1];
    pathParts = parts.slice(2);
  } else {
    bucket = parts[0];
    pathParts = parts.slice(1);
  }
  if (!bucket || pathParts.length === 0) return null;
  return { bucket, path: pathParts.join('/') };
}

function inlineImageUrls(content) {
  if (typeof content !== 'string') return [];
  const out = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(content)) !== null) out.push(m[1]);
  return out;
}

async function headBytes(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length'));
    return Number.isFinite(len) && len > 0 ? len : null;
  } catch {
    return null;
  }
}

/** Rewrite a Pexels CDN URL to the width a phone would pick from the srcset. */
function pexelsPhoneVariant(url) {
  try {
    const u = new URL(url);
    if (!/images\.pexels\.com$/i.test(u.hostname)) return url;
    u.searchParams.set('w', '800');
    if (!u.searchParams.has('auto')) u.searchParams.set('auto', 'compress');
    if (!u.searchParams.has('cs')) u.searchParams.set('cs', 'tinysrgb');
    return u.toString();
  } catch {
    return url;
  }
}

// ------------------------------------------------------ storage inventory ---

/** Recursively list every object in a bucket. Folders have no id/metadata. */
async function listBucket(bucket) {
  const objects = [];
  const prefixes = [''];
  while (prefixes.length > 0) {
    const prefix = prefixes.shift();
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`Could not list ${bucket}/${prefix || '(root)'}: ${error.message}`);
      const entries = data || [];
      for (const entry of entries) {
        const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!entry.id && !entry.metadata) {
          prefixes.push(objectPath); // a folder
          continue;
        }
        objects.push({
          bucket,
          path: objectPath,
          size: Number(entry.metadata?.size ?? 0),
          mimetype: String(entry.metadata?.mimetype || ''),
          updatedAt: entry.updated_at || entry.created_at || '',
        });
      }
      offset += entries.length;
      if (entries.length < 1000) break;
    }
  }
  return objects;
}

// ---------------------------------------------------------- db references ---

async function fetchTable(table, columns) {
  try {
    const { data, error } = await supabase.from(table).select(columns).limit(2000);
    if (error) return { rows: [], note: `${table}: ${error.message}` };
    return { rows: data || [], note: null };
  } catch (e) {
    return { rows: [], note: `${table}: ${String(e).slice(0, 120)}` };
  }
}

/**
 * Every image URL the site can reference: exact storage paths (bucket/path),
 * referenced basenames (catches moved files), and remote URLs (Pexels et al).
 */
async function collectReferences() {
  const referencedPaths = new Set();
  const referencedBases = new Set();
  const remoteUrls = new Set();
  const notes = [];
  const consider = (url) => {
    if (typeof url !== 'string' || !url.trim()) return;
    const ref = storageUrlToRef(url.trim());
    if (ref) {
      referencedPaths.add(`${ref.bucket}/${ref.path}`);
      referencedBases.add(basename(ref.path).toLowerCase());
    } else if (/^https?:\/\//i.test(url.trim())) {
      remoteUrls.add(url.trim());
    }
  };

  const specs = [
    ['posts', 'cover_image, content'],
    ['products', 'image_url, gallery'],
    ['authors', 'avatar_url'],
    ['collections', 'cover_image'],
    ['categories', 'cover_image'],
    ['shop_categories', 'cover_image'],
    ['series', 'cover_image'],
  ];
  for (const [t, cols] of specs) {
    const { rows, note } = await fetchTable(t, cols);
    if (note) notes.push(note);
    for (const row of rows) {
      consider(row.cover_image);
      consider(row.image_url);
      consider(row.avatar_url);
      if (Array.isArray(row.gallery)) for (const g of row.gallery) consider(typeof g === 'string' ? g : g?.url);
      for (const u of inlineImageUrls(row.content)) consider(u);
    }
  }
  return { referencedPaths, referencedBases, remoteUrls, notes };
}

// ------------------------------------------------------------- page costs ---

async function estimatePageLoads(inventoryByKey) {
  // Same queries the frontend runs: latest published posts + shop products.
  const [{ rows: posts }, { rows: products }] = await Promise.all([
    (async () => {
      try {
        const { data, error } = await supabase
          .from('posts')
          .select('slug, cover_image, content')
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(12);
        if (error) return { rows: [] };
        return { rows: data || [] };
      } catch {
        return { rows: [] };
      }
    })(),
    (async () => {
      const { rows } = await fetchTable('products', 'image_url');
      return { rows };
    })(),
  ]);

  const headCache = new Map();
  let headCount = 0;
  async function resolve(url, { phonePexels = false } = {}) {
    if (!url || typeof url !== 'string') return { bytes: 0, kind: 'missing' };
    const ref = storageUrlToRef(url);
    if (ref) {
      const hit = inventoryByKey.get(`${ref.bucket}/${ref.path}`);
      // Storage images have no srcset: the browser always downloads the full file.
      return { bytes: hit ? hit.size : 0, kind: hit ? 'storage-full' : 'storage-unknown' };
    }
    if (!/^https?:\/\//i.test(url)) return { bytes: 0, kind: 'missing' };
    const target = phonePexels ? pexelsPhoneVariant(url) : url;
    if (!headCache.has(target)) {
      if (headCount >= HEAD_BUDGET) return { bytes: 0, kind: 'remote-skipped' };
      headCount += 1;
      headCache.set(target, await headBytes(target));
    }
    const bytes = headCache.get(target);
    return {
      bytes: bytes || 0,
      kind: bytes ? (/pexels\.com/i.test(target) ? 'pexels-800w' : 'remote') : 'remote-unknown',
    };
  }

  // Home = hero cover + 9 feed covers (PAGE_SIZE in useSupabase.ts).
  const homeUrls = posts.slice(0, 10).map((p) => p.cover_image).filter(Boolean);
  // Article = cover + 4 related covers + inline markdown images.
  const sample = posts[0] || {};
  const articleUrls = [sample.cover_image, ...posts.slice(1, 5).map((p) => p.cover_image)].filter(Boolean);
  const inlineUrls = inlineImageUrls(sample.content);
  // Shop landing viewport ≈ first 12 product images.
  const shopUrls = products.slice(0, 12).map((p) => p.image_url).filter(Boolean);

  const home = [];
  for (const u of homeUrls) home.push(await resolve(u, { phonePexels: true }));
  const article = [];
  for (const u of articleUrls) article.push(await resolve(u, { phonePexels: true }));
  const inline = [];
  for (const u of inlineUrls) inline.push(await resolve(u));
  const shop = [];
  for (const u of shopUrls) shop.push(await resolve(u));

  const sum = (arr) => arr.reduce((a, r) => a + r.bytes, 0);
  const unknown = (arr) => arr.filter((r) => /unknown|skipped|missing/.test(r.kind)).length;
  return {
    home: { files: home.length, bytes: sum(home), unknown: unknown(home) },
    article: {
      files: article.length + inline.length,
      bytes: sum(article) + sum(inline),
      unknown: unknown(article) + unknown(inline),
      inlineFiles: inline.length,
      sampleSlug: sample.slug || '(no published posts found)',
    },
    shop: { files: shop.length, bytes: sum(shop), unknown: unknown(shop), totalProducts: products.length },
    headRequests: headCount,
  };
}

// ------------------------------------------------------------ image tools ---

let IM = null; // { flavor: 'magick'|'convert', version }

async function detectImageTools() {
  for (const flavor of ['magick', 'convert']) {
    try {
      const bin = flavor === 'magick' ? 'magick' : 'convert';
      const { stdout } = await execFileAsync(bin, ['-version'], { timeout: 15000 });
      const version = stdout.split('\n')[0].trim();
      if (/imagemagick/i.test(version)) {
        IM = { flavor, version };
        return IM;
      }
    } catch {
      /* try the next binary */
    }
  }
  return null;
}

async function identify(file) {
  const args = IM.flavor === 'magick' ? ['identify', '-format', '%w %h %m', file] : ['-format', '%w %h %m', file];
  const bin = IM.flavor === 'magick' ? 'magick' : 'identify';
  const { stdout } = await execFileAsync(bin, args, { timeout: 30000 });
  const [w, h, format] = stdout.trim().split(/\s+/);
  return { width: Number(w) || 0, height: Number(h) || 0, format: (format || '').toUpperCase() };
}

async function encode(input, output, args) {
  const bin = IM.flavor === 'magick' ? 'magick' : 'convert';
  const full = IM.flavor === 'magick' ? [input, ...args, output] : [input, ...args, output];
  await execFileAsync(bin, full, { timeout: ENCODE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
}

// ------------------------------------------------------------------ audit ---

const SUSPECT_NAME = /(copy|dupl|final|final2|-\d+|\(\d+\)|backup|bak|old|temp|tmp)/i;

async function runAudit(objects, refs) {
  console.log(`\n===== AUDIT (read-only) — ${objects.length} object(s) in ${BUCKETS.join(', ')} =====`);
  const total = objects.reduce((a, o) => a + o.size, 0);
  console.log(`Total stored: ${fmtBytes(total)} across ${objects.length} object(s).`);

  const byBucket = new Map();
  for (const o of objects) {
    const b = byBucket.get(o.bucket) || { n: 0, bytes: 0 };
    b.n += 1;
    b.bytes += o.size;
    byBucket.set(o.bucket, b);
  }
  console.log('\n-- by bucket --');
  console.log(table([...byBucket.entries()].map(([b, v]) => [b, v.n, fmtBytes(v.bytes)]), ['bucket', 'objects', 'bytes']));

  const byType = new Map();
  for (const o of objects) {
    const key = (o.mimetype || `ext:.${extOf(o.path) || 'none'}`).toLowerCase();
    const t = byType.get(key) || { n: 0, bytes: 0 };
    t.n += 1;
    t.bytes += o.size;
    byType.set(key, t);
  }
  console.log('\n-- by content type --');
  console.log(
    table(
      [...byType.entries()].sort((a, b) => b[1].bytes - a[1].bytes).map(([t, v]) => [t, v.n, fmtBytes(v.bytes)]),
      ['content type', 'objects', 'bytes'],
    ),
  );

  const top = [...objects].sort((a, b) => b.size - a.size).slice(0, 20);
  console.log('\n-- top 20 by size --');
  console.log(
    table(top.map((o) => [`${o.bucket}/${o.path}`, fmtBytes(o.size), o.mimetype || `ext:.${extOf(o.path)}`]), [
      'path',
      'size',
      'type',
    ]),
  );

  const oversized = objects.filter((o) => o.size >= 1024 * 1024).sort((a, b) => b.size - a.size);
  console.log(`\n-- oversized (≥1 MB): ${oversized.length} file(s), ${fmtBytes(oversized.reduce((a, o) => a + o.size, 0))} --`);
  if (oversized.length > 0) {
    console.log(table(oversized.slice(0, 30).map((o) => [`${o.bucket}/${o.path}`, fmtBytes(o.size)]), ['path', 'size']));
  }

  // Same-size groups are the cheap duplicate signal (byte check happens in dedupe).
  const bySize = new Map();
  for (const o of objects) {
    if (o.size === 0) continue;
    const g = bySize.get(o.size) || [];
    g.push(o);
    bySize.set(o.size, g);
  }
  const sizeGroups = [...bySize.values()].filter((g) => g.length > 1).sort((a, b) => b[0].size - a[0].size);
  console.log(`\n-- same-size groups (duplicate suspects, verify with TASK=dedupe): ${sizeGroups.length} --`);
  for (const g of sizeGroups.slice(0, 15)) {
    console.log(`  ${fmtBytes(g[0].size)} × ${g.length}: ${g.map((o) => `${o.bucket}/${o.path}`).join(' | ')}`);
  }

  const nameSuspects = objects.filter((o) => SUSPECT_NAME.test(basename(o.path)));
  console.log(`\n-- name-pattern suspects (copy/final/-1/…): ${nameSuspects.length} --`);
  for (const o of nameSuspects.slice(0, 15)) console.log(`  ${o.bucket}/${o.path} (${fmtBytes(o.size)})`);

  const imageObjs = objects.filter((o) => (o.mimetype || '').startsWith('image/') || OPTIMIZABLE.has(extOf(o.path)));
  const referenced = imageObjs.filter((o) => refs.referencedPaths.has(`${o.bucket}/${o.path}`));
  const baseOnly = imageObjs.filter(
    (o) => !refs.referencedPaths.has(`${o.bucket}/${o.path}`) && refs.referencedBases.has(basename(o.path).toLowerCase()),
  );
  console.log(`\n-- reference coverage (posts/products/authors/collections/categories/series + inline markdown) --`);
  console.log(`  storage images referenced by exact path: ${referenced.length} of ${imageObjs.length}`);
  console.log(`  matched by filename only (possibly moved): ${baseOnly.length}`);
  if (refs.notes.length > 0) console.log(`  skipped tables/columns: ${refs.notes.join(' · ')}`);

  console.log('\n-- cost per page load (fresh visit, phone widths for Pexels srcset picks) --');
  const inventoryByKey = new Map(objects.map((o) => [`${o.bucket}/${o.path}`, o]));
  const est = await estimatePageLoads(inventoryByKey);
  console.log(`  home (hero + 9 feed covers): ${fmtKb(est.home.bytes)} across ${est.home.files} file(s)`);
  console.log(
    `  article (${est.article.sampleSlug}: cover + 4 related + ${est.article.inlineFiles} inline): ${fmtKb(est.article.bytes)} across ${est.article.files} file(s)`,
  );
  console.log(`  shop (first ${est.shop.files} of ${est.shop.totalProducts} product images): ${fmtKb(est.shop.bytes)}`);
  if (est.home.unknown + est.article.unknown + est.shop.unknown > 0) {
    console.log(
      `  (sizes unknown for ${est.home.unknown + est.article.unknown + est.shop.unknown} URL(s): dead links, unlisted buckets, or HEAD budget reached)`,
    );
  }
  console.log('  Method: Storage images have no srcset, so the full file is counted; Pexels covers use the w=800 pick.');

  await summarize(
    `## Media audit — ${new Date().toISOString().slice(0, 10)}\n\n` +
      `- Stored: **${fmtBytes(total)}** in ${objects.length} object(s) (${BUCKETS.join(', ')})\n` +
      `- Oversized (≥1 MB): ${oversized.length} file(s)\n` +
      `- Same-size duplicate suspects: ${sizeGroups.length} group(s)\n` +
      `- Page cost: home **${fmtKb(est.home.bytes)}** · article **${fmtKb(est.article.bytes)}** · shop **${fmtKb(est.shop.bytes)}**\n`,
  );

  await storageLogsPeek();
}

// ------------------------------------------------------ storage logs peek ---

async function storageLogsPeek() {
  console.log('\n-- storage request logs (last day, best effort) --');
  if (!MGMT_TOKEN || !PROJECT_REF) {
    console.log('  skipped: SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not configured on this run.');
    return;
  }
  const queries = [
    `select path, method, status, count(*) as hits from storage_logs where timestamp > now() - interval '1 day' group by 1, 2, 3 order by hits desc limit 20`,
    `select request_user_agent as user_agent, count(*) as hits from storage_logs where timestamp > now() - interval '1 day' group by 1 order by hits desc limit 20`,
  ];
  for (const sql of queries) {
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
        signal: AbortSignal.timeout(20000),
      });
      const text = await res.text();
      if (!res.ok) {
        console.log(`  logs API answered HTTP ${res.status}; top paths/user agents are not visible from this token.`);
        console.log('  Record them from Supabase dashboard → Logs → Storage instead.');
        return;
      }
      console.log(`  query ok: ${text.slice(0, 2000)}`);
    } catch (e) {
      console.log(`  logs query failed (${String(e).slice(0, 140)}); use Supabase dashboard → Logs → Storage instead.`);
      return;
    }
  }
}

// ---------------------------------------------------------------- optimize ---

async function optimizeOne(obj) {
  const ext = extOf(obj.path);
  const dir = await mkdtemp(join(tmpdir(), 'lx-opt-'));
  try {
    const { data, error } = await supabase.storage.from(obj.bucket).download(obj.path);
    if (error || !data) throw new Error(`download failed: ${error?.message || 'empty response'}`);
    const original = Buffer.from(await data.arrayBuffer());
    const input = join(dir, `input.${ext}`);
    await writeFile(input, original);
    const { width, height } = await identify(input);

    const geometry = `${MAX_WIDTH}x${MAX_WIDTH}>`; // shrink-only: never upscale
    const base = ['-auto-orient', '-resize', geometry];
    let strategy = '';
    let output;

    if (ext === 'jpg' || ext === 'jpeg') {
      output = join(dir, `output.${ext}`);
      await encode(input, output, [...base, '-sampling-factor', '4:2:0', '-strip', '-quality', String(QUALITY), '-interlace', 'Plane']);
      strategy = `jpeg-q${QUALITY}${Math.max(width, height) > MAX_WIDTH ? `+resize→${MAX_WIDTH}` : ''}`;
    } else if (ext === 'webp') {
      output = join(dir, `output.${ext}`);
      await encode(input, output, [...base, '-strip', '-quality', String(QUALITY)]);
      strategy = `webp-q${QUALITY}${Math.max(width, height) > MAX_WIDTH ? `+resize→${MAX_WIDTH}` : ''}`;
    } else {
      // PNG: lossless first (resize + strip + max compression); quantize to 256
      // colors only for big files where lossless alone saves too little.
      output = join(dir, 'output.png');
      await encode(input, output, [
        ...base,
        '-strip',
        '-define',
        'png:compression-level=9',
        '-define',
        'png:compression-filter=5',
      ]);
      strategy = `png-lossless${Math.max(width, height) > MAX_WIDTH ? `+resize→${MAX_WIDTH}` : ''}`;
      let outSize = (await stat(output)).size;
      if (original.length > 0 && (original.length - outSize) / original.length < MIN_SAVING && original.length >= PNG_QUANT_MIN_BYTES) {
        await encode(input, output, [
          ...base,
          '-strip',
          '-colors',
          '256',
          '-dither',
          'FloydSteinberg',
          '-define',
          'png:compression-level=9',
        ]);
        strategy = `png-quant256${Math.max(width, height) > MAX_WIDTH ? `+resize→${MAX_WIDTH}` : ''}`;
        outSize = (await stat(output)).size;
      }
    }

    const outSize = (await stat(output)).size;
    const saved = original.length - outSize;
    const ratio = original.length > 0 ? saved / original.length : 0;
    const worthIt = ratio >= MIN_SAVING;

    let uploaded = false;
    let observedCache = '';
    if (!DRY_RUN && worthIt) {
      const contentType = guessContentType(obj.path, obj.mimetype);
      const { error: upError } = await supabase.storage.from(obj.bucket).upload(obj.path, await readFile(output), {
        upsert: true,
        contentType,
        cacheControl: '31536000',
        // storage-js turns cacheControl into `max-age=<n>`; this header override
        // carries the exact immutable directive instead (verified below).
        headers: { 'cache-control': CACHE_CONTROL },
      });
      if (upError) throw new Error(`upload failed: ${upError.message}`);
      uploaded = true;
      try {
        const pub = `${SUPABASE_URL}/storage/v1/object/public/${obj.bucket}/${obj.path.split('/').map(encodeURIComponent).join('/')}`;
        const res = await fetch(pub, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
        observedCache = res.headers.get('cache-control') || '';
      } catch {
        observedCache = '(verify skipped)';
      }
    }

    return {
      key: `${obj.bucket}/${obj.path}`,
      oldBytes: original.length,
      newBytes: outSize,
      saved: worthIt ? saved : 0,
      ratio,
      strategy: worthIt ? strategy : `${strategy || ext} (skip <${Math.round(MIN_SAVING * 100)}%)`,
      uploaded,
      observedCache,
      dimensions: `${width}×${height}`,
      error: null,
    };
  } catch (e) {
    return {
      key: `${obj.bucket}/${obj.path}`,
      oldBytes: obj.size,
      newBytes: obj.size,
      saved: 0,
      ratio: 0,
      strategy: 'error',
      uploaded: false,
      observedCache: '',
      dimensions: '',
      error: String(e?.message || e).slice(0, 160),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runOptimize(objects) {
  console.log(`\n===== OPTIMIZE (${DRY_RUN ? 'dry run — nothing will be written' : 'LIVE RUN — objects will be overwritten in place'}) =====`);
  console.log(`Buckets: ${BUCKETS.join(', ')} · max_width=${MAX_WIDTH} · quality=${QUALITY} · min_saving=${Math.round(MIN_SAVING * 100)}%`);

  const tools = await detectImageTools();
  if (!tools) {
    throw new Error('No ImageMagick CLI found on this runner (tried `magick` and `convert`). Nothing was changed.');
  }
  console.log(`Encoder: ${tools.version} (${tools.flavor}).`);

  const skippedOther = objects.filter((o) => !OPTIMIZABLE.has(extOf(o.path)) && !SKIPPED_FORMATS.has(extOf(o.path)));
  const skippedAnim = objects.filter((o) => SKIPPED_FORMATS.has(extOf(o.path)));
  const candidates = objects
    .filter((o) => OPTIMIZABLE.has(extOf(o.path)))
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_FILES);
  console.log(
    `Candidates: ${candidates.length} (jpg/jpeg/png/webp) · ` +
      `untouched formats (gif/svg/avif/tiff/bmp/ico): ${skippedAnim.length} · ` +
      `non-images untouched: ${skippedOther.length}.`,
  );
  if (candidates.length === 0) throw new Error('No optimizable images found. Total saving is zero.');

  const results = [];
  let i = 0;
  for (const obj of candidates) {
    i += 1;
    console.log(`[${i}/${candidates.length}] ${obj.bucket}/${obj.path} (${fmtBytes(obj.size)}) …`);
    const r = await optimizeOne(obj);
    results.push(r);
    if (r.error) console.log(`  error: ${r.error}`);
    else console.log(`  ${fmtBytes(r.oldBytes)} → ${fmtBytes(r.newBytes)} (${pct(r.saved, r.oldBytes)} saved) · ${r.strategy}${r.uploaded ? ' · UPLOADED' : ''}`);
    if (r.uploaded) console.log(`  observed cache-control: ${r.observedCache || '(none)'}`);
  }

  const ok = results.filter((r) => !r.error && r.saved > 0);
  const totalOld = results.reduce((a, r) => a + r.oldBytes, 0);
  const totalSaved = results.reduce((a, r) => a + r.saved, 0);

  console.log('\n-- before / after --');
  console.log(
    table(
      results.map((r) => [
        r.key,
        fmtBytes(r.oldBytes),
        r.error ? 'ERROR' : fmtBytes(r.newBytes),
        r.error ? r.error : pct(r.saved, r.oldBytes),
        r.error ? '' : r.strategy,
        r.uploaded ? 'uploaded' : '',
      ]),
      ['path', 'old', 'new', 'saved', 'strategy', ''],
    ),
  );
  console.log(
    `\nTotal: ${fmtBytes(totalOld)} → ${fmtBytes(totalOld - totalSaved)} · saved ${fmtBytes(totalSaved)} (${pct(totalSaved, totalOld)}) across ${ok.length} of ${results.length} file(s).`,
  );

  await summarize(
    `## Media optimize (${DRY_RUN ? 'dry run' : 'LIVE'}) — ${new Date().toISOString().slice(0, 10)}\n\n` +
      `- Candidates: ${candidates.length} · improved: ${ok.length}\n` +
      `- Saved **${fmtBytes(totalSaved)}** (${pct(totalSaved, totalOld)}) of ${fmtBytes(totalOld)}\n` +
      `- Settings: max_width=${MAX_WIDTH}, quality=${QUALITY}, min_saving=${Math.round(MIN_SAVING * 100)}%\n`,
  );

  if (totalSaved === 0) {
    throw new Error('Total saving is zero — nothing was worth rewriting (or every file errored).');
  }
}

// ----------------------------------------------------------------- dedupe ---

async function sha256Of(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`download failed for ${bucket}/${path}: ${error?.message || 'empty response'}`);
  return createHash('sha256').update(Buffer.from(await data.arrayBuffer())).digest('hex');
}

async function runDedupe(objects, refs) {
  console.log(`\n===== DEDUPE (${DRY_RUN ? 'dry run — nothing will be deleted' : 'LIVE RUN — spare copies will be deleted'}) =====`);

  const bySize = new Map();
  for (const o of objects) {
    if (o.size === 0) continue;
    const g = bySize.get(o.size) || [];
    g.push(o);
    bySize.set(o.size, g);
  }
  const sizeGroups = [...bySize.values()].filter((g) => g.length > 1).sort((a, b) => b[0].size - a[0].size);
  console.log(`Same-size groups to verify by hash: ${sizeGroups.length} (download budget: ${MAX_FILES} files).`);

  const identical = [];
  let downloads = 0;
  for (const group of sizeGroups) {
    if (downloads + group.length > MAX_FILES) {
      console.log(`  budget reached (${downloads}/${MAX_FILES} downloads) — remaining groups left for the next run.`);
      break;
    }
    const hashes = new Map();
    for (const o of group) {
      downloads += 1;
      try {
        const h = await sha256Of(o.bucket, o.path);
        const g = hashes.get(h) || [];
        g.push(o);
        hashes.set(h, g);
      } catch (e) {
        console.log(`  hash skipped for ${o.bucket}/${o.path}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    for (const members of hashes.values()) {
      if (members.length > 1) identical.push(members);
    }
  }

  console.log(`\nByte-identical groups: ${identical.length} (${downloads} downloads used).`);
  const rows = [];
  const deletionsByBucket = new Map();
  for (const members of identical) {
    const exact = members.filter((o) => refs.referencedPaths.has(`${o.bucket}/${o.path}`));
    const base = members.filter((o) => refs.referencedBases.has(basename(o.path).toLowerCase()));
    const keeper = exact[0] || base[0] || null;
    const spare = keeper ? members.filter((o) => o !== keeper) : [];
    if (keeper) {
      for (const o of spare) {
        const list = deletionsByBucket.get(o.bucket) || [];
        list.push(o.path);
        deletionsByBucket.set(o.bucket, list);
      }
    }
    rows.push([
      `${fmtBytes(members[0].size)} × ${members.length}`,
      keeper ? `${keeper.bucket}/${keeper.path}` : '(NO referenced copy — manual review, never auto-delete)',
      keeper ? spare.map((o) => `${o.bucket}/${o.path}`).join(', ') : '—',
    ]);
  }
  if (rows.length > 0) {
    console.log(table(rows, ['group', 'keeper (still referenced)', 'spares']));
  } else {
    console.log('No byte-identical duplicates found.');
  }

  const totalSpares = [...deletionsByBucket.values()].reduce((a, l) => a + l.length, 0);
  if (DRY_RUN) {
    console.log(`\nDry run: ${totalSpares} spare file(s) would be deleted. Re-run with dry_run=false + confirm=DELETE to delete.`);
    return;
  }
  if (DEDUPE_CONFIRM !== 'DELETE') {
    throw new Error('Refusing live dedupe: set the `confirm` input to exactly DELETE (dry_run=false alone is not enough).');
  }
  if (totalSpares === 0) {
    console.log('Nothing safe to delete (no group has a referenced keeper).');
    return;
  }
  for (const [bucket, paths] of deletionsByBucket) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) throw new Error(`Could not delete from ${bucket}: ${error.message}`);
    console.log(`Deleted ${paths.length} spare file(s) from ${bucket}.`);
  }
  console.log(`\nDedupe complete: ${totalSpares} spare file(s) deleted, one referenced copy kept per group.`);
  await summarize(`## Media dedupe (LIVE) — deleted ${totalSpares} spare file(s), one referenced copy kept per group.\n`);
}

// -------------------------------------------------------------------- main ---

async function main() {
  console.log(`Storage media ${TASK} · buckets=[${BUCKETS.join(', ')}] · dry_run=${DRY_RUN}`);
  console.log(`Supabase host: ${(() => { try { return new URL(SUPABASE_URL).host; } catch { return '(unparseable)'; } })()}`);

  const objects = [];
  for (const bucket of BUCKETS) {
    const listed = await listBucket(bucket);
    console.log(`Listed ${listed.length} object(s) in "${bucket}".`);
    objects.push(...listed);
  }
  if (objects.length === 0) {
    console.log('No objects found in the requested bucket(s).');
    return;
  }

  if (TASK === 'optimize') {
    await runOptimize(objects);
    return;
  }
  const refs = await collectReferences();
  if (TASK === 'audit') await runAudit(objects, refs);
  else await runDedupe(objects, refs);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e?.message || e}`);
  process.exit(1);
});
