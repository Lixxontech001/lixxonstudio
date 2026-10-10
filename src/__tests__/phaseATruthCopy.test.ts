// @vitest-environment node
// Phase A slice 5: the two lies are gone. Buddy's system text states the real Takeover rule, and the Minds
// screen does not say "no change reaches the site yet" while Takeover is on. The old sentences stay absent.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUDDY_SYSTEM_INSTRUCTION } from '../../supabase/functions/_shared/buddyThink';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

/** Every non-test source file under src and supabase/functions, as [relative path, text]. */
function sourceFiles(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|sql)$/.test(entry)) out.push([path.relative(process.cwd(), full), readFileSync(full, 'utf8')]);
    }
  };
  walk(path.join(process.cwd(), 'src'));
  walk(path.join(process.cwd(), 'supabase', 'functions'));
  return out;
}

/** The two lies, and the close variants, in the owner-facing and system text. */
const OLD_SENTENCES = [
  'no change reaches the site yet',
  'Plans can be checked, but no change reaches',
  'You can read the site but you cannot change it',
  'You cannot publish, edit articles, change products or prices, or spend money.',
  'can never change the site',
  'It cannot change any of them.',
];

describe('lie 1: Buddy\'s system text states the real Takeover rule', () => {
  it('does not say Buddy can never change the site', () => {
    expect(BUDDY_SYSTEM_INSTRUCTION).not.toMatch(/can never change|cannot change it|never change the site/i);
  });

  it('states both halves of the rule: Takeover off cannot change, Takeover on may do allowed work and must say so', () => {
    expect(BUDDY_SYSTEM_INSTRUCTION).toContain('Takeover off: nothing on the site changes, and you say so.');
    expect(BUDDY_SYSTEM_INSTRUCTION).toContain('Takeover on: the minds may do the work they are already allowed to do, and you must tell the owner');
  });

  it('Buddy itself still never publishes, edits, changes prices or spends money', () => {
    expect(BUDDY_SYSTEM_INSTRUCTION).toContain('You never publish, edit articles, change products or prices, or spend money yourself.');
  });
});

describe('lie 2: the Minds screen copy matches Takeover', () => {
  it('the On line describes what the minds may do, and the Off line still says the minds cannot change the site', () => {
    const source = read('src/admin/pages/AdminMinds.tsx');
    expect(source).toContain('The minds may make the changes they are already allowed to make.');
    expect(source).toContain("'Off. The minds cannot change the site.'");
    expect(source).not.toContain('no change reaches the site yet');
  });
});

describe('the old sentences are absent from source and functions', () => {
  it.each(OLD_SENTENCES)('"%s" appears nowhere outside tests and the README history', (sentence) => {
    const hits = sourceFiles().filter(([, text]) => text.includes(sentence)).map(([file]) => file);
    expect(hits).toEqual([]);
  });
});
