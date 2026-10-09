// Phase 6 freeze. These are checks on the source files, not on live doors or a live database
// (the sandbox cannot reach them). Each one names a rule from the Phase 6 brief.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

/** Every file under a folder, skipping tests. */
function filesUnder(folder: string, extensions: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.some((ext) => name.endsWith(ext)) && !/\.test\.|__tests__/.test(full)) out.push(relative(ROOT, full));
    }
  };
  walk(join(ROOT, folder));
  return out;
}

const RUN = read('supabase/functions/minds-run-placement/index.ts');
const RUN_DOORS = read('supabase/functions/_shared/runDoors.ts');
const GATED = ['instagram', 'tiktok', 'facebook', 'pinterest'];
const PHASE6_MIGRATIONS = [
  'supabase/migrations/20261011130000_door_catalog_twelve.sql',
  'supabase/migrations/20261011140000_door_posts_twelve.sql',
  'supabase/migrations/20261011150000_door_posts_three_open.sql',
  'supabase/migrations/20261011160000_podcast_cover_catalog.sql',
  'supabase/migrations/20261011170000_door_posts_all_twelve_open.sql',
  'supabase/migrations/20261011180000_podcast_episodes.sql',
];

describe('Phase 6 freeze: twelve auto doors, four gated channels manual', () => {
  it('exactly twelve auto doors are open, and they are the same list as the registry', () => {
    expect(OPEN_DOORS).toHaveLength(12);
    expect([...OPEN_DOORS].sort()).toEqual([...DOOR_IDS].sort());
  });

  it('the four gated channels and WhatsApp are not doors', () => {
    for (const channel of [...GATED, 'whatsapp']) {
      expect(DOOR_IDS as readonly string[]).not.toContain(channel);
      expect(OPEN_DOORS as readonly string[]).not.toContain(channel);
    }
  });

  it('the day run sends to the twelve open doors and to nothing else (no 13th send)', () => {
    const branches = new Set([...RUN.matchAll(/door === "([a-z_]+)"/g)].map((match) => match[1]));
    expect([...branches].sort()).toEqual([...OPEN_DOORS].sort());
  });

  it('no posting address for a gated channel exists in the day run or the door modules', () => {
    const postingPaths = /graph\.facebook\.com[^'"`\s]*\/(feed|photos|videos|media_publish|media)\b|tiktokapis\.com[^'"`\s]*\/(video|content)\/init|api\.pinterest\.com[^'"`\s]*\/pins\b|\/publish\/action\b/;
    const doorFiles = [...filesUnder('supabase/functions/_shared', ['.ts']), 'supabase/functions/minds-run-placement/index.ts', 'supabase/functions/buddy-think/index.ts'];
    for (const file of doorFiles) expect(read(file), file).not.toMatch(postingPaths);
  });

  it('the day run does not import the older gated-channel modules', () => {
    expect(RUN).not.toMatch(/distributionAdapters|distributionRun/);
    // The one import from the key-checks module is the request origin check, not a posting path.
    const keyCheckImports = [...RUN.matchAll(/import \{([^}]*)\} from "\.\.\/_shared\/automationKeyChecks\.ts"/g)].map((match) => match[1].trim());
    expect(keyCheckImports).toEqual(['isAllowedAutomationOrigin']);
    for (const channel of GATED) expect(RUN, channel).not.toContain(`door === "${channel}"`);
  });
});

describe('Phase 6 freeze: takeover, Kill and the Auditor', () => {
  it('takeover is off by default, and no migration or seed turns it on', () => {
    expect(read('supabase/migrations/20261009140000_minds_controls.sql')).toMatch(/takeover boolean NOT NULL DEFAULT false/);
    const sql = [...filesUnder('supabase/migrations', ['.sql']), ...filesUnder('supabase', ['.sql']).filter((file) => !file.startsWith('supabase/migrations/'))];
    for (const file of new Set(sql)) {
      expect(read(file), file).not.toMatch(/takeover\s*=\s*true\b/i);
      expect(read(file), file).not.toMatch(/takeover\s+boolean\s+not\s+null\s+default\s+true/i);
    }
  });

  it('only the owner or a founder admin can change Takeover or Kill; no mind can', () => {
    const policies = read('supabase/migrations/20261009140000_minds_controls.sql');
    expect(policies).toMatch(/CREATE POLICY minds_controls_owner_update[\s\S]*?is_owner\(\) OR public\.is_founder\(\)/);
    expect(policies).toMatch(/CREATE POLICY minds_controls_owner_insert[\s\S]*?is_owner\(\) OR public\.is_founder\(\)/);
  });

  it('a Takeover or Kill refusal stops the door step before any door is read', () => {
    expect(RUN_DOORS).toMatch(/blockedDetail\(input\.takeover, input\.killScope\)/);
    const gate = RUN_DOORS.indexOf('blockedDetail(input.takeover, input.killScope)');
    const firstRead = RUN_DOORS.indexOf('await ports.readArticles()');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(firstRead);
  });

  it('the reservation function refuses a run when Takeover is off or Kill stops the minds', () => {
    expect(read('supabase/migrations/20261011170000_door_posts_all_twelve_open.sql')).toMatch(/minds_assert_can_act\(\)/);
  });
});

describe('Phase 6 freeze: a failed save never jams a door, and never sends it twice', () => {
  it('a failed save is tried again, then logged as a notable error', () => {
    expect(RUN_DOORS).toMatch(/FINISH_ATTEMPTS = 3/);
    expect(RUN_DOORS).toMatch(/posted, but the record could not be saved\. Check the log\./);
  });

  it('one article goes to one door once: the reservation refuses a second send for the same article', () => {
    expect(read('supabase/migrations/20261011170000_door_posts_all_twelve_open.sql')).toMatch(/already_posted/);
  });

  it('one post per door per local day', () => {
    expect(RUN_DOORS).toMatch(/DOOR_DAILY_LIMIT/);
  });
});

describe('Phase 6 freeze: honest skips, no fake uploads or enclosures', () => {
  it('a missing video or audio file skips the door with a plain reason, before anything is reserved', () => {
    expect(RUN_DOORS).toContain('no video yet. Nothing was posted.');
    expect(RUN_DOORS).toContain('audio not made yet. Nothing was posted.');
    const skip = RUN_DOORS.indexOf('audio not made yet');
    const reserve = RUN_DOORS.indexOf('ports.reserve(');
    expect(skip).toBeLessThan(reserve);
  });

  it('YouTube and Vimeo never upload an empty or non-MP4 file', () => {
    const adapters = read('supabase/functions/_shared/doorAdapters.ts');
    expect(adapters).toContain('The video is not an MP4 file.');
    expect(adapters).toContain('The video file is empty. Nothing was sent.');
  });

  it('the podcast episode needs real audio: the table refuses a fake or empty enclosure', () => {
    const table = read('supabase/migrations/20261011180000_podcast_episodes.sql');
    expect(table).toMatch(/audio_bytes bigint NOT NULL CHECK \(audio_bytes > 0\)/);
    expect(table).toMatch(/audio_type text NOT NULL CHECK \(audio_type = 'audio\/mpeg'\)/);
  });
});

describe('Phase 6 freeze: Medium, Pixelfed and the podcast show', () => {
  it('Medium uses an existing token only: no token is created or exchanged for Medium', () => {
    const adapters = read('supabase/functions/_shared/doorAdapters.ts');
    expect(adapters).not.toMatch(/api\.medium\.com\/v1\/tokens|medium\.com\/m\/oauth/);
  });

  it('Pixelfed has no default server address', () => {
    expect(read('supabase/functions/_shared/doorRegistry.ts')).not.toMatch(/pixelfed\.(social|org)/);
    for (const file of filesUnder('src', ['.ts', '.tsx'])) {
      if (file.includes('__tests__')) continue;
      expect(read(file), file).not.toMatch(/https:\/\/pixelfed\.(social|org)/);
    }
  });

  it('the podcast is a show feed on this site, not a raw channel', () => {
    expect(read('vercel.json')).toContain('"source": "/podcast.xml"');
    expect(read('api/feeds.ts')).toMatch(/'podcast'/);
    expect(read('supabase/functions/feeds/index.ts')).toMatch(/type === "podcast"/);
    const feed = read('supabase/functions/_shared/podcastFeed.ts');
    expect(feed).toContain('itunes:author');
    expect(feed).toContain('itunes:image');
    expect(feed).toContain('<enclosure');
  });
});

describe('Phase 6 freeze: nothing applied, nothing deployed, and reader copy stays clean', () => {
  it('every Phase 6 migration says it is not applied to production, and drops nothing', () => {
    for (const file of PHASE6_MIGRATIONS) {
      const sql = read(file);
      expect(sql, file).toMatch(/NOT applied to production/);
      expect(sql, file).not.toMatch(/drop\s+table|delete\s+from\s+public\.(posts|products|minds_)/i);
    }
  });

  it('the reader-facing door, podcast, feed and briefing modules have no em dash, and name no country, city or currency', () => {
    const modules = [
      'supabase/functions/feeds/index.ts',
      'supabase/functions/_shared/podcastFeed.ts',
      'supabase/functions/_shared/buddyHowTo.ts',
      'supabase/functions/_shared/doorAdapters.ts',
      'supabase/functions/_shared/doorPosts.ts',
      'supabase/functions/_shared/runDoors.ts',
      'supabase/functions/_shared/doorConnectionTests.ts',
      'supabase/functions/_shared/buddyBriefing.ts',
    ];
    for (const file of modules) {
      const text = read(file);
      expect(text, file).not.toMatch(/—|–/);
      expect(text, file).not.toMatch(/Nigeria|Naira|Lagos|Abuja|\bWAT\b/);
    }
  });
});
