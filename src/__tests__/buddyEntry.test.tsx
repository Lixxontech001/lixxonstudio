// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

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
vi.mock('../lib/supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }));

import BuddyEntry from '../buddy/BuddyEntry';
import { isBuddyControlsPath } from '../buddy/buddyPaths';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

async function renderAt(pathname: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(<BuddyEntry pathname={pathname} />); });
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
  return host;
}

beforeEach(() => {
  mocks.rpc.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe('Buddy entry routing', () => {
  it('recognises the controls path, with or without a trailing slash or query', () => {
    expect(isBuddyControlsPath('/buddy/controls')).toBe(true);
    expect(isBuddyControlsPath('/buddy/controls/')).toBe(true);
    expect(isBuddyControlsPath('/buddy/controls?source=x')).toBe(true);
    expect(isBuddyControlsPath('/buddy')).toBe(false);
    expect(isBuddyControlsPath('/buddy/chat')).toBe(false);
  });

  it('shows the placeholder at /buddy and makes no data calls', async () => {
    const el = await renderAt('/buddy');
    expect(el.textContent).toContain('Buddy is being rebuilt as a private chat');
    expect(el.querySelector('a[href="/buddy/controls"]')).not.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps the old typed-command screen reachable at /buddy/controls', async () => {
    const el = await renderAt('/buddy/controls');
    expect(el.querySelector('#buddy-command')).not.toBeNull();
    expect(el.textContent).not.toContain('being rebuilt');
  });
});
