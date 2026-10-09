// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseKeyStatus, parseThinkReply } from '../buddy/buddyThinkResult';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import BuddyThinkCheck from '../buddy/BuddyThinkCheck';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

async function settle() {
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
}

async function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(<BuddyThinkCheck />); });
  await settle();
  return host;
}

function buttonByText(text: string) {
  return Array.from(host.querySelectorAll('button')).find((button) => (button.textContent || '').includes(text));
}

beforeEach(() => {
  mocks.invoke.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe('Buddy thinking check', () => {
  it('says plainly when no Google key is saved and offers no test button', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, action: 'status', configured: false }, error: null });
    const el = await render();
    expect(el.textContent).toContain('no Google key is saved');
    expect(buttonByText('Ask Buddy')).toBeUndefined();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith('buddy-think', { body: { action: 'status' } });
  });

  it('shows the model reply from a real probe when a key is saved', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { ok: true, action: 'status', configured: true }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, action: 'probe', model: 'gemini-3.8-flash', reply: 'Yes, I can think.', can_think: true }, error: null });
    const el = await render();
    await act(async () => { buttonByText('Ask Buddy a test question')?.click(); });
    await settle();
    expect(el.textContent).toContain('Yes, I can think.');
    expect(el.textContent).toContain('Buddy can think: yes.');
    expect(mocks.invoke).toHaveBeenLastCalledWith('buddy-think', { body: { action: 'probe' } });
  });

  it('shows the honest failure message and never a made-up reply', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { ok: true, action: 'status', configured: true }, error: null })
      .mockResolvedValueOnce({ data: { ok: false, action: 'probe', reason: 'rejected', message: 'Google rejected the saved key.', can_think: false }, error: null });
    const el = await render();
    await act(async () => { buttonByText('Ask Buddy a test question')?.click(); });
    await settle();
    expect(el.textContent).toContain('Google rejected the saved key.');
    expect(el.textContent).toContain('Buddy can think: no.');
    expect(el.textContent).not.toContain('Buddy says');
  });

  it('says Buddy could not be reached when the function call fails', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: null, error: new Error('network') });
    const el = await render();
    expect(el.textContent).toContain('could not check its key');
  });
});

describe('Buddy thinking response parsing', () => {
  it('accepts only well-formed answers', () => {
    expect(parseKeyStatus({ ok: true, configured: true })).toBe(true);
    expect(parseKeyStatus({ ok: true, configured: 'yes' })).toBeNull();
    expect(parseKeyStatus(null)).toBeNull();
    expect(parseThinkReply({ ok: true, reply: '   ' })).toBeNull();
    expect(parseThinkReply({ ok: true, reply: 'Hi', model: 'm', can_think: true })).toEqual({ ok: true, reply: 'Hi', model: 'm', canThink: true });
    expect(parseThinkReply({ ok: false, reason: 'rejected' })).toBeNull();
  });
});
