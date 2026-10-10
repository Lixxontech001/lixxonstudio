// @vitest-environment node
// Podcast episode audio: the saver, and the feed that lists only real saved files.
// Uses a tiny local MP3 fixture (one second, 32 kbps) and fake storage. Nothing here reaches the network or posts anything.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPodcastFeed, episodeAudioUrl, type PodcastEpisode, type PodcastShow } from '../../supabase/functions/_shared/podcastFeed';
import {
  ALREADY_SAVED_NOTE,
  AUDIO_BUCKET,
  NOT_AUDIO_NAME_NOTE,
  NOT_MP3_NOTE,
  NO_ARTICLE_NOTE,
  STORE_FAILED_NOTE,
  articleIdFromFileName,
  checkMp3,
  episodeAudioPath,
  saveEpisodeAudio,
} from '../../scripts/save-podcast-audio.mjs';

const ARTICLE_A = '5a1f0c2e-1111-4111-8111-000000000001';
const ARTICLE_B = '5a1f0c2e-1111-4111-8111-000000000002';
const ARTICLE_GONE = '5a1f0c2e-1111-4111-8111-0000000000ff';
const MP3 = new Uint8Array(readFileSync(join(process.cwd(), 'src/__tests__/fixtures/podcast/episode.mp3')));
const NOT_MP3 = new TextEncoder().encode('<html>not audio</html>');
const SUPABASE = 'https://project.supabase.example';
const SITE = 'https://lixxonstudio.example';

interface Harness {
  uploads: Array<{ path: string; bytes: Uint8Array }>;
}

function run(options: { existing?: string[]; uploadFails?: boolean } = {}) {
  const h: Harness = { uploads: [] };
  const existing = new Set(options.existing ?? []);
  const deps = {
    async articleExists(ids: string[]) {
      return new Set(ids.filter((id) => id === ARTICLE_A || id === ARTICLE_B));
    },
    async upload(path: string, bytes: Uint8Array) {
      if (options.uploadFails) return 'failed';
      if (existing.has(path)) return 'exists';
      h.uploads.push({ path, bytes });
      existing.add(path);
      return 'saved';
    },
  };
  return { h, deps };
}

describe('the audio is saved under the article id, and only a real MP3 is accepted', () => {
  it('the fixture MP3 is saved as <article id>.mp3 in the podcast bucket, and the bucket name is the one the feed reads', async () => {
    const { h, deps } = run();
    const report = await saveEpisodeAudio([{ name: `${ARTICLE_A}.mp3`, bytes: MP3 }], deps);
    expect(report).toEqual([{ file: `${ARTICLE_A}.mp3`, result: 'saved' }]);
    expect(h.uploads).toEqual([{ path: `${ARTICLE_A}.mp3`, bytes: MP3 }]);
    expect(AUDIO_BUCKET).toBe('podcast-audio');
    expect(episodeAudioPath(ARTICLE_A)).toBe(`${ARTICLE_A}.mp3`);
  });

  it('a file that is not an MP3 is never uploaded', async () => {
    const { h, deps } = run();
    const report = await saveEpisodeAudio([{ name: `${ARTICLE_A}.mp3`, bytes: NOT_MP3 }], deps);
    expect(report[0].result).toBe(NOT_MP3_NOTE);
    expect(h.uploads).toHaveLength(0);
  });

  it('an empty file is never uploaded', async () => {
    const { h, deps } = run();
    const report = await saveEpisodeAudio([{ name: `${ARTICLE_A}.mp3`, bytes: new Uint8Array(0) }], deps);
    expect(report[0].result).toBe(NOT_MP3_NOTE);
    expect(h.uploads).toHaveLength(0);
  });

  it('a file name that is not an article id with .mp3 is refused, so no odd path is ever made', async () => {
    const { h, deps } = run();
    const report = await saveEpisodeAudio(
      [
        { name: 'my-episode.mp3', bytes: MP3 },
        { name: `../${ARTICLE_A}.mp3`, bytes: MP3 },
        { name: `${ARTICLE_A}.wav`, bytes: MP3 },
      ],
      deps,
    );
    expect(report.map((item) => item.result)).toEqual([NOT_AUDIO_NAME_NOTE, NOT_AUDIO_NAME_NOTE, NOT_AUDIO_NAME_NOTE]);
    expect(h.uploads).toHaveLength(0);
  });

  it('an id that is not a real article is refused', async () => {
    const { h, deps } = run();
    const report = await saveEpisodeAudio([{ name: `${ARTICLE_GONE}.mp3`, bytes: MP3 }], deps);
    expect(report[0].result).toBe(NO_ARTICLE_NOTE);
    expect(h.uploads).toHaveLength(0);
  });

  it('audio that is already saved for an article is never replaced', async () => {
    const { h, deps } = run({ existing: [`${ARTICLE_A}.mp3`] });
    const report = await saveEpisodeAudio([{ name: `${ARTICLE_A}.mp3`, bytes: MP3 }], deps);
    expect(report[0].result).toBe(ALREADY_SAVED_NOTE);
    expect(h.uploads).toHaveLength(0);
  });

  it('a storage failure says so and attaches nothing', async () => {
    const { h, deps } = run({ uploadFails: true });
    const report = await saveEpisodeAudio([{ name: `${ARTICLE_A}.mp3`, bytes: MP3 }], deps);
    expect(report[0].result).toBe(STORE_FAILED_NOTE);
    expect(h.uploads).toHaveLength(0);
  });

  it('several files are handled one by one, and a bad one does not stop the good ones', async () => {
    const { h, deps } = run();
    const report = await saveEpisodeAudio(
      [
        { name: `${ARTICLE_A}.mp3`, bytes: NOT_MP3 },
        { name: `${ARTICLE_B}.mp3`, bytes: MP3 },
      ],
      deps,
    );
    expect(report.map((item) => item.result)).toEqual([NOT_MP3_NOTE, 'saved']);
    expect(h.uploads.map((item) => item.path)).toEqual([`${ARTICLE_B}.mp3`]);
  });

  it('the day run looks for the same name the saver writes: <article id>.mp3 in the podcast bucket', async () => {
    const { readFileSync: read } = await import('node:fs');
    const runner = read(join(process.cwd(), 'supabase/functions/minds-run-placement/index.ts'), 'utf8');
    expect(runner).toContain('const path = `${articleId}.mp3`;');
    expect(runner).toContain('storage.from("podcast-audio").download(path)');
  });

  it('the checks read the file itself: an ID3 tag or an MPEG frame, nothing else', () => {
    expect(checkMp3(MP3)).toEqual({ ok: true });
    expect(checkMp3(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))).toEqual({ ok: true });
    expect(checkMp3(NOT_MP3)).toEqual({ ok: false, reason: 'not_mp3' });
    expect(checkMp3(new Uint8Array(0))).toEqual({ ok: false, reason: 'empty' });
  });

  it('an article id is read from a file name only when the name is exact', () => {
    expect(articleIdFromFileName(`${ARTICLE_A}.mp3`)).toBe(ARTICLE_A);
    expect(articleIdFromFileName(`${ARTICLE_A}.mp3.exe`)).toBeNull();
    expect(articleIdFromFileName('notes.mp3')).toBeNull();
  });
});

describe('the feed lists only real saved files, with the real length', () => {
  const SHOW: PodcastShow = {
    title: 'Lixxon Studio Notes',
    author: 'Lixxon Studio',
    coverUrl: `${SITE}/podcast-cover.jpg`,
    siteUrl: SITE,
    feedUrl: `${SITE}/podcast.xml`,
  };

  function episodeFor(articleId: string, bytes: number): PodcastEpisode {
    return {
      id: `ep-${articleId}`,
      title: `Episode for ${articleId.slice(-2)}`,
      description: 'A short calm routine.',
      articleUrl: `${SITE}/blog/${articleId}`,
      publishedAt: '2026-10-10T09:00:00Z',
      audioUrl: episodeAudioUrl(SUPABASE, episodeAudioPath(articleId) ?? '') ?? '',
      audioBytes: bytes,
      audioType: 'audio/mpeg',
    };
  }

  it('a saved episode is listed with an enclosure that points at the saved file and its real size', () => {
    const xml = buildPodcastFeed(SHOW, [episodeFor(ARTICLE_A, MP3.byteLength)]);
    expect(xml).toContain(`<enclosure url="${SUPABASE}/storage/v1/object/public/podcast-audio/${ARTICLE_A}.mp3" length="${MP3.byteLength}" type="audio/mpeg"/>`);
    expect(xml).toContain('<itunes:category text="Health &amp; Fitness"/>');
  });

  it('an episode with no saved file is left out, and never gets an enclosure', () => {
    const missing = { ...episodeFor(ARTICLE_B, 0), audioUrl: '' };
    const xml = buildPodcastFeed(SHOW, [episodeFor(ARTICLE_A, MP3.byteLength), missing]);
    expect(xml.match(/<item>/g)).toHaveLength(1);
    expect(xml).not.toContain(ARTICLE_B);
    expect(xml).not.toContain('audio not made yet');
  });

  it('a feed with no saved audio still builds, with no items and no enclosure', () => {
    const xml = buildPodcastFeed(SHOW, [{ ...episodeFor(ARTICLE_B, 0), audioUrl: '' }]);
    expect(xml).not.toContain('<enclosure');
    expect(xml).toContain('<rss');
  });

  it('the feed never carries an email address', () => {
    const xml = buildPodcastFeed(SHOW, [episodeFor(ARTICLE_A, MP3.byteLength)]);
    expect(xml).not.toMatch(/[\w.+-]+@[\w-]+\./);
    expect(xml).not.toContain('itunes:owner');
  });
});
