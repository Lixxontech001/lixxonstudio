#!/usr/bin/env node
// Saves podcast episode audio to the public podcast bucket: one MP3 per article, named <article id>.mp3.
// The MP3 is made by the owner, or by a tool on the owner's machine. This runner only checks the file and saves it.
// It never makes audio, never posts, never replaces audio that is already saved, and never runs on a schedule.
// Usage: node --experimental-strip-types scripts/save-podcast-audio.mjs --dir <folder of <article id>.mp3 files>
// Needs LIXXON_SUPABASE_URL and LIXXON_SERVICE_ROLE_KEY in the environment. Those values are never printed.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUDIO_BUCKET = 'podcast-audio';
export const AUDIO_MAX_BYTES = 150 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NOT_AUDIO_NAME_NOTE = 'The file name is not an article id with .mp3. Nothing was saved.';
export const NOT_MP3_NOTE = 'The file is not an MP3. Nothing was saved.';
export const NO_ARTICLE_NOTE = 'No article has this id. Nothing was saved.';
export const ALREADY_SAVED_NOTE = 'Audio for this article is already saved. It was not replaced.';
export const STORE_FAILED_NOTE = 'The audio could not be saved to storage. Nothing was attached.';

/** The storage name for an article's episode: <article id>.mp3. Null when the id is not an article id. */
export function episodeAudioPath(articleId) {
  return UUID.test(String(articleId)) ? `${articleId}.mp3` : null;
}

/** The article id a file is named for, or null when the name is not <article id>.mp3. */
export function articleIdFromFileName(name) {
  const match = /^(.+)\.mp3$/i.exec(String(name));
  return match && UUID.test(match[1]) ? match[1] : null;
}

/** An MP3 starts with an ID3 tag or with an MPEG frame sync. Anything else is refused. */
export function checkMp3(bytes) {
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: 'empty' };
  if (bytes.byteLength > AUDIO_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  return id3 || frame ? { ok: true } : { ok: false, reason: 'not_mp3' };
}

/**
 * Saves each file that passes the checks. deps is injected so the same code runs in tests and on the real runner:
 *  articleExists(ids) -> Set of the ids that are real articles,
 *  upload(path, bytes) -> 'saved' | 'exists' | 'failed' (never replaces a file that already exists).
 * Returns one line per file: the file name and the plain result.
 */
export async function saveEpisodeAudio(files, deps) {
  const candidates = files.map((file) => {
    const articleId = articleIdFromFileName(file.name);
    if (!articleId) return { name: file.name, articleId: null, note: NOT_AUDIO_NAME_NOTE };
    const check = checkMp3(file.bytes);
    if (!check.ok) return { name: file.name, articleId, note: NOT_MP3_NOTE };
    return { name: file.name, articleId, bytes: file.bytes, note: null };
  });
  const ids = [...new Set(candidates.filter((item) => item.articleId && !item.note).map((item) => item.articleId))];
  const real = ids.length > 0 ? await deps.articleExists(ids) : new Set();

  const report = [];
  for (const item of candidates) {
    if (item.note) {
      report.push({ file: item.name, result: item.note });
      continue;
    }
    if (!real.has(item.articleId)) {
      report.push({ file: item.name, result: NO_ARTICLE_NOTE });
      continue;
    }
    const outcome = await deps.upload(episodeAudioPath(item.articleId), item.bytes);
    const result = outcome === 'saved' ? 'saved' : outcome === 'exists' ? ALREADY_SAVED_NOTE : STORE_FAILED_NOTE;
    report.push({ file: item.name, result });
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const dir = dirIndex >= 0 ? args[dirIndex + 1] : undefined;
  if (!dir) {
    console.log('Give the folder with --dir <folder>.');
    process.exitCode = 1;
    return;
  }
  const url = process.env.LIXXON_SUPABASE_URL;
  const key = process.env.LIXXON_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('Set LIXXON_SUPABASE_URL and LIXXON_SERVICE_ROLE_KEY first. Nothing was changed.');
    process.exitCode = 1;
    return;
  }
  const names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.mp3'));
  const files = [];
  for (const name of names) files.push({ name, bytes: new Uint8Array(await readFile(join(dir, name))) });

  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const report = await saveEpisodeAudio(files, {
    async articleExists(ids) {
      const { data, error } = await sb.from('posts').select('id').in('id', ids);
      if (error) throw new Error('articles');
      return new Set((data ?? []).map((row) => String(row.id)));
    },
    async upload(path, bytes) {
      const { error } = await sb.storage.from(AUDIO_BUCKET).upload(path, bytes, { contentType: 'audio/mpeg', upsert: false });
      if (!error) return 'saved';
      return /already exists|duplicate|resource already/i.test(String(error.message ?? '')) ? 'exists' : 'failed';
    },
  });
  for (const line of report) console.log(`${line.file}: ${line.result}`);
  if (report.length === 0) console.log('No MP3 files in that folder.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.log('The podcast audio run stopped on an error. Nothing more was changed.');
    process.exitCode = 1;
  });
}
