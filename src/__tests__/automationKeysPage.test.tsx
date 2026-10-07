// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
  },
}));

import AutomationKeys from '../admin/pages/AutomationKeys';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const FAKE_KEY = 'FAKE-AUTOMATION-KEY-NOT-FOR-STORAGE';
const REPLACEMENT_KEY = 'FAKE-REPLACEMENT-KEY-NOT-FOR-STORAGE';

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
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  window.confirm = vi.fn(() => true);
});

describe('Automation Keys page', () => {
  it('clears entered values after save and tests by key name only', async () => {
    let configured = false;
    let lastStatus = 'not_tested';
    let nextTestStatus = 'ok';
    const savedValues: string[] = [];
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'automation_list_secrets') {
        return {
          data: [{
            name: 'openai_api_key', label: 'OpenAI API key', category: 'ai',
            credential_type: 'secret', purpose: 'AI route', required: false, configured,
            last_test_status: lastStatus, last_tested_at: null,
          }],
          error: null,
        };
      }
      if (name === 'automation_secret_save') {
        savedValues.push(String(args?.p_secret_value || ''));
        configured = true;
        lastStatus = 'not_tested';
        return { data: { ok: true }, error: null };
      }
      if (name === 'automation_secret_delete') {
        configured = false;
        lastStatus = 'not_tested';
        return { data: true, error: null };
      }
      if (name === 'test_automation_secret') {
        lastStatus = String(args?.p_result || 'not_tested');
        return { data: { status: lastStatus }, error: null };
      }
      return { data: true, error: null };
    });
    mocks.invoke.mockImplementation(async () => {
      lastStatus = nextTestStatus;
      return {
        data: { name: 'openai_api_key', status: nextTestStatus, message: `raw ${FAKE_KEY}` },
        error: null,
      };
    });

    const el = mount();
    await act(async () => { root.render(<AutomationKeys />); await Promise.resolve(); });
    await settle();

    const input = el.querySelector<HTMLInputElement>('#automation-key-openai_api_key');
    expect(input).not.toBeNull();
    expect(input?.type).toBe('password');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    expect(setter).toBeDefined();
    act(() => {
      setter!.call(input, FAKE_KEY);
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input?.value).toBe(FAKE_KEY);

    const saveButton = Array.from(el.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Save');
    expect(saveButton).toBeDefined();
    await act(async () => { saveButton!.click(); await Promise.resolve(); });
    await settle();

    expect(input?.value).toBe('');
    expect(el.textContent).not.toContain(FAKE_KEY);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    const testButton = Array.from(el.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === 'Test OpenAI API key');
    expect(testButton).toBeDefined();
    await act(async () => { testButton!.click(); await Promise.resolve(); });
    await settle();
    expect(mocks.invoke).toHaveBeenCalledWith('automation-keys', {
      body: { action: 'test', name: 'openai_api_key' },
    });
    expect(el.textContent).not.toContain(FAKE_KEY);
    expect(el.textContent).toContain('A read-only provider request succeeded.');

    nextTestStatus = 'invalid';
    await act(async () => { testButton!.click(); await Promise.resolve(); });
    await settle();
    expect(el.textContent).toContain('The provider rejected this credential or a required scope.');
    expect(el.textContent).not.toContain(FAKE_KEY);

    act(() => {
      setter!.call(input, REPLACEMENT_KEY);
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const replaceButton = Array.from(el.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Replace');
    expect(replaceButton).toBeDefined();
    await act(async () => { replaceButton!.click(); await Promise.resolve(); });
    await settle();
    expect(window.confirm).toHaveBeenCalledWith('Replace the stored OpenAI API key? The current Vault value will be permanently replaced.');
    expect(savedValues).toEqual([FAKE_KEY, REPLACEMENT_KEY]);
    expect(input?.value).toBe('');
    expect(el.textContent).not.toContain(REPLACEMENT_KEY);

    const deleteButton = Array.from(el.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === 'Delete OpenAI API key');
    expect(deleteButton).toBeDefined();
    await act(async () => { deleteButton!.click(); await Promise.resolve(); });
    await settle();
    expect(window.confirm).toHaveBeenCalledWith('Permanently delete the stored OpenAI API key from Supabase Vault?');
    expect(el.textContent).toContain('Not configured');
    expect(el.textContent).not.toContain(FAKE_KEY);
    expect(el.textContent).not.toContain(REPLACEMENT_KEY);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('generates a VAPID pair without returning the private key', async () => {
    let generated = false;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'automation_list_secrets') {
        return {
          data: [
            { name: 'vapid_private_key', label: 'Web Push VAPID private key', category: 'push', credential_type: 'secret', purpose: 'Private', required: false, configured: generated, last_test_status: 'not_tested', last_tested_at: null },
            { name: 'vapid_public_key', label: 'Web Push VAPID public key', category: 'push', credential_type: 'public_key', purpose: 'Public', required: false, configured: generated, last_test_status: 'not_tested', last_tested_at: null },
            { name: 'vapid_subject', label: 'Web Push contact subject', category: 'push', credential_type: 'identifier', purpose: 'Contact', required: false, configured: generated, last_test_status: 'not_tested', last_tested_at: null },
          ],
          error: null,
        };
      }
      return { data: true, error: null };
    });
    mocks.invoke.mockImplementation(async (_name: string, args?: { body?: { action?: string; subject?: string; replace?: boolean } }) => {
      expect(args?.body).toEqual({ action: 'generate_vapid', subject: 'mailto:owner@lixxonstudio.com', replace: true });
      generated = true;
      return {
        data: { action: 'generate_vapid', public_key: 'PUBLIC-KEY-ONLY', subject: 'mailto:owner@lixxonstudio.com' },
        error: null,
      };
    });

    const el = mount();
    await act(async () => { root.render(<AutomationKeys />); await Promise.resolve(); });
    await settle();

    const generateButton = Array.from(el.querySelectorAll('button')).find(button => button.textContent?.includes('Generate VAPID keypair'));
    expect(generateButton).toBeDefined();
    await act(async () => { generateButton!.click(); await Promise.resolve(); });
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith('automation-keys', {
      body: { action: 'generate_vapid', subject: 'mailto:owner@lixxonstudio.com', replace: true },
    });
    expect(el.querySelector<HTMLInputElement>('#generated-vapid-public-key')?.value).toBe('PUBLIC-KEY-ONLY');
    expect(el.textContent).toContain('The private key went straight to Vault and was never returned to this page.');
    expect(el.textContent).not.toContain('private_key');
  });
});
