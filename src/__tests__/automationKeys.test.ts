import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AUTOMATION_FLAGS_DEFAULT_OFF, keysWithoutDoorDetails, parseAutomationKeyList, safeAutomationKeyTestResult } from '../lib/automationKeys';
import { doorSecretNames } from '../../supabase/functions/_shared/doorRegistry';
import { ROUTE_PERMISSIONS, canAccess } from '../admin/permissions';
import type { AdminAccess } from '../context/AuthContext';

function access(overrides: Partial<AdminAccess> = {}): AdminAccess {
  return {
    user_id: 'non-owner',
    email: 'editor@example.com',
    role: 'editor',
    role_label: 'Editor',
    display_name: null,
    status: 'active',
    is_founder: false,
    is_owner: false,
    mfa_enrolled: false,
    permissions: [],
    ...overrides,
  };
}

describe('the Keys page does not repeat the free-door details', () => {
  it('removes every door detail and keeps every other key', () => {
    const doorRows = doorSecretNames().map((name) => ({ name }));
    // YouTube's names are door details now (Phase 6), so they are not in this list of other keys.
    const others = [{ name: 'gemini_api_key' }, { name: 'openai_api_key' }, { name: 'whatsapp_access_token' }];
    const kept = keysWithoutDoorDetails([...others, ...doorRows]);
    expect(kept.map((row) => row.name)).toEqual(others.map((row) => row.name));
  });

  it('the door list comes from the same registry as Connections, so nothing is missed', () => {
    expect(doorSecretNames()).toEqual(expect.arrayContaining(['telegram_bot_token', 'mastodon_access_token', 'tumblr_blog_name', 'blogger_blog_id']));
    expect(doorSecretNames()).toEqual(expect.arrayContaining(['youtube_client_id', 'pixelfed_access_token', 'podcast_show_title', 'vimeo_access_token']));
  });
});

describe('automation Keys security boundary', () => {
  it('whitelists safe key metadata and drops all secret/Vault properties', () => {
    const parsed = parseAutomationKeyList([{
      name: 'openai_api_key',
      label: 'OpenAI API key',
      category: 'ai',
      credential_type: 'secret',
      purpose: 'Optional provider route',
      required: false,
      configured: true,
      last_test_status: 'ok',
      last_test_message: 'This value must not be trusted or shown.',
      last_tested_at: '2026-10-05T08:00:00.000Z',
      vault_secret_id: 'vault-id-must-not-enter-component-state',
      decrypted_secret: 'FAKE-SECRET-MUST-NOT-ENTER-COMPONENT-STATE',
    }]);
    expect(parsed).toEqual([{
      name: 'openai_api_key',
      label: 'OpenAI API key',
      category: 'ai',
      credential_type: 'secret',
      purpose: 'Optional provider route',
      required: false,
      configured: true,
      last_test_status: 'ok',
      last_tested_at: '2026-10-05T08:00:00.000Z',
    }]);
    expect(JSON.stringify(parsed)).not.toContain('FAKE-SECRET');
    expect(JSON.stringify(parsed)).not.toContain('vault-id');
    expect(parseAutomationKeyList({ secret_value: 'not a list' })).toBeNull();
  });

  it('replaces server-supplied test text with a fixed redacted message', () => {
    const result = safeAutomationKeyTestResult({
      name: 'openai_api_key',
      status: 'invalid',
      message: 'raw provider response with FAKE-SECRET',
      payload: { secret: 'FAKE-SECRET' },
    });
    expect(result).toEqual({
      name: 'openai_api_key',
      status: 'invalid',
      message: 'The provider rejected this credential or a required scope.',
    });
    expect(JSON.stringify(result)).not.toContain('FAKE-SECRET');
    expect(safeAutomationKeyTestResult({ name: 'x', status: 'unexpected' })).toBeNull();
  });

  it('keeps the Keys route owner-only even if an RBAC override grants the capability', () => {
    expect(ROUTE_PERMISSIONS['admin-automation-keys']).toBe('automation.keys');
    expect(canAccess(access({ permissions: ['automation.keys'] }), 'admin-automation-keys')).toBe(false);
    expect(canAccess(access({ is_owner: true }), 'admin-automation-keys')).toBe(true);
    expect(canAccess(access({ is_founder: true }), 'admin-automation-keys')).toBe(true);
    expect(canAccess(access({ is_owner: true, status: 'suspended' }), 'admin-automation-keys')).toBe(false);
  });

  it('keeps every automation feature flag default-off in the foundation migration', () => {
    const migration = readFileSync('supabase/migrations/20261005090000_automation_foundation.sql', 'utf8');
    expect(AUTOMATION_FLAGS_DEFAULT_OFF).toHaveLength(6);
    for (const flag of AUTOMATION_FLAGS_DEFAULT_OFF) {
      expect(migration).toContain(`('${flag}', false,`);
    }
  });
});
