#!/usr/bin/env node
// Saves the day's pack pictures and videos to storage, and attaches their paths to the pack rows.
// A still is a copy of the article's own cover image. A video is a real MP4 made from that picture by scripts/pack-video.mjs.
// Nothing here posts anything, and nothing runs on a schedule. A missing piece is skipped with a plain note, never faked.
// Usage: node --experimental-strip-types scripts/save-pack-media.mjs --day 2026-10-09 [--ffmpeg <path>] [--site <https origin>]
// Needs LIXXON_SUPABASE_URL and LIXXON_SERVICE_ROLE_KEY in the environment. Those values are never printed.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticleImage, imageProblemNote } from '../supabase/functions/_shared/articleImage.ts';
import { captionChunks } from '../supabase/functions/_shared/packMedia.ts';
import { ffmpegAvailable, renderPackVideo } from './pack-video.mjs';

export const STILL_BUCKET = 'pack-stills';
export const VIDEO_BUCKET = 'pack-videos';
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const STILL_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const NO_CAPTION_NOTE = 'The caption has no text to put on the video. No video was made.';
export const NO_FFMPEG_NOTE = 'FFmpeg is not installed on this machine. No video was made.';
export const VIDEO_FAILED_NOTE = 'The video could not be made. No video was saved.';
export const VIDEO_NOT_VALID_NOTE = 'The video file was not valid. No video was saved.';
export const STORE_FAILED_NOTE = 'The file could not be saved to storage. Nothing was attached.';

/** The storage path for one owner, day and article: owner/day/article.ext. Null when any part is not in the expected form. */
export function storagePathFor({ owner, day, postId, extension }) {
  if (!UUID.test(String(owner)) || !DAY.test(String(day)) || !UUID.test(String(postId))) return null;
  if (!['jpg', 'png', 'webp', 'mp4'].includes(extension)) return null;
  return `${owner}/${day}/${postId}.${extension}`;
}

/** A still is kept only when its type is a picture type and it is not empty. The extension comes from the type. */
export function checkStill(contentType, byteLength) {
  const extension = STILL_EXTENSIONS[String(contentType).split(';')[0].trim().toLowerCase()];
  if (!extension) return { ok: false, reason: 'not_an_image' };
  if (!byteLength) return { ok: false, reason: 'empty' };
  return { ok: true, extension };
}

/** A video is kept only when it is a real MP4: not empty, not too big, and an MP4 box header at the start. */
export function checkVideo(bytes) {
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: 'empty' };
  if (bytes.byteLength > VIDEO_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 12)).toString('latin1', 4, 8);
  if (header !== 'ftyp') return { ok: false, reason: 'not_mp4' };
  return { ok: true };
}

/**
 * Saves what a day's packs still need. deps is injected, so the same code runs in tests and on the real runner:
 *  loadPacks(day), loadArticle(postId), fetchImpl, siteOrigin, upload(bucket, path, bytes, type), attach(input),
 *  ffmpegReady(), renderVideo({ imagePath, chunks, outputPath }), workDir.
 * Returns one line per article: what was saved, and the plain reason for anything skipped.
 */
export async function saveDayMedia(day, deps) {
  const rows = (await deps.loadPacks(day)).filter((row) => row.posted_at == null && (row.status === 'ready' || row.status === 'blocked'));
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.owner_id}|${row.post_id}`;
    if (!groups.has(key)) groups.set(key, { owner: row.owner_id, postId: row.post_id, rows: [] });
    groups.get(key).rows.push(row);
  }

  const report = [];
  for (const group of groups.values()) {
    const first = group.rows[0];
    const needStill = group.rows.every((row) => !row.still_path);
    const needVideo = group.rows.every((row) => !row.video_path);
    const line = { postId: group.postId, still: needStill ? null : 'already saved', video: needVideo ? null : 'already saved' };
    if (!needStill && !needVideo) {
      report.push(line);
      continue;
    }
    const picture = await fetchArticleImage(await articleCover(deps, group.postId), deps.siteOrigin, deps.fetchImpl);
    if (!picture.ok) {
      const note = imageProblemNote(picture.reason);
      if (needStill) line.still = note;
      if (needVideo) line.video = `No video was made. ${note}`;
      report.push(line);
      continue;
    }

    if (needStill) {
      const check = checkStill(picture.contentType, picture.bytes);
      const path = check.ok ? storagePathFor({ owner: group.owner, day, postId: group.postId, extension: check.extension }) : null;
      if (!path) {
        line.still = 'The article picture could not be saved.';
      } else if (!(await deps.upload(STILL_BUCKET, path, new Uint8Array(picture.data), picture.contentType))) {
        line.still = STORE_FAILED_NOTE;
      } else if (await deps.attach({ owner: group.owner, day, postId: group.postId, stillPath: path, videoPath: null })) {
        line.still = 'saved';
      } else {
        line.still = STORE_FAILED_NOTE;
      }
    }

    if (needVideo) {
      line.video = await makeVideo(deps, { group, day, first, picture });
    }
    report.push(line);
  }
  return report;
}

async function articleCover(deps, postId) {
  const article = await deps.loadArticle(postId);
  return article ? article.cover_image : null;
}

async function makeVideo(deps, { group, day, first, picture }) {
  const chunks = captionChunks(first.caption ?? first.pin_description ?? '');
  if (chunks.length === 0) return NO_CAPTION_NOTE;
  if (!deps.ffmpegReady()) return NO_FFMPEG_NOTE;

  const extension = STILL_EXTENSIONS[picture.contentType] ?? 'jpg';
  const imagePath = join(deps.workDir, `${group.postId}.${extension}`);
  const outputPath = join(deps.workDir, `${group.postId}.mp4`);
  await writeFile(imagePath, new Uint8Array(picture.data));
  const rendered = await deps.renderVideo({ imagePath, chunks, outputPath });
  if (!rendered.ok) return VIDEO_FAILED_NOTE;

  const bytes = new Uint8Array(await readFile(outputPath));
  const check = checkVideo(bytes);
  if (!check.ok) return VIDEO_NOT_VALID_NOTE;
  const path = storagePathFor({ owner: group.owner, day, postId: group.postId, extension: 'mp4' });
  if (!path) return VIDEO_NOT_VALID_NOTE;
  if (!(await deps.upload(VIDEO_BUCKET, path, bytes, 'video/mp4'))) return STORE_FAILED_NOTE;
  if (!(await deps.attach({ owner: group.owner, day, postId: group.postId, stillPath: null, videoPath: path }))) return STORE_FAILED_NOTE;
  return 'saved';
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const day = value('--day');
  if (!day || !DAY.test(day)) {
    console.log('Give the day as --day YYYY-MM-DD.');
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
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const ffmpeg = value('--ffmpeg');
  const siteOrigin = value('--site') ?? process.env.LIXXON_SITE_ORIGIN ?? null;
  const workDir = await mkdtemp(join(tmpdir(), 'pack-media-'));
  try {
    const report = await saveDayMedia(day, {
      siteOrigin,
      workDir,
      fetchImpl: (target, init) => fetch(target, init),
      ffmpegReady: () => ffmpegAvailable(ffmpeg),
      renderVideo: (input) => renderPackVideo({ ...input, ffmpeg }),
      async loadPacks(localDay) {
        const { data, error } = await sb
          .from('minds_packs')
          .select('owner_id,post_id,channel,caption,pin_description,status,posted_at,still_path,video_path')
          .eq('local_day', localDay);
        if (error) throw new Error('packs');
        return data ?? [];
      },
      async loadArticle(postId) {
        const { data, error } = await sb.from('posts').select('id,cover_image').eq('id', postId).maybeSingle();
        if (error) throw new Error('article');
        return data;
      },
      async upload(bucket, path, bytes, contentType) {
        const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
        return !error;
      },
      async attach(input) {
        const { error } = await sb.rpc('minds_attach_pack_media', {
          p_owner_id: input.owner,
          p_local_day: input.day,
          p_post_id: input.postId,
          p_still_path: input.stillPath,
          p_video_path: input.videoPath,
        });
        return !error;
      },
    });
    for (const line of report) {
      console.log(`Article ${line.postId}: picture ${line.still ?? 'nothing to do'}; video ${line.video ?? 'nothing to do'}.`);
    }
    if (report.length === 0) console.log(`No packs waiting for pictures or videos on ${day}.`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.log('The pack media run stopped on an error. Nothing more was changed.');
    process.exitCode = 1;
  });
}
