// Phase H slice 3: the Keys page, cleaned.
// Real parser, real page (mounted with a fake backend), real server copy. No network, no keys, no database.
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAIN_SLOTS } from '../../supabase/functions/_shared/brains';
import { NOT_OFFERED_KEY_NAMES, isNotOfferedKey } from '../../supabase/functions/_shared/notOfferedKeys';
import { PUSH_HELP_COPY } from '../../supabase/functions/_shared/notablePush';
import { AUTOMATION_KEY_CATEGORIES, parseAutomationKeyList } from '../lib/automationKeys';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));

import AutomationKeys, {
  REPLACE_BUTTON_LINE,
  REPLACE_SAVED_KEY_LINE,
  SAVED_KEY_LINE,
} from '../admin/pages/AutomationKeys';
import { withoutBrainKeys } from '../lib/brainRows';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const KEYS_PAGE = read('src/admin/pages/AutomationKeys.tsx');

let host: HTMLDivElement;
let root: Root | null = null;

const row = (name: string, label: string, category: string, configured = false) => ({
  name, label, category, credential_type: 'secret', purpose: 'A saved credential.',
  required: false, configured, last_test_status: 'ok', last_tested_at: null,
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AutomationKeys />);
  });
  await settle();
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  window.confirm = vi.fn(() => true);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe('the dead keys are never offered', () => {
  it('lists OpenAI and Anthropic, and the social rows with no leftover job', () => {
    for (const name of ['openai_api_key', 'anthropic_api_key', 'claude_api_key']) {
      expect(isNotOfferedKey(name), name).toBe(true);
    }
    for (const name of [
      'meta_app_secret', 'meta_access_token', 'facebook_page_id', 'threads_access_token',
      'tiktok_client_secret', 'tiktok_access_token', 'pinterest_access_token', 'pinterest_board_id',
      'linkedin_access_token', 'x_access_token', 'x_api_secret',
    ]) {
      expect(isNotOfferedKey(name), name).toBe(true);
    }
    // What is left has a job: the doors, the brains, the payments, the email, the alerts and the stock key.
    for (const name of [
      'flutterwave_secret_key', 'flutterwave_webhook_hash', 'resend_api_key', 'telegram_chat_id',
      'github_dispatch_token', 'coverr_api_key', 'vapid_private_key', 'vapid_public_key', 'vapid_subject',
      'gemini_api_key',
    ]) {
      expect(isNotOfferedKey(name), name).toBe(false);
    }
  });

  it('the list is a list of names only: no key-shaped value is written anywhere', () => {
    expect(NOT_OFFERED_KEY_NAMES.every((name) => /^[a-z][a-z0-9_]{1,63}$/.test(name))).toBe(true);
    expect(read('supabase/functions/_shared/notOfferedKeys.ts')).not.toMatch(/sk-|AIza|Bearer|eyJ/);
  });

  it('the parser drops every one of them, and keeps the real rows', () => {
    const rows = [
      row('openai_api_key', 'OpenAI API key', 'ai'),
      row('anthropic_api_key', 'Anthropic API key', 'ai'),
      row('meta_access_token', 'Meta access token', 'social'),
      row('linkedin_access_token', 'LinkedIn access token', 'social'),
      row('x_access_token', 'X access token', 'social'),
      row('whatsapp_access_token', 'WhatsApp Business access token', 'social'),
      row('resend_api_key', 'Resend API key', 'email', true),
      row('flutterwave_secret_key', 'Flutterwave secret key', 'commerce', true),
      row('gemini_api_key', 'Gemini API key', 'ai'),
    ];
    const parsed = parseAutomationKeyList(rows);
    expect(parsed).not.toBeNull();
    expect(parsed!.map((item) => item.name)).toEqual(['resend_api_key', 'flutterwave_secret_key', 'gemini_api_key']);
    // The Keys page then hides the brain rows, so nothing from the old AI group is left to show.
    expect(withoutBrainKeys(parsed!).map((item) => item.name)).toEqual(['resend_api_key', 'flutterwave_secret_key']);
  });

  it('every AI row the catalogue can hold is either a brain or a never-offered key', () => {
    const brainNames = new Set(BRAIN_SLOTS.map((slot) => slot.secretName));
    // The three AI names the catalogue has ever held, plus the brain names: nothing else is in that group.
    for (const name of ['openai_api_key', 'anthropic_api_key', 'gemini_api_key']) {
      expect(brainNames.has(name) || isNotOfferedKey(name), name).toBe(true);
    }
  });

  it('the matching migration turns the same names off, and says it is not applied', () => {
    const migration = read('supabase/migrations/20261020000000_retire_dead_keys.sql');
    for (const name of ['openai_api_key', 'anthropic_api_key', 'linkedin_access_token', 'x_access_token', 'tiktok_access_token']) {
      expect(migration, name).toContain(`'${name}'`);
    }
    expect(migration).toContain('SET enabled = false');
    expect(migration).toContain('NOT applied');
    // Nothing is deleted: a Vault value stays where it is until the owner removes it by hand.
    expect(migration).not.toMatch(/DELETE FROM/i);
    expect(migration).not.toMatch(/vault\./i);
  });
});

describe('the Keys page source', () => {
  it('names no dead provider, and pulls nothing from the deployment environment', () => {
    expect(KEYS_PAGE).not.toMatch(/openai/i);
    expect(KEYS_PAGE).not.toMatch(/anthropic/i);
    expect(KEYS_PAGE).not.toMatch(/process\.env|import\.meta\.env|VERCEL|vercel\.app/i);
    expect(KEYS_PAGE).not.toMatch(/fetch\(/);
  });

  it('keeps the categories it shows and reads a real row shape', () => {
    for (const category of AUTOMATION_KEY_CATEGORIES) expect(KEYS_PAGE).toContain(`${category}:`);
  });
});

describe('a saved key is not asked for again', () => {
  it('shows the saved line and Replace, and no paste box, until the owner asks', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'automation_list_secrets'
        ? { data: [row('resend_api_key', 'Resend API key', 'email', true)], error: null }
        : { data: true, error: null }
    ));
    const el = await render();

    expect(el.textContent).toContain('Saved');
    expect(el.textContent).toContain(SAVED_KEY_LINE);
    expect(el.querySelector('#automation-key-resend_api_key')).toBeNull();
    expect(Array.from(el.querySelectorAll('button')).some((button) => button.textContent?.trim() === REPLACE_BUTTON_LINE)).toBe(true);

    await act(async () => {
      Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.trim() === REPLACE_BUTTON_LINE)?.click();
      await Promise.resolve();
    });
    await settle();
    expect(el.querySelector('#automation-key-resend_api_key')).not.toBeNull();
    expect(el.textContent).toContain(REPLACE_SAVED_KEY_LINE);
  });

  it('a saved key that needs nothing typed stays usable: Test and Delete are there', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'automation_list_secrets'
        ? { data: [row('flutterwave_secret_key', 'Flutterwave secret key', 'commerce', true)], error: null }
        : { data: true, error: null }
    ));
    const el = await render();
    expect(el.querySelector('button[aria-label="Test Flutterwave secret key"]')).not.toBeNull();
    expect(el.querySelector('button[aria-label="Delete Flutterwave secret key"]')).not.toBeNull();
  });

  it('an empty box does nothing: no call, no notice, nothing saved', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'automation_list_secrets'
        ? { data: [row('resend_api_key', 'Resend API key', 'email')], error: null }
        : { data: true, error: null }
    ));
    const el = await render();
    const before = mocks.rpc.mock.calls.length;
    const saveButton = Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save');
    expect(saveButton).toBeDefined();
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      (saveButton as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await settle();
    expect(mocks.rpc.mock.calls.length).toBe(before);
    expect(mocks.rpc.mock.calls.some((call) => call[0] === 'automation_secret_save')).toBe(false);
  });

  it('nothing the page shows names the storage: the owner reads plain words', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'automation_list_secrets'
        ? { data: [row('resend_api_key', 'Resend API key', 'email', true)], error: null }
        : { data: true, error: null }
    ));
    const el = await render();
    const text = el.textContent ?? '';
    expect(text).not.toMatch(/vault|\brpc\b|postgres|\brls\b|\bjwt\b/i);
  });
});

describe('the phone alert copy', () => {
  it('says the whole flow: keys on Keys, then the phone, then /admin/settings and Register this device', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'automation_list_secrets' ? { data: [], error: null } : { data: true, error: null }
    ));
    const el = await render();
    const text = el.textContent ?? '';
    expect(text).toContain('Phone alerts');
    expect(text).toContain('/admin/settings');
    expect(text).toMatch(/phone/i);
    expect(text).toContain('Register this device');
    // The same words the daily log writes when a phone is not registered yet.
    expect(PUSH_HELP_COPY).toContain('Keys page');
    expect(PUSH_HELP_COPY).toContain('/admin/settings');
    expect(PUSH_HELP_COPY).toContain('Register this device');
    expect(PUSH_HELP_COPY).not.toMatch(/VAPID/);
  });
});
