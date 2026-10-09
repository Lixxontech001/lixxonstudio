import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_CHANNELS } from '../../supabase/functions/_shared/packRules';
import {
  DOOR_IDS,
  DOORS,
  doorSecretNames,
  doorStatus,
  isDoorId,
} from '../../supabase/functions/_shared/doorRegistry';

const CATALOG_FILES = [
  'supabase/migrations/20261005090000_automation_foundation.sql',
  'supabase/migrations/20261005100000_automation_keys_owner_and_catalog.sql',
  'supabase/migrations/20261011090000_door_connections_catalog.sql',
];
const catalogText = CATALOG_FILES.map((file) => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');

describe('the six free doors', () => {
  it('are exactly Telegram, Bluesky, Mastodon, Tumblr, Discord and Blogger, in that order', () => {
    expect([...DOOR_IDS]).toEqual(['telegram', 'bluesky', 'mastodon', 'tumblr', 'discord', 'blogger']);
    expect(Object.keys(DOORS).sort()).toEqual([...DOOR_IDS].sort());
  });

  it('never include a gated channel: the AI does not post to Instagram, TikTok, Facebook or Pinterest', () => {
    for (const channel of PACK_CHANNELS) {
      expect(DOOR_IDS as readonly string[]).not.toContain(channel);
      for (const id of DOOR_IDS) {
        expect(DOORS[id].label.toLowerCase()).not.toContain(channel);
      }
    }
    expect(DOOR_IDS as readonly string[]).not.toContain('whatsapp');
    expect(DOOR_IDS as readonly string[]).not.toContain('youtube');
  });

  it('every door has at least one field, and every field has a plain label and a kind', () => {
    for (const id of DOOR_IDS) {
      expect(DOORS[id].fields.length, id).toBeGreaterThan(0);
      for (const field of DOORS[id].fields) {
        expect(field.label.length, `${id} label`).toBeGreaterThan(0);
        expect(['secret', 'identifier']).toContain(field.kind);
      }
    }
  });

  it('every field name is a real catalogue name, and no name is used by two fields', () => {
    const names = DOOR_IDS.flatMap((id) => DOORS[id].fields.map((field) => field.secretName));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(catalogText, name).toContain(`'${name}'`);
    }
    expect(doorSecretNames()).toEqual(names);
  });

  it('a token, password or webhook is a secret, and a name or ID is an identifier', () => {
    for (const id of DOOR_IDS) {
      for (const field of DOORS[id].fields) {
        if (/token|password|secret|webhook|key/.test(field.secretName)) {
          expect(field.kind, field.secretName).toBe('secret');
        }
      }
    }
    expect(DOORS.telegram.fields.find((field) => field.secretName === 'telegram_chat_id')?.kind).toBe('identifier');
    expect(DOORS.bluesky.fields.find((field) => field.secretName === 'bluesky_handle')?.kind).toBe('identifier');
  });

  it('isDoorId only accepts the six, and ignores inherited names', () => {
    for (const id of DOOR_IDS) expect(isDoorId(id)).toBe(true);
    for (const bad of ['toString', '__proto__', 'constructor', 'instagram', '', 'Telegram', null, 3]) {
      expect(isDoorId(bad), String(bad)).toBe(false);
    }
  });
});

describe('a door is connected only when every field is saved', () => {
  it('nothing saved: not connected, every label is missing', () => {
    const status = doorStatus('telegram', new Set());
    expect(status.state).toBe('not_connected');
    expect(status.missing).toEqual(['Bot token', 'Channel or chat ID']);
  });

  it('some saved: partly connected, and only the missing labels are listed', () => {
    const status = doorStatus('telegram', new Set(['telegram_bot_token']));
    expect(status.state).toBe('partly');
    expect(status.missing).toEqual(['Channel or chat ID']);
  });

  it('all saved: connected, with nothing missing', () => {
    const status = doorStatus('telegram', new Set(['telegram_bot_token', 'telegram_chat_id']));
    expect(status).toEqual({ state: 'connected', missing: [] });
  });

  it('a single-field door is either connected or not connected, never partly', () => {
    expect(doorStatus('discord', new Set()).state).toBe('not_connected');
    expect(doorStatus('discord', new Set(['discord_webhook_url'])).state).toBe('connected');
  });

  it('a saved name for another door does not count', () => {
    expect(doorStatus('bluesky', new Set(['telegram_bot_token', 'telegram_chat_id'])).state).toBe('not_connected');
  });
});
