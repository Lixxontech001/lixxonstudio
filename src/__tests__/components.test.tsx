// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- minimal Supabase mock: every query resolves to an empty result
vi.mock('../lib/supabaseClient', () => {
  // Proxy-based query builder: any method chains, awaiting resolves to an empty result
  const chain = (): unknown => new Proxy(() => undefined, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res);
      if (prop === 'catch' || prop === 'finally') return () => chain();
      return () => chain();
    },
  });
  return {
    supabaseConfigured: true,
    supabaseConfigError: '',
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon-key',
    rows: (d: unknown) => (d || []) as unknown[],
    supabase: {
      from: () => chain(),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => undefined,
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getUser: () => Promise.resolve({ data: { user: null } }),
      },
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    },
  };
});

let root: Root; let host: HTMLDivElement;
function mount(node: ReactNode) {
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root.render(node); });
  return host;
}
beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

describe('CookieConsent', () => {
  it('shows after delay and gates analytics on Accept', async () => {
    vi.useFakeTimers();
    const { default: CookieConsent } = await import('../components/CookieConsent');
    const { NavigationProvider } = await import('../context/NavigationContext');
    const el = mount(<NavigationProvider><CookieConsent /></NavigationProvider>);
    expect(el.textContent).not.toMatch(/Accept/);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(el.textContent).toMatch(/Accept/);
    const fired = vi.fn(); window.addEventListener('lixxon:consent', fired);
    const accept = Array.from(el.querySelectorAll('button')).find(b => /accept/i.test(b.textContent || ''))!;
    act(() => { accept.click(); });
    expect(localStorage.getItem('lixxon_cookie_consent')).toBe('accepted');
    expect(fired).toHaveBeenCalled();
    expect(el.textContent).not.toMatch(/Accept/);
    vi.useRealTimers();
  });
});

describe('useFocusTrap', () => {
  it('keeps Tab inside the container and calls onClose on Escape', async () => {
    const { useFocusTrap } = await import('../hooks/useFocusTrap');
    const onClose = vi.fn();
    function Drawer() {
      const ref = useFocusTrap<HTMLDivElement>(true, onClose);
      return <div ref={ref} tabIndex={-1}><button id="a">A</button><button id="b">B</button></div>;
    }
    const el = mount(<Drawer />);
    const a = el.querySelector<HTMLButtonElement>('#a')!, b = el.querySelector<HTMLButtonElement>('#b')!;
    expect(document.activeElement).toBe(a);
    b.focus();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
    expect(document.activeElement).toBe(a);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); });
    expect(document.activeElement).toBe(b);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Admin permissions', () => {
  it('restricts routes by role', async () => {
    const { canAccess } = await import('../admin/permissions');
    expect(canAccess('owner', 'admin-team')).toBe(true);
    expect(canAccess('editor', 'admin-team')).toBe(false);
    expect(canAccess('moderator', 'admin-comments')).toBe(true);
    expect(canAccess('moderator', 'admin-orders')).toBe(false);
    expect(canAccess('editor', 'admin-articles')).toBe(true);
  });
});

describe('App shell', () => {
  it('renders the home page without crashing when the API returns nothing', async () => {
    window.history.pushState({}, '', '/');
    const { default: App } = await import('../App');
    const { NavigationProvider } = await import('../context/NavigationContext');
    const el = mount(<NavigationProvider><App /></NavigationProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(el.querySelector('header')).toBeTruthy();
    expect(el.querySelector('footer')).toBeTruthy();
    expect(el.textContent).not.toMatch(/Something went wrong/i);
  });
});
