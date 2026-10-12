/**
 * Phase H slice 4: the Admin screens speak plain English.
 *
 * The owner reads these screens, so no engine word may reach a string the browser can draw. This scans the shipped
 * source instead of rendering every page, so it also covers screens no test mounts.
 *
 * What counts as owner-visible: JSX text between tags, and any quoted string that reads like a sentence (it holds a
 * space, or it is one of the engine words on its own). Module paths, permission keys and table names are not read by
 * the owner, and database check ids such as `db.seq_scans` are looked up, never drawn: the screen prints the plain
 * label beside them instead.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const BANNED = /vault|\brpc\b|oauth|postgres|\bjwt\b|\brls\b|seq_scan|supabase|vercel|automation keys|system check|ai provider|editorial cms|point-in-time/i;
const BARE = /^(?:the\s+)?(?:vault|rpc|rls|jwt|oauth|oauth 1\.0a|postgres|postgresql|supabase|vercel)$/i;
const IDENTIFIER = /^[A-Za-z_$][\w.$:/-]*$/;

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/** Comments are notes for the next developer, and imports are module paths: neither is drawn on a screen. */
function stripCommentsAndImports(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '');
}

function visibleStrings(src: string): string[] {
  const body = stripCommentsAndImports(src);
  const out: string[] = [];
  for (const m of body.matchAll(/>([^<>{}]{2,})</g)) out.push(m[1].trim());
  for (const m of body.matchAll(/['"`]([^'"`\n]*?)['"`]/g)) {
    const literal = m[1].trim();
    if (literal.length < 2) continue;
    if (IDENTIFIER.test(literal)) {
      if (BARE.test(literal)) out.push(literal);
      continue;
    }
    out.push(literal);
  }
  return out;
}

function adminFiles(dir = 'src/admin'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...adminFiles(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe('Phase H slice 4: the Admin screens are written in plain English', () => {
  it('no engine word reaches an owner-visible string on any Admin screen', () => {
    const offenders: string[] = [];
    for (const rel of adminFiles()) {
      for (const text of visibleStrings(read(rel))) {
        if (BANNED.test(text)) offenders.push(`${rel}: ${text.slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the retired labels are gone and the nav says Keys, Check and Data', () => {
    const layout = read('src/admin/AdminLayout.tsx');
    expect(layout).toMatch(/label: 'Keys', route: \{ name: 'admin-automation-keys' \}/);
    expect(layout).toMatch(/label: 'Brains', route:/);
    expect(layout).toMatch(/label: 'Check', route:/);
    expect(layout).toMatch(/label: 'Data', route:/);
    expect(layout).not.toMatch(/Automation keys|System Check|AI providers|Data explorer|Editorial CMS/);
    expect(read('src/admin/pages/AdminLogin.tsx')).not.toMatch(/Editorial CMS/);
    expect(read('src/admin/AdminLayout.tsx')).not.toMatch(/Editorial CMS/);
  });

  it('the Data screen opens with a plain example instead of engine internals', () => {
    const data = read('src/admin/pages/AdminDataExplorer.tsx');
    expect(data).toMatch(/Read-only query/);
    expect(data).toMatch(/FROM posts/);
    expect(data).not.toMatch(/pg_stat_user_tables|information_schema|seq_scan|Row-level|read-only transaction/);
  });

  it('the Settings screen sends the owner to the Keys page instead of the hosting dashboard', () => {
    const settings = read('src/admin/pages/AdminSettings.tsx');
    expect(settings).toMatch(/href="\/admin\/automation\/keys"/);
    expect(settings).toMatch(/saved once/);
    // The public and secret keys still have their build and server box. The email key moved to the Keys page, so its
    // old envelope line is gone, and the screen no longer names the hosting.
    expect(settings).not.toMatch(/Supabase|Edge Function|RESEND_API_KEY|\.env file/);
  });

  it('every check the database can raise has a plain label on the Health screen', () => {
    const sql = read('supabase/migrations/20261004202000_admin_ops_tools.sql');
    const raised = [...new Set([...sql.matchAll(/admin_health_set\(\s*'([a-z._]+)'/g)].map(m => m[1]))];
    expect(raised.length).toBeGreaterThan(20);
    const health = read('src/admin/pages/AdminHealth.tsx');
    const labels = new Map([...health.matchAll(/'([a-z._]+)': '([^']+)'/g)].map(m => [m[1], m[2]]));
    expect(raised.filter(key => !labels.has(key))).toEqual([]);
    // "Database" is a word the owner uses; these are the ones that only make sense to an engineer.
    const ENGINE_TALK = /vault|\brpc\b|postgres|\brls\b|\bsql\b|\bscan|cache|index|tuple|vacuum|analyze|\bcron\b|webhook|foreign key|backend|planner|policy/i;
    for (const [key, label] of labels) {
      expect({ key, plain: !ENGINE_TALK.test(label), label }).toEqual({ key, plain: true, label });
    }
  });

  it('the screen that explains a refusal does so without naming the machinery', () => {
    expect(read('src/admin/pages/AutomationRuns.tsx')).not.toMatch(/database-verified|automation monitor permission/);
    expect(read('src/admin/pages/AdminBackups.tsx')).not.toMatch(/point-in-time|Supabase Free/);
    expect(read('src/admin/pages/AdminAccess.tsx')).not.toMatch(/rows in the database|row-level security|calls the API/);
  });
});
