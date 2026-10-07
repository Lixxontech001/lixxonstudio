// @vitest-environment jsdom
/**
 * Cleanup-sweep assertions for the surfaces added in Phase 5 (push opt-in panel
 * and Buddy): WCAG contrast of the colour pairs actually shipped, accessible
 * names for every control, 44 px touch targets, and visible focus styling.
 *
 * Token values are read from the real tailwind config, so a future palette change
 * that breaks contrast fails here instead of shipping.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import tailwindConfig from '../../tailwind.config.js';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), order: vi.fn() }));

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
    from: () => ({ select: () => ({ order: mocks.order }) }),
  },
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'owner-1' } },
    loading: false,
    isAdmin: true,
    refreshAdmin: vi.fn(),
    can: () => true,
  }),
}));
vi.mock('../admin/MfaGate', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import PushNotificationsPanel from '../components/automation-push-panel';
import BuddyPwaApp from '../buddy/BuddyPwaApp';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Palette = Record<string, string | Record<string, string>>;

function token(path: string): string {
  const colours = (tailwindConfig as { theme: { extend: { colors: Palette } } }).theme.extend.colors;
  const [head, tail] = path.split('.');
  const value = colours[head];
  if (typeof value === 'string') return value;
  return (value as Record<string, string>)[tail ?? 'DEFAULT'];
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The pairs these two surfaces actually render as text or button labels. */
const SHIPPED_TEXT_PAIRS: Array<[string, string, string]> = [
  ['body text on cards', 'charcoal.DEFAULT', 'ivory'],
  ['muted text on cards', 'charcoal.muted', 'ivory'],
  ['muted text on the page background', 'charcoal.muted', 'taupe.light'],
  ['body text on the page background', 'charcoal.DEFAULT', 'taupe.light'],
  ['primary button label', 'ivory', 'charcoal.DEFAULT'],
  ['primary button label (hover)', 'ivory', 'charcoal.light'],
  ['heading and body text on the safety panel', 'charcoal.DEFAULT', 'taupe.light'],
];

describe('Phase 5 surfaces meet WCAG AA contrast', () => {
  it.each(SHIPPED_TEXT_PAIRS)('%s', (_label, foreground, background) => {
    const ratio = contrast(token(foreground), token(background));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('does not use the low-contrast bronze pairing for any text or button label', async () => {
    // bronze on white is 2.89:1 and white on bronze is 2.89:1 — both fail AA, so
    // bronze may only remain as a decorative accent or a border.
    for (const source of ['../components/automation-push-panel.tsx', '../buddy/BuddyPwaApp.tsx']) {
      const file = await import('node:fs').then((fs) => fs.readFileSync(new URL(source, import.meta.url), 'utf8'));
      const offenders = file
        .split('\n')
        .filter((line) => /text-bronze|bg-bronze/.test(line) && !/aria-hidden="true"/.test(line));
      expect(offenders).toEqual([]);
    }
  });

  it('keeps the bronze accent usable for large text only, and never for body copy', () => {
    const bronzeOnIvory = contrast(token('bronze.DEFAULT'), token('ivory'));
    expect(bronzeOnIvory).toBeLessThan(4.5);
    // Decorative icons (aria-hidden) are exempt, and that is the only remaining use.
  });
});

let host: HTMLDivElement;
let root: Root | null = null;

async function settle() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
}

async function renderSurface(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(element); });
  await settle();
  return host;
}

function accessibleName(element: Element): string {
  const label = element.getAttribute('aria-label') || '';
  const labelledBy = element.getAttribute('aria-labelledby');
  const referenced = labelledBy ? document.getElementById(labelledBy)?.textContent || '' : '';
  return `${label} ${referenced} ${element.textContent || ''}`.trim();
}

function interactiveElements(scope: HTMLElement): Element[] {
  return Array.from(scope.querySelectorAll('button, a[href], input, select, textarea'));
}

function auditSurface(scope: HTMLElement, name: string) {
  const controls = interactiveElements(scope);
  expect(controls.length, `${name} should render controls`).toBeGreaterThan(0);
  for (const control of controls) {
    // 1. every control has an accessible name
    const label = control.id ? document.querySelector(`label[for="${control.id}"]`)?.textContent : '';
    expect(
      `${accessibleName(control)} ${label || ''}`.trim().length,
      `${name}: ${control.tagName} <${control.textContent?.slice(0, 30)}> needs an accessible name`,
    ).toBeGreaterThan(0);

    // 2. buttons declare an explicit type (no accidental form submits)
    if (control.tagName === 'BUTTON') expect(control.getAttribute('type')).toBeTruthy();

    // 3. nothing is hover-only: controls are real, focusable elements
    expect(control.getAttribute('tabindex')).not.toBe('-1');
  }

  // 4. 44px targets on the primary actions
  const buttons = Array.from(scope.querySelectorAll('button'));
  for (const button of buttons) {
    expect(button.className, `${name}: button needs a 44px minimum height`).toContain('min-h-11');
  }

  // 5. visible focus styling on every control
  for (const control of controls) {
    expect(control.className, `${name}: control needs visible focus styling`).toContain('focus-visible:outline');
  }

  // 6. status changes are announced politely
  expect(scope.querySelectorAll('[aria-live="polite"]').length, `${name} should announce status`).toBeGreaterThan(0);
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue({
    data: {
      ok: true, public_key: 'A'.repeat(87), subject: 'mailto:owner@lixxonstudio.com',
      private_key_configured: true, keys_ready: true, push_enabled: false,
    },
    error: null,
  });
  mocks.order.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('Phase 5 surfaces are keyboard and mobile accessible', () => {
  it('audits the push opt-in panel', async () => {
    const page = await renderSurface(<PushNotificationsPanel />);
    auditSurface(page, 'push panel');
  });

  it('audits the Buddy surface', async () => {
    const page = await renderSurface(<BuddyPwaApp />);
    auditSurface(page, 'Buddy');
  });
});
