import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';
import { DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';
import { isRssDoor } from '../../supabase/functions/_shared/rssHub';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const RUN = read('supabase/functions/minds-run-placement/index.ts');
const RUN_DOORS = read('supabase/functions/_shared/runDoors.ts');

// Phase 8 slice 4 widened this list to sixteen: the twelve from Phases 5 and 6, and four RSS doors (ping, no post).
describe('the day run includes all sixteen auto doors, and only those', () => {
  it('the open list is the sixteen auto doors and nothing else', () => {
    expect([...OPEN_DOORS].sort()).toEqual([...DOOR_IDS].sort());
    expect(OPEN_DOORS).toHaveLength(16);
  });

  it('the door step reads the open list, so a door cannot run unless it is open', () => {
    expect(RUN_DOORS).toMatch(/OPEN_DOORS/);
    expect(RUN).toMatch(/runDoors\(/);
  });

  it('the send step has a branch for every door that posts, and the RSS doors go through the ping branch', () => {
    for (const door of OPEN_DOORS) {
      if (isRssDoor(door)) continue;
      expect(RUN, door).toContain(`door === "${door}"`);
    }
    expect(RUN).toContain('if (isRssDoor(door)) {');
  });

  it('the database accepts all sixteen doors on the door-post table, and no gated channel', () => {
    const widened = read('supabase/migrations/20261014000000_door_posts_rss_four.sql');
    for (const door of OPEN_DOORS) expect(widened, door).toContain(`'${door}'`);
    for (const gated of ['instagram', 'tiktok', 'facebook', 'pinterest']) expect(widened, gated).not.toContain(`'${gated}'`);
  });

  it('no gated channel has a send branch in the day run', () => {
    for (const gated of ['instagram', 'tiktok', 'facebook', 'pinterest']) expect(RUN).not.toContain(`door === "${gated}"`);
  });
});
