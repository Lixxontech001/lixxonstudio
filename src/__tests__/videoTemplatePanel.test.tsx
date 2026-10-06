// @vitest-environment jsdom
/**
 * V22 UI: the owner can change the look of a rendered video without a code deploy —
 * edit the essentials, save a new version, activate it, and copy the exact document the
 * render workflow takes as an input. A reviewer without the owner role sees it read-only.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIDEO_TEMPLATE } from '../../scripts/video-template.mjs';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), access: null as unknown, writeText: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ adminAccess: mocks.access, email: 'owner@example.com', session: { user: { email_confirmed_at: '2026-10-01T00:00:00.000Z' } } }),
}));

import AutomationDistribution from '../admin/pages/AutomationDistribution';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACTIVE_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = '66666666-7777-8888-9999-000000000000';
const defaultDocument = () => JSON.parse(JSON.stringify(DEFAULT_VIDEO_TEMPLATE));

function listFixture() {
  return {
    active_id: ACTIVE_ID,
    templates: [
      { id: ACTIVE_ID, name: DEFAULT_VIDEO_TEMPLATE.name, is_active: true, duration_seconds: 12, fps: 30, music: 'none', created_at: '2026-10-06T20:00:00.000Z' },
      { id: OTHER_ID, name: 'Evening contrast', is_active: false, duration_seconds: 20, fps: 25, music: 'none', created_at: '2026-10-06T21:00:00.000Z' },
    ],
    active_document: defaultDocument(),
  };
}

let host: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
}

function button(page: HTMLElement, label: string) {
  return Array.from(page.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === label);
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

async function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<AutomationDistribution />); });
  await settle();
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: mocks.writeText, readText: vi.fn(), write: vi.fn() }, configurable: true });
  mocks.access = { status: 'active', is_owner: true, is_founder: false, role: 'owner', permissions: ['automation.check', 'automation.manage'] };
  window.confirm = vi.fn(() => true);
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'automation_distribution_articles') return { data: { articles: [] }, error: null };
    if (name === 'automation_daily_kit_state') return { data: { post_id: ACTIVE_ID, lagos_day: '2026-10-06', is_today: true, video_url: null, marks: [] }, error: null };
    if (name === 'automation_video_templates') return { data: listFixture(), error: null };
    if (name === 'automation_save_video_template') return { data: listFixture(), error: null };
    if (name === 'automation_activate_video_template') return { data: listFixture(), error: null };
    if (name === 'automation_delete_video_template') return { data: { active_id: ACTIVE_ID, templates: [], active_document: defaultDocument() }, error: null };
    return { data: null, error: null };
  });
});

afterEach(() => {
  if (root) act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('video template panel', () => {
  it('shows the live look, its saved versions and the exact renderer document', async () => {
    const page = await render();
    expect(page.textContent).toContain('Video templates');
    expect(page.textContent).toContain(DEFAULT_VIDEO_TEMPLATE.name);
    expect(page.textContent).toContain('Evening contrast');
    expect(page.textContent).toContain('Live look');
    expect(page.textContent).toContain('20s · 25 fps · silent');
    const json = page.querySelector('#template-json') as HTMLTextAreaElement;
    expect(JSON.parse(json.value).schema).toBe('lixxon.video-template.v1');
    expect((page.querySelector('#template-name') as HTMLInputElement).value).toBe(DEFAULT_VIDEO_TEMPLATE.name);
  });

  it('saves the whole edited document and activates it on request', async () => {
    const page = await render();
    await act(async () => { setValue(page.querySelector('#template-name') as HTMLInputElement, 'Gap-slice evening contrast'); });
    await act(async () => { setValue(page.querySelector('#template-duration') as HTMLInputElement, '24'); });
    await settle();
    expect(page.textContent).toContain('24');
    await act(async () => { button(page, 'Save as new version')?.click(); });
    await settle();

    const call = mocks.rpc.mock.calls.find(entry => entry[0] === 'automation_save_video_template');
    expect(call).toBeTruthy();
    const args = call?.[1] as { p_document: Record<string, unknown>; p_activate: boolean };
    expect(args.p_activate).toBe(true);
    expect(args.p_document.name).toBe('Gap-slice evening contrast');
    expect(args.p_document.duration_seconds).toBe(24);
    // Every field the renderer needs travels with the save, unchanged unless edited.
    expect(args.p_document.movement).toEqual(DEFAULT_VIDEO_TEMPLATE.movement);
    expect(args.p_document.end_card).toEqual(DEFAULT_VIDEO_TEMPLATE.end_card);
    expect(args.p_document.watermark).toEqual(DEFAULT_VIDEO_TEMPLATE.watermark);
    expect(page.textContent).toContain('made it the live look');
  });

  it('copies the document so it can be pasted into the render workflow', async () => {
    const page = await render();
    await act(async () => { button(page, 'Copy template JSON')?.click(); });
    await settle();
    expect(mocks.writeText).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.writeText.mock.calls[0][0]).duration_seconds).toBe(12);
    expect(page.textContent).toContain('template_json');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('offers Activate and Delete only for an inactive template, and only to the owner', async () => {
    const page = await render();
    expect(button(page, 'Activate')).toBeTruthy();
    expect(button(page, 'Delete')).toBeTruthy();
    await act(async () => { button(page, 'Activate')?.click(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('automation_activate_video_template', { p_id: OTHER_ID });

    act(() => root.unmount());
    document.body.innerHTML = '';
    mocks.access = { status: 'active', is_owner: false, is_founder: false, role: 'editor', permissions: ['automation.check'] };
    const reviewer = await render();
    expect(reviewer.textContent).toContain(DEFAULT_VIDEO_TEMPLATE.name);
    expect(button(reviewer, 'Activate')).toBeUndefined();
    expect(button(reviewer, 'Delete')).toBeUndefined();
    expect(button(reviewer, 'Save as new version')).toBeUndefined();
    expect((reviewer.querySelector('#template-name') as HTMLInputElement).disabled).toBe(true);
  });
});
