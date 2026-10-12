// Phase H slice 1: the Guide page renders, and Keys, Brains and Connections each carry the in-place help and
// the link into the guide at the right anchor. Fake Supabase only: no network, no keys, no live call.
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUIDE_LINK_LABEL, GUIDE_PATH } from '../admin/lib/guide';
import { GUIDE_SECTIONS } from '../admin/lib/guideSections';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), can: vi.fn(() => true) }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ can: mocks.can, session: null }) }));

import AdminGuide from '../admin/pages/AdminGuide';
import AdminConnections from '../admin/pages/AdminConnections';
import AutomationBrains from '../admin/pages/AutomationBrains';
import AutomationKeys from '../admin/pages/AutomationKeys';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

async function render(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(element);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

/** The guide loads its steps when it opens, so the first section arrives a moment later. */
async function waitForSections(el: HTMLElement) {
  for (let tries = 0; tries < 20 && !el.querySelector('article[id]'); tries += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  return el;
}

function guideLinks(el: HTMLElement) {
  return Array.from(el.querySelectorAll('a')).filter((link) => link.textContent === GUIDE_LINK_LABEL);
}

function keyRow(name: string, label: string, category = 'actions', configured = true) {
  return {
    name, label, category, credential_type: 'secret', purpose: 'A saved credential.',
    required: false, configured, last_test_status: 'ok', last_tested_at: null,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.can.mockReturnValue(true);
  window.history.replaceState({}, '', '/admin/guide');
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
});

describe('the Guide page', () => {
  it('draws one addressable section per owner action, including gemini, vapid and takeover', async () => {
    const el = await waitForSections(await render(<AdminGuide />));
    for (const section of GUIDE_SECTIONS) {
      expect(el.querySelector(`#${section.id}`), section.id).not.toBeNull();
    }
    const ids = Array.from(el.querySelectorAll('article[id]')).map((article) => article.id);
    expect(ids).toEqual(GUIDE_SECTIONS.map((section) => section.id));
    expect(el.querySelector('#gemini')?.textContent).toContain('aistudio.google.com');
    expect(el.querySelector('#vapid')?.textContent).toContain('Register this device');
    expect(el.querySelector('#takeover')?.textContent).toMatch(/off by default/i);
  });

  it('Back returns to the page and field the owner came from', async () => {
    window.history.replaceState({}, '', '/admin/guide?back=%2Fadmin%2Fautomation%2Fkeys%23vapid-subject#vapid');
    const el = await render(<AdminGuide />);
    const back = Array.from(el.querySelectorAll('a')).filter((link) => link.textContent?.includes('Back to where I was'));
    expect(back).toHaveLength(1);
    expect(back[0].getAttribute('href')).toBe('/admin/automation/keys#vapid-subject');
  });

  it('an unsafe way back in the address is ignored, and Back goes to Keys', async () => {
    window.history.replaceState({}, '', '/admin/guide?back=javascript%3Aalert%281%29');
    const el = await render(<AdminGuide />);
    const back = Array.from(el.querySelectorAll('a')).find((link) => link.textContent?.includes('Back to where I was'));
    expect(back?.getAttribute('href')).toBe('/admin/automation/keys');
  });

  it('the guide shows no engine words and no country, city or currency names', async () => {
    const el = await waitForSections(await render(<AdminGuide />));
    const text = el.textContent ?? '';
    expect(text).not.toMatch(/vault|\brpc\b|postgres|\boauth\b|\bjwt\b|\brls\b|supabase/i);
    expect(text).not.toMatch(/nigeria|lagos|naira|\bwat\b/i);
    expect(text).not.toContain('\u2014');
  });

  it('every section heading is on the page and can be opened by address', async () => {
    const el = await waitForSections(await render(<AdminGuide />));
    const headings = Array.from(el.querySelectorAll('article h3')).map((h) => h.textContent);
    expect(headings).toEqual(GUIDE_SECTIONS.map((section) => section.title));
  });
});

describe('the in-place help on Keys, Brains and Connections', () => {
  it('Keys carries the guide link for the page, each save box, Test and Delete', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'automation_list_secrets'
        ? {
          data: [
            keyRow('resend_api_key', 'Resend API key', 'email', true),
            keyRow('flutterwave_secret_key', 'Flutterwave secret key', 'commerce', false),
          ],
          error: null,
        }
        : { data: true, error: null }
    ));
    const el = await render(<AutomationKeys />);

    const links = guideLinks(el);
    const hrefs = links.map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.some((href) => href.startsWith(GUIDE_PATH) && href.endsWith('#keys'))).toBe(true);
    expect(hrefs.some((href) => href.includes('#save-key'))).toBe(true);
    expect(hrefs.some((href) => href.includes('#test-key'))).toBe(true);
    expect(hrefs.some((href) => href.includes('#delete-key'))).toBe(true);
    expect(hrefs.some((href) => href.includes('#vapid'))).toBe(true);
    // Each link remembers the page and the field it came from.
    const saveLink = links.find((link) => link.getAttribute('href')?.includes('#save-key'));
    expect(decodeURIComponent(saveLink?.getAttribute('href') ?? ''))
      .toMatch(/\/admin\/automation\/keys#automation-key(-replace)?-/);
    // The sentences that belong to the actions are shown next to them, not only on the guide page.
    expect(el.textContent).toContain('Paste a key once and press Save. It is never shown again after that.');
    expect(el.textContent).toContain('Saved. It cannot be shown, and it does not need to be typed again.');
  });

  it('Brains carries the guide link for each brain, back to that key box', async () => {
    mocks.rpc.mockImplementation(async () => ({ data: [], error: null }));
    const el = await render(<AutomationBrains />);

    const links = guideLinks(el);
    const hrefs = links.map((link) => link.getAttribute('href') ?? '');
    expect(hrefs).toHaveLength(8);
    expect(hrefs.some((href) => href.includes('#gemini'))).toBe(true);
    expect(hrefs.some((href) => href.includes('#deepseek'))).toBe(true);
    const gemini = links.find((link) => link.getAttribute('href')?.includes('#gemini'));
    expect(decodeURIComponent(gemini?.getAttribute('href') ?? ''))
      .toContain('/admin/automation/brains#brain-key-gemini_api_key');
    expect(el.textContent).toContain('Get a free key at aistudio.google.com. Paste once. It is never shown again. Test does not publish.');
    expect(el.querySelector('#brain-key-gemini_api_key')).not.toBeNull();
  });

  it('Connections carries the guide link for the page and for each place, back to that place', async () => {
    mocks.rpc.mockImplementation(async () => ({ data: [], error: null }));
    const el = await render(<AdminConnections />);

    const links = guideLinks(el);
    const hrefs = links.map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.some((href) => href.startsWith(GUIDE_PATH) && href.endsWith('#connections'))).toBe(true);
    expect(hrefs.some((href) => href.includes('#door-telegram'))).toBe(true);
    expect(hrefs.some((href) => href.includes('#door-smartnews'))).toBe(true);
    const telegram = links.find((link) => link.getAttribute('href')?.includes('#door-telegram'));
    expect(decodeURIComponent(telegram?.getAttribute('href') ?? ''))
      .toContain('/admin/ai/connections#door-telegram');
  });
});
