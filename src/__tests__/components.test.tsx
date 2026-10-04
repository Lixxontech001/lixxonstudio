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
  const access = (over: Partial<import('../context/AuthContext').AdminAccess> = {}) => ({
    user_id: 'u1', email: 'a@b.c', role: 'editor', role_label: 'Editor', display_name: null,
    status: 'active' as const, is_founder: false, is_owner: false, mfa_enrolled: false,
    permissions: ['content.read', 'content.write', 'content.moderate'],
    ...over,
  });

  it('gates routes from the database permission list, not the role name', async () => {
    const { canAccess } = await import('../admin/permissions');
    expect(canAccess(access({ role: 'owner', is_owner: true, permissions: [] }), 'admin-team')).toBe(true);
    expect(canAccess(access({ role: 'owner', is_owner: true, permissions: [] }), 'admin-data')).toBe(true);
    expect(canAccess(access(), 'admin-team')).toBe(false);
    expect(canAccess(access(), 'admin-orders')).toBe(false);
    expect(canAccess(access({ permissions: ['content.read'] }), 'admin-dashboard')).toBe(true);
    expect(canAccess(access({ permissions: ['content.read'] }), 'admin-comments')).toBe(false);
    expect(canAccess(access({ permissions: ['content.moderate'] }), 'admin-comments')).toBe(true);
    expect(canAccess(access({ permissions: ['commerce.read'] }), 'admin-orders')).toBe(true);
    expect(canAccess(access({ is_founder: true, role: 'owner', permissions: [] }), 'admin-backups')).toBe(true);
  });

  it('refuses suspended admins and signed-out visitors', async () => {
    const { canAccess } = await import('../admin/permissions');
    expect(canAccess(access({ status: 'suspended' }), 'admin-comments')).toBe(false);
    expect(canAccess(null, 'admin-comments')).toBe(false);
    expect(canAccess(null, 'admin-login')).toBe(true);
    expect(canAccess(null, 'home')).toBe(true);
  });

  it('mirrors the live 2FA screen for any active admin', async () => {
    const { canAccess } = await import('../admin/permissions');
    expect(canAccess(access({ permissions: [] }), 'admin-security')).toBe(true);
  });
});

describe('Front-end configuration', () => {
  it('sanitises the custom head block', async () => {
    const { sanitizeHeadHtml } = await import('../hooks/useSiteConfig');
    const dirty = '<meta name="x" content="1"><script>alert(1)</script><link rel="stylesheet" href="//evil"><div onclick="steal()">hi</div>';
    const clean = sanitizeHeadHtml(dirty);
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/<link/i);
    expect(clean).toContain('hi');
  });

  it('matches exact and prefix redirects', async () => {
    const { matchRedirect } = await import('../hooks/useSiteConfig');
    const config = { redirects: { rules: [{ from: '/old', to: '/new', permanent: true }, { from: '/shop/*', to: '/store', enabled: true }] } };
    expect(matchRedirect(config, '/old')).toEqual({ to: '/new', permanent: true });
    expect(matchRedirect(config, '/shop/bag')).toEqual({ to: '/store/bag', permanent: false });
    expect(matchRedirect(config, '/nothing')).toBeNull();
  });

  it('falls back to the shipped homepage order', async () => {
    const { enabledSections } = await import('../hooks/useSiteConfig');
    expect(enabledSections({})[0]).toBe('hero');
    expect(enabledSections({ homepage: { sections: [{ id: 'shop', enabled: true }, { id: 'hero', enabled: false }] } })).toEqual(['shop']);
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
