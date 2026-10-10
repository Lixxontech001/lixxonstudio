// Phase 9 slice 4: Buddy's look is its own. CSS only. The checks read buddy.css and the vibe list.
// Four looks, no fifth. The greeting colours come from the current data-vibe variables. Buddy keeps its own type,
// so the magazine's Playfair headings, porcelain body and bronze selection do not reach inside it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VIBES } from '../buddy/buddyVibes';

const css = readFileSync(join(process.cwd(), 'src/buddy/buddy.css'), 'utf8');

/** The body of the first rule whose selector starts with `selector`. Rules here are not nested, so the first `}` closes it. */
function ruleBodies(prefix: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`(^|\\n)(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*)\\{([^}]*)\\}`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) out.push(match[3]);
  return out;
}

describe('Buddy has four looks and no fifth', () => {
  it('buddy.css defines exactly the four looks, in the same order as the settings list', () => {
    const defined = [...css.matchAll(/^\.buddy-app\[data-vibe='([a-z-]+)'\]/gm)].map((match) => match[1]);
    expect(defined).toEqual(VIBES.map((vibe) => vibe.id));
    expect(defined).toHaveLength(4);
  });
});

describe('the greeting animation uses the current data-vibe colours', () => {
  it('every greeting rule takes its colour from a Buddy variable, with no fixed colour', () => {
    const bodies = [...ruleBodies('.buddy-greeting'), ...ruleBodies('.buddy-greeting-line')];
    expect(bodies.length).toBeGreaterThan(4);
    for (const body of bodies) {
      expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });

  it('the shimmer keyframes use the vibe shimmer variable only', () => {
    const keyframes = css.match(/@keyframes buddy-shimmer\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(keyframes).toContain('var(--buddy-shimmer)');
    expect(keyframes).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it('the greeting line and mark use gold variables that each look defines', () => {
    expect(css).toMatch(/\.buddy-greeting-line \{[^}]*stroke: var\(--buddy-gold\)/);
    expect(css).toMatch(/\.buddy-greeting-line-text \{[^}]*color: var\(--buddy-gold-strong\)/);
  });
});

describe('Buddy does not look like the magazine or Admin', () => {
  it('the shell sets its own serif, its own background, and no Inter or Playfair', () => {
    const shell = ruleBodies('.buddy-app').join('\n');
    expect(shell).toContain('font-family: Georgia');
    expect(shell).toContain('radial-gradient(');
    expect(shell).toContain('var(--buddy-bg)');
    expect(shell).not.toMatch(/Inter|Playfair|system-ui/);
  });

  it('headings inside Buddy inherit Buddy type, so the global Playfair heading rule cannot reach them', () => {
    expect(css).toMatch(/\.buddy-app h1,\s*\.buddy-app h2,\s*\.buddy-app h3,\s*\.buddy-app h4 \{\s*font-family: inherit;/);
    expect(css).toMatch(/\.buddy-name \{[^}]*font-family: inherit;[^}]*text-transform: uppercase/);
  });

  it('selections inside Buddy use the vibe gold, not the magazine bronze', () => {
    expect(css).toMatch(/\.buddy-app ::selection \{\s*background: var\(--buddy-gold\);/);
    expect(css).not.toMatch(/#C48B71|#c48b71/);
  });

  it('owner bubbles, the composer and the greeting use Buddy serif, not the sans-serif admin stack', () => {
    expect(css).not.toMatch(/system-ui/);
    for (const body of ruleBodies('.buddy-msg--owner')) expect(body).toContain('font-family: inherit');
  });

  it('the magazine porcelain and the Admin grey are not used anywhere in the Buddy stylesheet', () => {
    expect(css).not.toMatch(/#FDFBF7|#fdfbf7|#E9E5DC|#e9e5dc|bg-taupe|text-charcoal/);
  });
});
