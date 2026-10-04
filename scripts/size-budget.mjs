#!/usr/bin/env node
/**
 * Bundle size budget guard (Batch 9 groundwork, baseline recorded in PERFORMANCE.md).
 *
 * Reads the production `dist/` output, groups chunks by logical name, and fails
 * when a gzip size grows past the recorded budget plus a small tolerance.
 *
 * Usage:
 *   node scripts/size-budget.mjs            # check against scripts/size-budget.json
 *   node scripts/size-budget.mjs --update   # rewrite the baseline (owner decides)
 *   node scripts/size-budget.mjs --json     # machine-readable output
 *
 * Notes:
 * - Sizes are gzip, because that is what the reader downloads.
 * - Chunk file names carry content hashes, so groups match on the name prefix.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
const ASSETS = join(DIST, 'assets');
const BUDGET_FILE = 'scripts/size-budget.json';

/** Allowed growth over the recorded baseline before CI fails (mirrors the doc). */
const TOLERANCE = 0.05;

/** Logical groups: entry CSS/JS resolve from index.html, the rest by chunk prefix. */
const PREFIX_GROUPS = [
  ['react-vendor', 'react-vendor'],
  ['supabase', 'supabase'],
  ['icons', 'icons'],
  ['helmet', 'helmet'],
  ['sanitize', 'sanitize'],
  ['markdown', 'markdown'],
  ['vercel-analytics', 'vercel'],
  ['admin-pages', 'admin-pages'],
  ['article-reader', 'ArticleReader'],
];

function gzipSize(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

if (!existsSync(ASSETS)) {
  console.error('[size-budget] dist/assets not found — run `npx vite build` first.');
  process.exit(1);
}

const files = readdirSync(ASSETS);
const chunks = {};

// Named vendor chunks first, so the entry-point scan below cannot shadow them.
for (const [group, prefix] of PREFIX_GROUPS) {
  const match = files.find((f) => f.startsWith(`${prefix}-`) && f.endsWith('.js'));
  if (match) chunks[group] = match;
}

// Entry chunk + stylesheet are the ones index.html actually requests; anything
// else index.html preloads is only added when a group above has not claimed it.
const html = existsSync(join(DIST, 'index.html')) ? readFileSync(join(DIST, 'index.html'), 'utf8') : '';
const referenced = [...html.matchAll(/\/assets\/([\w.-]+\.(?:js|css))/g)].map((m) => m[1]);
for (const name of referenced) {
  if (!files.includes(name)) continue;
  if (Object.values(chunks).includes(name)) continue;
  const key = name.endsWith('.css') ? 'css' : name.startsWith('index-') ? 'entry' : name.replace(/-[\w-]+\.(js|css)$/, '-chunk');
  if (!chunks[key]) chunks[key] = name;
}

const measured = {};
for (const [group, file] of Object.entries(chunks)) {
  measured[group] = { file, raw: readFileSync(join(ASSETS, file)).length, gzip: gzipSize(join(ASSETS, file)) };
}

// Totals: keep the public-reader budget separate from the lazy admin application.
// Admin pages are intentionally excluded from the public cold-visitor total because the
// Vite entry never loads them for readers. They still get their own explicit budget below.
const jsFiles = files.filter((f) => f.endsWith('.js'));
const adminJsFiles = jsFiles.filter((f) => f.startsWith('admin-pages-'));
const publicJsFiles = jsFiles.filter((f) => !adminJsFiles.includes(f));
const cssFiles = files.filter((f) => f.endsWith('.css'));
const sumFiles = (list) => ({
  file: `${list.length} chunks`,
  raw: list.reduce((n, f) => n + readFileSync(join(ASSETS, f)).length, 0),
  gzip: list.reduce((n, f) => n + gzipSize(join(ASSETS, f)), 0),
});
measured['total-js'] = sumFiles(publicJsFiles);
measured['admin-total-js'] = sumFiles(adminJsFiles);
measured['total-css'] = {
  file: `${cssFiles.length} file(s)`,
  raw: cssFiles.reduce((n, f) => n + readFileSync(join(ASSETS, f)).length, 0),
  gzip: cssFiles.reduce((n, f) => n + gzipSize(join(ASSETS, f)), 0),
};

const asJson = process.argv.includes('--json');
const update = process.argv.includes('--update');
const baseline = existsSync(BUDGET_FILE) ? JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) : null;
const record = {
  note: 'Gzip bundle budgets. Regression = growth past baseline + 5% tolerance. Update only with an owner-approved reason.',
  recordedAt: new Date().toISOString().slice(0, 10),
  tolerance: TOLERANCE,
  budgets: Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, v.gzip])),
};

if (update || !baseline) {
  writeFileSync(BUDGET_FILE, `${JSON.stringify(record, null, 2)}\n`);
  if (!asJson) {
    console.log(`[size-budget] baseline ${update ? 'updated' : 'created'} at ${BUDGET_FILE}`);
    for (const [k, v] of Object.entries(measured)) console.log(`  ${k.padEnd(18)} ${formatKb(v.gzip).padStart(10)}  (${formatKb(v.raw)} raw)`);
  }
  process.exit(0);
}

const failures = [];
const rows = [];
for (const [group, current] of Object.entries(measured)) {
  const budget = baseline.budgets?.[group];
  if (budget === undefined) {
    rows.push({ group, budget: null, current: current.gzip, delta: null, status: 'new' });
    continue;
  }
  const limit = Math.round(budget * (1 + TOLERANCE));
  const delta = current.gzip - budget;
  const status = current.gzip > limit ? 'FAIL' : delta > 0 ? 'over' : 'ok';
  if (status === 'FAIL') failures.push(`${group}: ${formatKb(current.gzip)} > limit ${formatKb(limit)} (budget ${formatKb(budget)})`);
  rows.push({ group, budget, current: current.gzip, delta, status });
}

if (asJson) {
  console.log(JSON.stringify({ rows, failures }, null, 2));
} else {
  console.log('[size-budget] gzip budgets (limit = baseline + 5%)\n');
  for (const r of rows.sort((a, b) => b.current - a.current)) {
    const budget = r.budget === null ? '   —   ' : formatKb(r.budget);
    const delta = r.delta === null ? '' : `${r.delta > 0 ? '+' : ''}${(r.delta / 1024).toFixed(2)} kB`;
    console.log(`  ${r.status.padEnd(5)} ${r.group.padEnd(18)} ${formatKb(r.current).padStart(11)}  budget ${budget.padStart(10)}  ${delta}`);
  }
}

if (failures.length) {
  console.error(`\n[size-budget] ✗ ${failures.length} regression(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
if (!asJson) console.log('\n[size-budget] ✓ within budget');
