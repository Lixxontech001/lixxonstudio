// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_LOOK } from '../lib/videoLook';

// Phase E slice 4: the Video look screen, rendered with a fake backend. Only the two existing template calls are made.
// No network, no database.

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }));

import AutomationVideoLook from '../admin/pages/AutomationVideoLook';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

/** The list the RPC returns, with the built-in look saved and active. */
function savedList(look = BUILT_IN_LOOK) {
  return {
    active_id: 'look-1',
    templates: [{ id: 'look-1', name: look.name, is_active: true, duration_seconds: look.duration_seconds, fps: look.fps, music: 'none', created_at: '2026-10-10T00:00:00Z' }],
    active_document: look,
  };
}

function setField(label: string, value: string) {
  const field = [...host.querySelectorAll('label')].find((item) => item.textContent?.includes(label))?.querySelector('input');
  if (!field) throw new Error(`no field ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function submit() {
  const form = host.querySelector('form');
  if (!form) throw new Error('no form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

beforeEach(async () => {
  mocks.rpc.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('the Video look screen', () => {
  it('reads the saved look through the existing list call and shows its values', async () => {
    mocks.rpc.mockResolvedValue({ data: savedList(), error: null });
    await act(async () => root.render(<AutomationVideoLook />));
    await flush();
    expect(mocks.rpc).toHaveBeenCalledWith('automation_video_templates');
    expect(host.textContent).toContain('12 seconds');
    expect(host.textContent).toContain('0xFFFFFF');
    expect(host.textContent).toContain('The daily video does not use this look yet');
  });

  it('a bad value shows the reason and makes no save call', async () => {
    mocks.rpc.mockResolvedValue({ data: savedList(), error: null });
    await act(async () => root.render(<AutomationVideoLook />));
    await flush();
    setField('Length in seconds', '99');
    await submit();
    expect(host.textContent).toContain('Length must be a whole number of seconds from 8 to 60.');
    expect(mocks.rpc.mock.calls.some((call) => call[0] === 'automation_save_video_template')).toBe(false);
  });

  it('a good value saves through the existing save call, activates it, and says the daily video does not use it yet', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_save_video_template') return { data: savedList({ ...BUILT_IN_LOOK, duration_seconds: 20 }), error: null };
      return { data: savedList(), error: null };
    });
    await act(async () => root.render(<AutomationVideoLook />));
    await flush();
    setField('Length in seconds', '20');
    await submit();
    const save = mocks.rpc.mock.calls.find((call) => call[0] === 'automation_save_video_template');
    expect(save).toBeTruthy();
    expect(save?.[1]).toMatchObject({ p_activate: true, p_document: { duration_seconds: 20, name: BUILT_IN_LOOK.name } });
    expect(host.textContent).toContain('Saved.');
    expect(host.textContent).toContain('The daily video does not use this look yet.');
  });

  it('a failed save says so in plain words and never shows the raw error', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_save_video_template') return { data: null, error: { message: 'forbidden: secret detail 42501' } };
      return { data: savedList(), error: null };
    });
    await act(async () => root.render(<AutomationVideoLook />));
    await flush();
    await submit();
    expect(host.textContent).toContain('Could not save this look. Nothing changed.');
    expect(host.textContent).not.toContain('secret detail');
  });

  it('a failed read says so in plain words and never shows the raw error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'relation automation_video_templates missing' } });
    await act(async () => root.render(<AutomationVideoLook />));
    await flush();
    expect(host.textContent).toContain('The saved look could not be read. Nothing was changed.');
    expect(host.textContent).not.toContain('relation');
  });

  it('with no saved look, the built-in look is shown and the screen says so', async () => {
    mocks.rpc.mockResolvedValue({ data: { active_id: null, templates: [], active_document: null }, error: null });
    await act(async () => root.render(<AutomationVideoLook />));
    await flush();
    expect(host.textContent).toContain('No look is saved yet. The built-in look is shown.');
    expect(host.textContent).toContain('12 seconds');
  });
});
