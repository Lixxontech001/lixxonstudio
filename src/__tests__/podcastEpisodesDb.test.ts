// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The podcast table is tested in PGlite: the migration as written, with the roles Supabase provides.
const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20261011180000_podcast_episodes.sql'), 'utf8');
const OWNER = '11111111-1111-4111-8111-111111111111';
const POST = '0b5f9a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const AUDIO = `${POST}.mp3`;

let db: PGlite;

async function attempt(sql: string): Promise<string | null> {
  try {
    await db.exec(sql);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db.close();
});

const insertRow = (audio: string, type = 'audio/mpeg', postId = POST) => `
  insert into public.podcast_episodes (owner_id, post_id, title, article_url, audio_path, audio_bytes, audio_type)
  values ('${OWNER}', '${postId}', 'Easy routine', 'https://lixxonstudio.example/blog/easy', '${audio}', 2048, '${type}')`;

describe('the podcast episode table accepts only real, well-formed episodes', () => {
  it('a row with an MP3 named by its article id is accepted', async () => {
    expect(await attempt(insertRow(AUDIO))).toBeNull();
  });

  it('an audio name that is not an article id and .mp3 is refused', async () => {
    expect(await attempt(insertRow('../escape.mp3', 'audio/mpeg', '22222222-2222-4222-8222-222222222222'))).toMatch(/check constraint/);
    expect(await attempt(insertRow('0b5f9a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c.wav', 'audio/mpeg', '33333333-3333-4333-8333-333333333333'))).toMatch(/check constraint/);
  });

  it('an audio type other than audio/mpeg is refused', async () => {
    expect(await attempt(insertRow(`${'44444444-4444-4444-8444-444444444444'}.mp3`, 'audio/mp4', '44444444-4444-4444-8444-444444444444'))).toMatch(/check constraint/);
  });

  it('an article gets one episode per owner: a second is refused', async () => {
    expect(await attempt(insertRow(AUDIO))).toMatch(/unique|duplicate/);
  });

  it('a zero-byte audio file is refused, so no empty enclosure is possible', async () => {
    expect(await attempt(`
      insert into public.podcast_episodes (owner_id, post_id, title, article_url, audio_path, audio_bytes, audio_type)
      values ('${OWNER}', '55555555-5555-4555-8555-555555555555', 'x', 'https://lixxonstudio.example/blog/x', '55555555-5555-4555-8555-555555555555.mp3', 0, 'audio/mpeg')`)).toMatch(/check constraint/);
  });

  it('the article link must be https', async () => {
    expect(await attempt(`
      insert into public.podcast_episodes (owner_id, post_id, title, article_url, audio_path, audio_bytes, audio_type)
      values ('${OWNER}', '66666666-6666-4666-8666-666666666666', 'x', 'http://lixxonstudio.example/blog/x', '66666666-6666-4666-8666-666666666666.mp3', 10, 'audio/mpeg')`)).toMatch(/check constraint/);
  });
});

describe('only the server writes episodes; anyone can read them for the public feed', () => {
  it('the public (anon) can read the episodes', async () => {
    await db.exec('reset role');
    await db.exec('set role anon');
    const result = await db.query<{ n: number }>('select count(*)::int as n from public.podcast_episodes');
    await db.exec('reset role');
    expect(result.rows[0].n).toBeGreaterThan(0);
  });

  it('the public (anon) cannot write an episode', async () => {
    await db.exec('reset role');
    await db.exec('set role anon');
    const error = await attempt(insertRow('77777777-7777-4777-8777-777777777777.mp3', 'audio/mpeg', '77777777-7777-4777-8777-777777777777'));
    await db.exec('reset role');
    expect(error).toMatch(/permission denied/);
  });

  it('a signed-in user cannot change or delete an episode', async () => {
    await db.exec('reset role');
    await db.exec('set role authenticated');
    const update = await attempt(`update public.podcast_episodes set title = 'changed'`);
    const remove = await attempt('delete from public.podcast_episodes');
    await db.exec('reset role');
    expect(update).toMatch(/permission denied/);
    expect(remove).toMatch(/permission denied/);
  });

  it('the migration adds the episode table and the buckets only where storage exists, and no secret or product', () => {
    expect(MIGRATION).toMatch(/Additive\. NOT applied to production\./);
    expect(MIGRATION).not.toMatch(/vault\.(secrets|create_secret)/i);
    expect(MIGRATION).toMatch(/to_regclass\('storage\.buckets'\) IS NOT NULL/);
    expect(MIGRATION).toMatch(/'podcast-audio', 'podcast-audio', true/);
    expect(MIGRATION).toMatch(/'pack-videos', 'pack-videos', false/);
  });
});
