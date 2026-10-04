#!/usr/bin/env node
/**
 * Turns an `lhci collect` results directory into a median mobile scorecard
 * (markdown + JSON) so performance numbers are recorded as evidence rather than
 * "the assertion was green".
 *
 * Usage: node scripts/lhci-summary.mjs <results-dir> [--write-file out.json]
 *
 * Prints markdown to stdout. Also appends to $GITHUB_STEP_SUMMARY when present.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
};
const jsonOut = argValue('--json');
const markdownOut = argValue('--markdown');

if (!dir || !existsSync(dir)) {
  console.error('[lhci-summary] usage: node scripts/lhci-summary.mjs <lhci-results-dir>');
  process.exit(1);
}

/**
 * Unwrap one parsed JSON blob into Lighthouse reports.
 * Handles: a bare report, an array of reports, LHCI's collect output
 * (`[{ lhr: … }]`), and an LHCI results directory walk.
 */
function unwrap(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.flatMap(unwrap);
  if (parsed.categories) return [parsed];
  if (parsed.lhr?.categories) return [parsed.lhr];
  if (parsed.report?.categories) return [parsed.report];
  return [];
}

function findReports(directory) {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...findReports(full));
    else if (entry.name.endsWith('.json') && entry.name !== 'manifest.json') {
      out.push(...loadFile(full));
    }
  }
  return out;
}

function loadFile(file) {
  try {
    return unwrap(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return [];
  }
}

// LHCI writes either a directory of per-run reports or a single JSON file,
// depending on the --outputPath it was given. Accept both.
let reports = [];
if (existsSync(dir)) {
  if (statSync(dir).isDirectory()) {
    reports = findReports(dir);
    if (!reports.length) {
      for (const candidate of [`${dir}.json`, join(dir, 'lhci-out.json'), join(dir, 'results.json')]) {
        if (!existsSync(candidate)) continue;
        reports = loadFile(candidate);
        if (reports.length) break;
      }
    }
  } else {
    reports = loadFile(dir);
  }
}

if (!reports.length) {
  console.error(`[lhci-summary] no Lighthouse JSON reports found at ${dir}`);
  process.exit(1);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const score = (report, id) => (report.categories?.[id]?.score ?? 0) * 100;
const metric = (report, id) => report.audits?.[id]?.numericValue ?? 0;

const categoryIds = ['performance', 'accessibility', 'best-practices', 'seo'];
const metricIds = [
  ['first-contentful-paint', 'FCP'],
  ['largest-contentful-paint', 'LCP'],
  ['total-blocking-time', 'TBT'],
  ['cumulative-layout-shift', 'CLS'],
  ['speed-index', 'SI'],
  ['server-response-time', 'TTFB'],
];

const summary = {
  runs: reports.length,
  measuredAt: new Date().toISOString(),
  url: reports[0].finalDisplayedUrl || reports[0].finalUrl || reports[0].requestedUrl || '',
  scores: {},
  metrics: {},
};

for (const id of categoryIds) summary.scores[id] = Math.round(median(reports.map((r) => score(r, id))));
for (const [id, label] of metricIds) {
  const value = median(reports.map((r) => metric(r, id)));
  summary.metrics[label] = id === 'cumulative-layout-shift' ? Number(value.toFixed(3)) : Math.round(value);
}


/* ------------------------------------------------------------------ *
 * Diagnostics — medians answer "how bad"; these answer "why".
 * Taken from the worst-performing run so fixes target the real cause.
 * ------------------------------------------------------------------ */

const short = (value, max = 90) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

function opportunities(report, limit = 7) {
  return Object.values(report.audits ?? {})
    .filter(
      (audit) =>
        audit?.details?.type === 'opportunity' &&
        audit.score !== null &&
        audit.score < 1 &&
        (audit.details.overallSavingsMs ?? 0) > 40
    )
    .sort((a, b) => (b.details.overallSavingsMs ?? 0) - (a.details.overallSavingsMs ?? 0))
    .slice(0, limit)
    .map((audit) => `- ${audit.title} — save **${Math.round(audit.details.overallSavingsMs)} ms**`);
}

function failingAudits(report, categoryId, limit = 6) {
  const refs = report.categories?.[categoryId]?.auditRefs ?? [];
  return refs
    .map((ref) => report.audits?.[ref.id])
    .filter(
      (audit) =>
        audit &&
        audit.score !== null &&
        audit.score < 1 &&
        !['notApplicable', 'informative', 'manual'].includes(audit.scoreDisplayMode)
    )
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, limit)
    .map((audit) => `- ${audit.title}${audit.displayValue ? ` — ${audit.displayValue}` : ''}`);
}

function heaviestResources(report, limit = 5) {
  const items = report.audits?.['total-byte-weight']?.details?.items ?? [];
  return items
    .slice(0, limit)
    .map((item) => `- ${Math.round((item.totalBytes ?? 0) / 1024)} kB — \`${short(item.url, 80)}\``);
}

function diagnosticsFor(report) {
  const lcpNode = report.audits?.['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
  const out = {
    lcpElement: lcpNode ? { selector: lcpNode.selector, snippet: short(lcpNode.snippet, 140) } : null,
    lcpLazyLoaded: report.audits?.['lcp-lazy-loaded']?.score === 0,
    opportunities: opportunities(report),
    failing: Object.fromEntries(
      ['accessibility', 'best-practices', 'seo'].map((id) => [id, failingAudits(report, id)])
    ),
    heaviestResources: heaviestResources(report),
  };
  return out;
}

const worst = reports.reduce((a, b) => (score(a, 'performance') <= score(b, 'performance') ? a : b));
const diagnostics = diagnosticsFor(worst);
summary.diagnostics = diagnostics;

const diagnosticLines = [];
diagnosticLines.push('', '### What is costing points', '', '_From the worst run; medians above._', '');
if (diagnostics.lcpElement) {
  diagnosticLines.push(
    `- **LCP element** \`${short(diagnostics.lcpElement.selector, 60)}\`${
      diagnostics.lcpElement.snippet ? ` — \`${short(diagnostics.lcpElement.snippet, 120)}\`` : ''
    }`
  );
}
if (diagnostics.lcpLazyLoaded) diagnosticLines.push('- **The LCP image is lazy-loaded** — make it eager with high priority.');
if (diagnostics.opportunities.length) {
  diagnosticLines.push('', '**Biggest opportunities**', '', ...diagnostics.opportunities);
}
for (const [id, rows] of Object.entries(diagnostics.failing)) {
  if (rows.length) diagnosticLines.push('', `**Failing ${id} audits**`, '', ...rows);
}
if (diagnostics.heaviestResources.length) {
  diagnosticLines.push('', '**Heaviest resources**', '', ...diagnostics.heaviestResources);
}

const lines = [
  `### Mobile Lighthouse — ${summary.url || dir}`,
  '',
  `${summary.runs} run(s), median reported.`,
  '',
  '| Category | Score | 🚦 |',
  '|---|---|---|',
  ...categoryIds.map((id) => {
    const value = summary.scores[id];
    const flag = value >= 95 ? '🟢 ≥95' : value >= 90 ? '🟡 90–94' : '🔴 <90';
    return `| ${id} | ${value} | ${flag} |`;
  }),
  '',
  '| Metric | Value |',
  '|---|---|',
  ...metricIds.map(([id, label]) => {
    const value = summary.metrics[label];
    return `| ${label} | ${id === 'cumulative-layout-shift' ? value : `${value} ms`} |`;
  }),
  '',
  '_Targets: LCP < 1500 ms · INP < 150 ms · CLS < 0.05 · TTFB < 400 ms · all categories ≥ 95 (Batch 9)._',
  ...diagnosticLines,
];

const markdown = `${lines.join('\n')}\n`;
process.stdout.write(`\n${markdown}\n`);
summary.markdown = markdown;
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
if (markdownOut) writeFileSync(markdownOut, markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
}
