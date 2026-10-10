// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { automationHealthFixture, HEALTH_TEST_SECRET } from './fixtures/automationHealth';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

import AutomationCheck from '../admin/pages/AutomationCheck';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  return host;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  mocks.getSession.mockReset();
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'signed-in-owner-token' } }, error: null });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(automationHealthFixture()), { status: 200 })));
});

describe('Automation System Check page', () => {
  it('requests the same-origin API with the signed-in session and renders only allow-listed health data', async () => {
    const el = mount();
    await act(async () => { root.render(<AutomationCheck />); await Promise.resolve(); });
    await settle();

    expect(el.textContent).toContain('Check');
    expect(el.textContent).toContain('Database updates');
    expect(el.textContent).toContain('No AI keys are saved.');
    expect(el.textContent).toContain('Distribution is off; channel connectivity is not yet configured.');
    expect(el.textContent).toContain('Video making is paused. The stock video key is not saved, and the video tool and Android playback have not been checked. Keep video upload off; the manual Daily Kit remains available.');
    expect(el.textContent).not.toContain(HEALTH_TEST_SECRET);
    expect(fetch).toHaveBeenCalledWith('/api/automation/health', expect.objectContaining({
      method: 'GET', cache: 'no-store',
      headers: { Authorization: 'Bearer signed-in-owner-token', Accept: 'application/json' },
    }));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    const refresh = Array.from(el.querySelectorAll('button')).find(button => button.textContent?.includes('Refresh checks'));
    await act(async () => { refresh?.click(); await Promise.resolve(); });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shows a safe authorization denial without provider or database response text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(HEALTH_TEST_SECRET, { status: 403 })));
    const el = mount();
    await act(async () => { root.render(<AutomationCheck />); await Promise.resolve(); });
    await settle();
    expect(el.textContent).toContain('not allowed to see this check');
    expect(el.textContent).not.toContain(HEALTH_TEST_SECRET);
  });
});
