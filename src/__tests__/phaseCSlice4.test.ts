// Phase C slice 4: WhatsApp is not a door. The owner's key list drops its names, and the keys function never tests them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAutomationKeyList } from '../lib/automationKeys';
import { isNotOfferedKey, NOT_OFFERED_KEY_NAMES } from '../../supabase/functions/_shared/notOfferedKeys';

const row = (name: string) => ({
  name,
  label: name,
  purpose: 'test row',
  category: 'social',
  credential_type: 'secret',
  configured: false,
  required: false,
  last_test_status: 'not_tested',
  last_test_message: 'Not configured.',
  last_tested_at: null,
});

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('Phase C slice 4: WhatsApp is not offered', () => {
  it('the shared list names the WhatsApp token and phone-number ID', () => {
    expect(NOT_OFFERED_KEY_NAMES).toEqual(['whatsapp_access_token', 'whatsapp_phone_number_id']);
    expect(isNotOfferedKey('whatsapp_access_token')).toBe(true);
    expect(isNotOfferedKey('telegram_bot_token')).toBe(false);
  });

  it('the key list parser drops WhatsApp rows and keeps the rest', () => {
    const parsed = parseAutomationKeyList([row('whatsapp_access_token'), row('telegram_bot_token'), row('whatsapp_phone_number_id')]);
    expect(parsed?.map((entry) => entry.name)).toEqual(['telegram_bot_token']);
  });

  it('the keys function never runs a WhatsApp Graph test', () => {
    const source = read('supabase/functions/automation-keys/index.ts');
    expect(source).not.toMatch(/testWhatsAppCredential|graph\.facebook\.com\/v23\.0\/\$\{encodeURIComponent\(safePhoneId/);
    expect(source).toMatch(/isNotOfferedKey\(name\)\) return "invalid"/);
  });

  it('the Keys page has no WhatsApp help sentence', () => {
    expect(read('src/admin/pages/AutomationKeys.tsx')).not.toMatch(/whatsapp/i);
  });
});
