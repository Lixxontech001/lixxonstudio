// @vitest-environment node
// Phase F slice 3: the daily-log action for a door says only what happened. A failed or skipped row never says "posted".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { doorLogAction } from '../../supabase/functions/_shared/rssHub';

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('the daily-log action matches the outcome', () => {
  it('a sent row says posted to, and an RSS door says pinged', () => {
    expect(doorLogAction('telegram', 'Telegram', 'done')).toBe('Posted to Telegram');
    expect(doorLogAction('flipboard', 'Flipboard', 'done')).toBe('RSS updated and pinged for Flipboard');
  });

  it('a failed row never says posted', () => {
    expect(doorLogAction('telegram', 'Telegram', 'failed')).toBe('Could not post to Telegram');
    expect(doorLogAction('google_news', 'Google News', 'failed')).toBe('Could not ping Google News');
    for (const door of ['telegram', 'youtube', 'flipboard']) {
      expect(doorLogAction(door, door, 'failed')).not.toMatch(/posted|pinged for|^Posted/i);
    }
  });

  it('a skipped row says skipped, and never posted', () => {
    expect(doorLogAction('youtube', 'YouTube', 'skipped')).toBe('Skipped YouTube');
    expect(doorLogAction('vimeo', 'Vimeo', 'skipped')).not.toMatch(/posted|pinged/i);
  });

  it('the day run no longer writes a fixed "Posted to" line for every outcome', () => {
    const source = read('supabase/functions/minds-run-placement/index.ts');
    expect(source).not.toMatch(/action: `Posted to \$\{entry\.door\}`/);
    expect(source).toMatch(/action: doorLogAction\(entry\.door, DOOR_LABEL\[entry\.door\]/);
  });
});
