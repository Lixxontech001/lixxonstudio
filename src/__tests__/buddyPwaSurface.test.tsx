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
    can: (permission: string) => permission === 'automation.check' || permission === 'automation.manage',
  }),
}));
vi.mock('../admin/MfaGate', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }));

import BuddyPwaApp from '../buddy/BuddyPwaApp';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

async function settle() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((button) => (button.textContent || '').includes(text));
}

async function typeAndSubmit(command: string) {
  const input = host.querySelector<HTMLInputElement>('#buddy-command');
  if (!input) throw new Error('Buddy command input is missing');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, command);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  const submit = buttonByText('Save as draft');
  await act(async () => { submit?.click(); });
  await settle();
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

async function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(<BuddyPwaApp />); });
  await settle();
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.clearAllMocks();
  setOnline(true);
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'automation_feature_flags') return { data: { 'automation.enabled': true, 'automation.daily_pipeline': true }, error: null };
    if (name === 'admin_me') return { data: { status: 'active', email: 'owner@lixxonstudio.com' }, error: null };
    if (name === 'automation_set_feature_flag') return { data: true, error: null };
    return { data: null, error: null };
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('Buddy safe PWA surface', () => {
  it('renders a typed draft queue and explains the offline boundary and publishing block', async () => {
    const page = await render();
    const markup = page.innerHTML;
    expect(markup).toContain('Typed command queue');
    expect(markup).toContain('Nothing runs automatically');
    expect(markup).toContain('a first launch with no network is not guaranteed');
    expect(markup).toContain('Publishing is not available through Buddy');
    expect(markup).toContain('grant admin access');
    expect(markup).toContain('/admin/automation/distribution');
  });

  it('previews live state and only changes it after an explicit confirmation', async () => {
    const page = await render();
    await typeAndSubmit('pause automation');
    expect(page.textContent).toContain('Pause or resume the 08:00 Lagos daily schedule');
    expect(page.textContent).toContain('never auto-runs');

    // Reconnecting must not execute the draft.
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await settle();
    expect(mocks.rpc).not.toHaveBeenCalledWith('automation_set_feature_flag', expect.anything());

    await act(async () => { buttonByText('Preview live state')?.click(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('automation_feature_flags');
    expect(page.textContent).toContain('currently on');
    expect(page.textContent).toContain('08:00 Lagos daily schedule: on → off');
    expect(page.textContent).toContain('publishes nothing');
    // Preview alone changes nothing.
    expect(mocks.rpc).not.toHaveBeenCalledWith('automation_set_feature_flag', expect.anything());

    await act(async () => { buttonByText('Confirm: turn it off')?.click(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith('automation_set_feature_flag', {
      p_flag_key: 'automation.daily_pipeline',
      p_enabled: false,
    });
    expect(page.textContent).toContain('now off');
    // The confirmed draft is removed and the confirm button is gone.
    expect(page.textContent).toContain('No drafts are queued');
    expect(buttonByText('Confirm: turn it off')).toBeUndefined();
  });

  it('refuses a stale preview instead of applying it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_feature_flags') return { data: { 'automation.enabled': true, 'automation.daily_pipeline': false }, error: null };
      if (name === 'automation_set_feature_flag') return { data: true, error: null };
      return { data: null, error: null };
    });
    const page = await render();
    await typeAndSubmit('resume automation');
    await act(async () => { buttonByText('Preview live state')?.click(); });
    await settle();
    expect(page.textContent).toContain('Confirm: turn it on');

    // Three minutes later the two-minute preview is stale.
    vi.setSystemTime(new Date('2026-10-06T12:03:00.000Z'));
    await act(async () => { buttonByText('Confirm: turn it on')?.click(); });
    await settle();
    expect(mocks.rpc).not.toHaveBeenCalledWith('automation_set_feature_flag', expect.anything());
    expect(page.textContent).toContain('expired');
    // The refusal keeps the draft: nothing was applied and nothing was lost.
    expect(page.textContent).toContain('Drafts needing review');
    expect(page.textContent).toContain('Resume the daily schedule');
    expect(buttonByText('Confirm: turn it on')).toBeUndefined();
  });

  it('refuses to preview or run anything while offline', async () => {
    setOnline(false);
    const page = await render();
    await typeAndSubmit('pause automation');
    expect(buttonByText('Preview live state')?.disabled).toBe(true);
    await act(async () => { buttonByText('Preview live state')?.click(); });
    await settle();
    // The draft stays queued, but nothing was read, previewed or changed.
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(page.textContent).not.toContain('Live preview');
    expect(page.textContent).toContain('never auto-runs');
  });

  it('keeps read-only drafts free of any state-changing call', async () => {
    const page = await render();
    await typeAndSubmit('status');
    await act(async () => { buttonByText('Preview live state')?.click(); });
    await settle();
    expect(page.textContent).toContain('no external action');
    await act(async () => { buttonByText('Continue (read-only)')?.click(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_me');
    expect(mocks.rpc).not.toHaveBeenCalledWith('automation_set_feature_flag', expect.anything());
  });

  it('blocks a publishing request before it can become a draft', async () => {
    const page = await render();
    await typeAndSubmit('publish the post');
    expect(page.textContent).toContain('no publishing operation at all');
    expect(page.textContent).toContain('No drafts are queued');
    expect(localStorage.getItem('lixxon.buddy.safe-queue.v1')).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
