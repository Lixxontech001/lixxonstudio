// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vercelJson from '../../vercel.json?raw';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), from: vi.fn() }));

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
vi.mock('../lib/supabaseClient', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from, functions: { invoke: mocks.invoke } } }));

import BuddyEntry, { BUDDY_HOME_PATH } from '../buddy/BuddyEntry';
import { isBuddyControlsPath } from '../buddy/buddyPaths';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

async function renderAt(pathname: string, redirect?: (path: string) => void) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<BuddyEntry pathname={pathname} redirect={redirect} />);
  });
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
  return host;
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue({ data: { ok: true, action: 'status', configured: false }, error: null });
  mocks.from.mockReset();
  mocks.from.mockImplementation(() => {
    const result = { data: [], error: null };
    const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ['select', 'order', 'limit', 'eq', 'is', 'gt', 'in', 'maybeSingle', 'single']) chain[method] = () => chain;
    return chain;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe('Buddy entry routing', () => {
  it('recognises the old controls path, with or without a trailing slash or query', () => {
    expect(isBuddyControlsPath('/buddy/controls')).toBe(true);
    expect(isBuddyControlsPath('/buddy/controls/')).toBe(true);
    expect(isBuddyControlsPath('/buddy/controls?source=x')).toBe(true);
    expect(isBuddyControlsPath('/buddy')).toBe(false);
    expect(isBuddyControlsPath('/buddy/chat')).toBe(false);
  });

  it('shows Buddy’s greeting at /buddy, then the chat after Continue, with only the key-status and briefing calls and no direct table or RPC calls', async () => {
    const el = await renderAt('/buddy');
    expect(el.querySelector('[data-testid="buddy-greeting"]')).not.toBeNull();
    const continueButton = Array.from(el.querySelectorAll('button')).find((button) => button.textContent === 'Continue');
    await act(async () => {
      continueButton?.click();
    });
    await act(async () => {
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
    expect(el.textContent).toContain('Ask Buddy anything.');
    expect(el.textContent).toContain('New chat');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith('buddy-think', { body: { action: 'status' } });
    expect(mocks.invoke).toHaveBeenCalledWith('buddy-think', { body: expect.objectContaining({ action: 'briefing' }) });
    expect(mocks.invoke).not.toHaveBeenCalledWith('buddy-think', { body: { action: 'probe' } });
  });

  it('sends /buddy/controls to /buddy and never shows the old typed-command screen', async () => {
    const redirect = vi.fn();
    const el = await renderAt('/buddy/controls', redirect);
    expect(redirect).toHaveBeenCalledWith(BUDDY_HOME_PATH);
    expect(el.querySelector('#buddy-command')).toBeNull();
    expect(el.querySelector('input, textarea')).toBeNull();
    expect(el.textContent).toContain('Opening Buddy');
    expect(el.textContent).not.toContain('Typed command queue');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('is redirected by Vercel as well, so the old address never serves the old screen', () => {
    const vercelConfig = JSON.parse(vercelJson) as { redirects?: Array<{ source: string; destination: string; permanent: boolean }> };
    const redirects = vercelConfig.redirects ?? [];
    expect(redirects).toContainEqual({ source: '/buddy/controls', destination: '/buddy', permanent: false });
  });
});
