// Phase 9 slice 1 checks: the Phase 8 notables reach the briefing, a failed door is a notable, the kill copy,
// the template name, and the routes. Each check reads the real file, so a silent edit fails here.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd(); // vitest runs from the repository root
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const full = join(ROOT, dir, name);
    if (statSync(full).isDirectory()) return filesUnder(relative(ROOT, full));
    return /\.(tsx?|mjs)$/.test(name) && !/__tests__|\.test\./.test(full) ? [relative(ROOT, full)] : [];
  });
}

describe('door failure notable migration', () => {
  const migration = read('supabase/migrations/20261015000000_notable_door_failed.sql');
  const previous = read('supabase/migrations/20261011210000_notable_push.sql');

  it('adds door_failed and keeps every kind the table already allowed', () => {
    expect(migration).toContain("'door_failed'");
    const block = previous.match(/CHECK \(kind IN \(([\s\S]*?)\)\);/)?.[1] ?? '';
    const allowed = [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(allowed.length).toBeGreaterThan(10);
    for (const kind of allowed) expect(migration, kind).toContain(`'${kind}'`);
  });

  it('drops and recreates the kind check, and does not add door_failed to the buzz list', () => {
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS minds_notable_events_kind_check/);
    expect(read('supabase/functions/_shared/notablePush.ts')).not.toContain('door_failed');
  });
});

describe('Takeover and Kill copy', () => {
  const migration = read('supabase/migrations/20261015020000_minds_controls_change_source.sql');

  it('adds the change_source column, defaulting to minds', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS change_source text NOT NULL DEFAULT 'minds'/);
    expect(migration).toContain("CHECK (change_source IN ('minds', 'chat'))");
  });

  it('the trigger says "Stopped from chat." and "Started again from chat." for chat, and keeps the Minds line otherwise', () => {
    expect(migration).toContain('Stopped from chat.');
    expect(migration).toContain('Started again from chat.');
    expect(migration).toContain('Set by the owner in Minds.');
  });

  it('the chat path writes change_source chat, and the Minds screen writes minds', () => {
    expect(read('supabase/functions/buddy-think/index.ts')).toMatch(/change_source: "chat"/);
    expect(read('src/buddy/minds/mindsControlsStore.ts')).toMatch(/change_source: 'minds'/);
  });
});

describe('seeded video template name', () => {
  const migration = read('supabase/migrations/20261015010000_video_template_clear_name.sql');

  it('a new migration renames the seeded row to a no-city name', () => {
    expect(migration).toContain("SET name = 'Clear daylight (default)'");
    expect(migration).toContain("WHERE name = 'Lagos daylight (default)'");
  });

  it('the code default and its test use the no-city name, and never Lagos', () => {
    expect(read('scripts/video-template.mjs')).toContain('Clear daylight (default)');
    expect(read('scripts/video-template.mjs')).not.toMatch(/Lagos/);
    expect(read('scripts/video-template-assertions.sql')).not.toMatch(/Lagos daylight/);
    expect(read('src/__tests__/videoTemplates.test.ts')).not.toMatch(/Lagos daylight/);
  });

  it('the applied seed migration was not edited', () => {
    expect(read('supabase/migrations/20261006310000_video_templates.sql')).toContain("'Lagos daylight (default)'");
  });
});

describe('legacy Distribution and AdminAI are not owner routes', () => {
  it('the Distribution address redirects to Minds, and the sidebar does not link to it', () => {
    const app = read('src/admin/AdminApp.tsx');
    expect(app).toContain('RetiredDistributionRedirect');
    expect(app).not.toContain("import('./pages/AutomationDistribution')");
    expect(read('src/admin/AdminLayout.tsx')).not.toContain("href: '/admin/automation/distribution'");
  });

  it('no routed or shipped source imports the legacy Distribution page or AdminAI', () => {
    const shipped = [...filesUnder('src/admin'), ...filesUnder('src/buddy'), 'src/App.tsx'];
    const offenders = shipped.filter((file) => {
      try {
        return /pages\/AdminAI['"]|pages\/AutomationDistribution['"]/.test(read(file));
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });
});
