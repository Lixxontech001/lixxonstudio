// Phase 2 freeze checks. Each test is one promise the owner was given at the end of Phase 2.
import { describe, expect, it } from 'vitest';
import adminAppSource from '../admin/AdminApp.tsx?raw';
import vercelConfig from '../../vercel.json?raw';
import { isBuddyControlsPath } from '../buddy/buddyPaths';
import { KILL_OPTIONS, MIND_KEYS, isKilled, isKillScope, type KillScope } from '../buddy/minds/mindRoster';
import { MINDS_CONTROLS_DEFAULTS, parseMindsControls } from '../buddy/minds/mindsControlsStore';
import { routeToPath } from '../context/NavigationContext';

describe('Takeover is off by default', () => {
  it('the defaults are Takeover off and Kill none', () => {
    expect(MINDS_CONTROLS_DEFAULTS).toEqual({ takeover: false, killScope: 'none' });
  });

  it('a missing or unreadable saved row keeps Takeover off', () => {
    expect(parseMindsControls(null)).toEqual({ takeover: false, killScope: 'none' });
    expect(parseMindsControls('yes')).toMatchObject({ takeover: false });
    expect(parseMindsControls({ takeover: 'true' })).toMatchObject({ takeover: false });
  });

  it('only a saved true turns Takeover on, and nothing else does', () => {
    expect(parseMindsControls({ takeover: true, kill_scope: 'none' }).takeover).toBe(true);
  });
});

describe('Kill round-trips', () => {
  const scopes: KillScope[] = ['none', 'all', ...MIND_KEYS];

  it('every Kill choice in the dropdown is saved and read back the same', () => {
    for (const option of KILL_OPTIONS) {
      const saved = { takeover: false, kill_scope: option.value };
      expect(parseMindsControls(saved).killScope).toBe(option.value);
      expect(isKillScope(option.value)).toBe(true);
    }
    expect(KILL_OPTIONS.map((option) => option.value)).toEqual(scopes);
  });

  it('Kill all stops every mind; a single mind stops only itself; none stops nothing', () => {
    for (const key of MIND_KEYS) {
      expect(isKilled('all', key)).toBe(true);
      expect(isKilled('none', key)).toBe(false);
      expect(isKilled(key, key)).toBe(true);
      for (const other of MIND_KEYS.filter((item) => item !== key)) {
        expect(isKilled(key, other)).toBe(false);
      }
    }
  });

  it('an unknown saved Kill value stops everything, never less', () => {
    expect(parseMindsControls({ takeover: false, kill_scope: 'nonsense' }).killScope).toBe('all');
  });
});

describe('the five minds roster', () => {
  it('the five minds are all there, Auditor included', () => {
    expect(MIND_KEYS).toEqual(['analyst', 'strategist', 'ceo', 'executioner', 'auditor']);
  });
});

describe('/admin/ai is the Minds watch, not the old 22-tab page', () => {
  it('AdminApp renders the Minds screen for admin-ai and never imports the old page', () => {
    expect(adminAppSource).toContain('AdminMinds');
    expect(adminAppSource).not.toMatch(/import\s+AdminAI\b|from\s+['"][^'"]*AdminAI['"]/);
    expect(adminAppSource).not.toMatch(/<AdminAI\b/);
  });
});

describe('/buddy/controls redirects to /buddy', () => {
  it('Vercel sends the old address to /buddy', () => {
    const config = JSON.parse(vercelConfig) as { redirects: { source: string; destination: string; permanent: boolean }[] };
    expect(config.redirects).toContainEqual({ source: '/buddy/controls', destination: '/buddy', permanent: false });
  });

  it('the app recognises the old address so it can move the owner to /buddy', () => {
    expect(isBuddyControlsPath('/buddy/controls')).toBe(true);
  });
});

describe('magazine routes are untouched', () => {
  it('article and shop addresses still build the same paths', () => {
    expect(routeToPath({ name: 'article', slug: 'spring-guide' })).toBe('/blog/spring-guide');
    expect(routeToPath({ name: 'shop' })).toBe('/shop');
    expect(routeToPath({ name: 'cart' })).toBe('/shop/cart');
    expect(routeToPath({ name: 'checkout' })).toBe('/shop/checkout');
  });
});
