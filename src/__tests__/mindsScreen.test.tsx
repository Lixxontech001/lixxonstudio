// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import adminAppSource from '../admin/AdminApp.tsx?raw';
import adminLayoutSource from '../admin/AdminLayout.tsx?raw';
import mindsMigration from '../../supabase/migrations/20261009140000_minds_controls.sql?raw';

const state = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  readError: false,
  saveError: false,
  saves: [] as Array<Record<string, unknown>>,
  allowed: true,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'owner-1' } },
    loading: false,
    isAdmin: true,
    can: () => state.allowed,
  }),
}));

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'minds_controls') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => (state.readError
              ? { data: null, error: { message: 'denied' } }
              : { data: state.row, error: null }),
          }),
        }),
        upsert: async (payload: Record<string, unknown>) => {
          state.saves.push(payload);
          if (state.saveError) return { error: { message: 'denied' } };
          state.row = { takeover: payload.takeover, kill_scope: payload.kill_scope };
          return { error: null };
        },
      };
    },
  },
}));

import AdminMinds from '../admin/pages/AdminMinds';
import { isKilled, isKillScope, mindStatus, KILL_OPTIONS, MINDS } from '../buddy/minds/mindRoster';
import { parseMindsControls } from '../buddy/minds/mindsControlsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<AdminMinds />);
  });
  await flush();
  return host;
}

function unmount() {
  act(() => root?.unmount());
  host?.remove();
  root = null;
}

function takeoverSwitch(el: HTMLElement) {
  return el.querySelector<HTMLButtonElement>('button[role="switch"]');
}

function killSelect(el: HTMLElement) {
  return el.querySelector<HTMLSelectElement>('#minds-kill');
}

async function chooseKill(el: HTMLElement, value: string) {
  const select = killSelect(el);
  if (!select) throw new Error('kill select missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  state.row = null;
  state.readError = false;
  state.saveError = false;
  state.saves = [];
  state.allowed = true;
});

afterEach(() => {
  unmount();
});

describe('Minds screen', () => {
  it('shows Takeover off when nothing has been saved yet', async () => {
    const el = await mount();
    const toggle = takeoverSwitch(el);
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(toggle?.textContent).toBe('Off');
    expect(el.textContent).toContain('Off. The minds cannot change the site.');
  });

  it('shows six cards: Buddy and the five minds', async () => {
    const el = await mount();
    const cards = Array.from(el.querySelectorAll('article h3')).map((heading) => heading.textContent);
    expect(cards).toEqual(['Buddy', 'Analyst', 'Strategist', 'CEO', 'Executioner', 'Auditor']);
    expect(el.querySelectorAll('article')).toHaveLength(6);
  });

  it('is one screen, not the old 22-tab page', async () => {
    const el = await mount();
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(el.textContent).not.toContain('Digital twin');
    expect(el.textContent).not.toContain('Debate & trust');
    expect(el.textContent).not.toContain('Autopilot');
  });

  it('offers nothing stopped, stop all, and one option per mind in the Kill dropdown', async () => {
    const el = await mount();
    const values = Array.from(killSelect(el)?.options ?? []).map((option) => option.value);
    expect(values).toEqual(['none', 'all', 'analyst', 'strategist', 'ceo', 'executioner', 'auditor']);
  });

  it('saves Kill all, and the saved choice is shown again after a reload', async () => {
    const first = await mount();
    await chooseKill(first, 'all');
    expect(state.saves).toHaveLength(1);
    expect(state.saves[0]).toMatchObject({ id: 1, kill_scope: 'all', takeover: false, updated_by: 'owner-1' });
    expect(first.textContent).toContain('Saved.');
    unmount();

    const second = await mount();
    expect(killSelect(second)?.value).toBe('all');
    const stopped = Array.from(second.querySelectorAll('article p')).filter((p) => p.textContent === 'Stopped by Kill.');
    expect(stopped).toHaveLength(5);
  });

  it('a single mind kill stops only that card after a reload', async () => {
    const first = await mount();
    await chooseKill(first, 'ceo');
    unmount();
    const second = await mount();
    expect(killSelect(second)?.value).toBe('ceo');
    const ceoCard = second.querySelector('#mind-ceo')?.closest('article');
    const analystCard = second.querySelector('#mind-analyst')?.closest('article');
    expect(ceoCard?.textContent).toContain('Stopped by Kill.');
    expect(analystCard?.textContent).not.toContain('Stopped by Kill.');
  });

  it('turning Takeover on is saved and shown again after a reload', async () => {
    const first = await mount();
    await act(async () => {
      takeoverSwitch(first)?.click();
    });
    await flush();
    expect(state.saves[0]).toMatchObject({ takeover: true, kill_scope: 'none' });
    unmount();
    const second = await mount();
    expect(takeoverSwitch(second)?.getAttribute('aria-checked')).toBe('true');
  });

  it('a failed save does not move the switch and says so plainly', async () => {
    state.saveError = true;
    const el = await mount();
    await act(async () => {
      takeoverSwitch(el)?.click();
    });
    await flush();
    expect(takeoverSwitch(el)?.getAttribute('aria-checked')).toBe('false');
    expect(el.textContent).toContain('Minds could not save. Try again shortly.');
    expect(el.textContent).not.toContain('Saved.');
  });

  it('a failed read shows an honest message and no switches', async () => {
    state.readError = true;
    const el = await mount();
    expect(el.textContent).toContain('Minds could not be read. Try again shortly.');
    expect(takeoverSwitch(el)).toBeNull();
    expect(killSelect(el)).toBeNull();
  });

  it('without the Admin AI permission it shows a notice and no controls', async () => {
    state.allowed = false;
    const el = await mount();
    expect(el.textContent).toContain('You need the Admin AI permission to see the Minds.');
    expect(takeoverSwitch(el)).toBeNull();
    expect(state.saves).toHaveLength(0);
  });
});

describe('Kill and Takeover rules', () => {
  it('Kill all stops every mind, one mind stops only itself, none stops nothing', () => {
    for (const mind of MINDS) {
      expect(isKilled('all', mind.key)).toBe(true);
      expect(isKilled('none', mind.key)).toBe(false);
      expect(isKilled(mind.key, mind.key)).toBe(true);
    }
    expect(isKilled('ceo', 'analyst')).toBe(false);
  });

  it('the status line says Stopped by Kill, or waits, and never claims work happened', () => {
    expect(mindStatus(false, 'all', 'auditor')).toBe('Stopped by Kill.');
    expect(mindStatus(false, 'none', 'analyst')).toBe('Waiting. Nothing has run yet.');
    expect(mindStatus(true, 'none', 'analyst')).toBe('Takeover is on. Nothing has run yet.');
  });

  it('accepts only known Kill values', () => {
    expect(KILL_OPTIONS.map((option) => option.value).every(isKillScope)).toBe(true);
    expect(isKillScope('everything')).toBe(false);
    expect(isKillScope('buddy')).toBe(false);
  });

  it('defaults Takeover to off, and an unknown saved Kill value stops everything', () => {
    expect(parseMindsControls(null)).toEqual({ takeover: false, killScope: 'none' });
    expect(parseMindsControls({ takeover: 'true', kill_scope: 'none' })).toEqual({ takeover: false, killScope: 'none' });
    expect(parseMindsControls({ takeover: true, kill_scope: 'nonsense' })).toEqual({ takeover: true, killScope: 'all' });
  });
});

describe('Admin wiring', () => {
  it('routes /admin/ai to the Minds screen, not the old 22-tab page', () => {
    expect(adminAppSource).toContain("import('./pages/AdminMinds')");
    expect(adminAppSource).not.toContain("import('./pages/AdminAI')");
    expect(adminAppSource).toContain('<AdminMinds />');
  });

  it('labels the owner’s nav entry Minds', () => {
    expect(adminLayoutSource).toContain("{ label: 'Minds', route: { name: 'admin-ai' }");
    expect(adminLayoutSource).not.toContain("label: 'Admin AI'");
  });
});

describe('minds_controls migration', () => {
  it('is owner only, defaults Takeover off, and has no delete or anon access', () => {
    expect(mindsMigration).toContain('takeover boolean NOT NULL DEFAULT false');
    expect(mindsMigration).toContain("kill_scope text NOT NULL DEFAULT 'none'");
    expect(mindsMigration).toContain('REVOKE ALL ON public.minds_controls FROM anon');
    expect(mindsMigration).toContain('public.is_admin() AND (public.is_owner() OR public.is_founder())');
    expect(mindsMigration).not.toMatch(/FOR DELETE/i);
    expect(mindsMigration).not.toMatch(/\bTO (anon|public)\b/i);
  });

  it('does not touch posts, email, cron or products', () => {
    expect(mindsMigration).not.toMatch(/\bposts\b/i);
    expect(mindsMigration).not.toMatch(/cron\./i);
    expect(mindsMigration).not.toMatch(/\bproducts\b/i);
    expect(mindsMigration).not.toMatch(/net\.http|send_email/i);
  });
});
