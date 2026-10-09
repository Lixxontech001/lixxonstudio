// @vitest-environment node
// The door fields in the secret catalogue, run in an in-process Postgres (PGlite).
// A small stand-in table has the same columns and checks as the real catalogue, then the new migration runs on it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOOR_IDS, DOORS, doorSecretNames } from '../../supabase/functions/_shared/doorRegistry';

const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20261011090000_door_connections_catalog.sql'), 'utf8');
const TWELVE_MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20261011130000_door_catalog_twelve.sql'), 'utf8');
const PODCAST_COVER_MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20261011160000_podcast_cover_catalog.sql'), 'utf8');

const CATALOG = `
create table public.automation_secret_catalog (
  secret_name text primary key check (secret_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text not null,
  category text not null check (category in ('ai', 'actions', 'commerce', 'email', 'social', 'video', 'push')),
  purpose text not null,
  required boolean not null default false,
  sort_order integer not null default 100,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  credential_type text not null default 'secret' check (credential_type in ('secret', 'identifier', 'public_key'))
);
-- The names that already existed before this migration (the Keys page seeds them). Only the names matter here.
insert into public.automation_secret_catalog (secret_name, label, category, purpose) values
  ('telegram_bot_token', 'Telegram bot token', 'social', 'Telegram'),
  ('tumblr_consumer_secret', 'Tumblr consumer secret', 'social', 'Tumblr'),
  ('tumblr_access_token', 'Tumblr access token', 'social', 'Tumblr'),
  ('tumblr_token_secret', 'Tumblr token secret', 'social', 'Tumblr');
-- YouTube's three names come from the Phase 1 migrations (20261005090000 and 20261005100000), so they exist before this migration.
insert into public.automation_secret_catalog (secret_name, label, category, purpose, credential_type) values
  ('youtube_client_id', 'YouTube OAuth client ID', 'social', 'YouTube', 'identifier'),
  ('youtube_client_secret', 'YouTube client secret', 'social', 'YouTube', 'secret'),
  ('youtube_refresh_token', 'YouTube refresh token', 'social', 'YouTube', 'secret');
`;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(CATALOG);
  await db.exec(MIGRATION);
  await db.exec(TWELVE_MIGRATION);
  await db.exec(PODCAST_COVER_MIGRATION);
});

afterAll(async () => {
  await db.close();
});

async function rows() {
  const result = await db.query<{ secret_name: string; category: string; credential_type: string; enabled: boolean }>(
    'select secret_name, category, credential_type, enabled from public.automation_secret_catalog order by secret_name',
  );
  return result.rows;
}

describe('the door fields are in the secret catalogue', () => {
  it('every door field exists after the migration, once each', async () => {
    const names = (await rows()).map((row) => row.secret_name);
    for (const name of doorSecretNames()) {
      expect(names.filter((value) => value === name), name).toHaveLength(1);
    }
  });

  it('the reused names are untouched: the migration does not change Telegram or Tumblr rows that already exist', async () => {
    const result = await db.query<{ label: string }>("select label from public.automation_secret_catalog where secret_name = 'telegram_bot_token'");
    expect(result.rows[0].label).toBe('Telegram bot token');
  });

  it('every new row is a social row, enabled, with the credential type the door registry expects', async () => {
    const all = await rows();
    for (const id of DOOR_IDS) {
      for (const field of DOORS[id].fields) {
        const row = all.find((item) => item.secret_name === field.secretName);
        expect(row, field.secretName).toBeDefined();
        expect(row?.category).toBe('social');
        expect(row?.enabled).toBe(true);
        expect(row?.credential_type, field.secretName).toBe(field.kind);
      }
    }
  });

  it('running the migrations again changes nothing (safe to repeat)', async () => {
    const before = await rows();
    await db.exec(MIGRATION);
    await db.exec(TWELVE_MIGRATION);
    await db.exec(PODCAST_COVER_MIGRATION);
    expect(await rows()).toEqual(before);
  });

  it('the Phase 6 migration adds only the new names, and does not change the YouTube rows', async () => {
    const result = await db.query<{ label: string }>("select label from public.automation_secret_catalog where secret_name = 'youtube_client_id'");
    expect(result.rows[0].label).toBe('YouTube OAuth client ID');
    expect(TWELVE_MIGRATION).not.toMatch(/'youtube_/);
    expect(TWELVE_MIGRATION).not.toMatch(/'tumblr_|'telegram_|'bluesky_|'mastodon_|'discord_|'blogger_/);
  });

  it('the podcast cover migration adds one catalogue row, and nothing else', () => {
    expect(PODCAST_COVER_MIGRATION).toMatch(/'podcast_cover_url'/);
    expect(PODCAST_COVER_MIGRATION).not.toMatch(/vault\.(secrets|create_secret|decrypted_secrets)/i);
    expect(PODCAST_COVER_MIGRATION).not.toMatch(/create\s+(table|or\s+replace\s+function|function)/i);
    expect(PODCAST_COVER_MIGRATION).toMatch(/Additive\. NOT applied to production\./);
  });

  it('the migration adds catalogue rows only: no Vault value is written and no posting table is made', () => {
    expect(MIGRATION).not.toMatch(/vault\.(secrets|create_secret|decrypted_secrets)/i);
    expect(MIGRATION).not.toMatch(/create\s+table/i);
    expect(MIGRATION).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(MIGRATION).not.toMatch(/insert\s+into\s+public\.(posts|minds_packs|products)\b/i);
    expect(MIGRATION).toMatch(/Additive\. NOT applied to production\./);
  });
});
