import { describe, expect, it } from 'vitest';
import { buildPodcastFeed, episodeAudioUrl, podcastShowReady, xmlText, type PodcastEpisode, type PodcastShow } from '../../supabase/functions/_shared/podcastFeed';

const SHOW: PodcastShow = {
  title: 'Lixxon Studio Show',
  author: 'Lixxon Studio',
  coverUrl: 'https://lixxonstudio.example/podcast-cover.jpg',
  siteUrl: 'https://lixxonstudio.example',
  feedUrl: 'https://lixxonstudio.example/podcast.xml',
};
const ID = '0b5f9a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const AUDIO = `https://project.supabase.example/storage/v1/object/public/podcast-audio/${ID}.mp3`;

const EPISODE: PodcastEpisode = {
  id: 'ep-1',
  title: 'Easy routine for dry skin',
  description: 'A calm routine & a short note.',
  articleUrl: 'https://lixxonstudio.example/blog/easy-routine-dry-skin',
  publishedAt: '2026-10-10T09:00:00Z',
  audioUrl: AUDIO,
  audioBytes: 2048,
  audioType: 'audio/mpeg',
};

describe('the show is served only when it is complete', () => {
  it('needs a title, an author, and a secure cover address', () => {
    expect(podcastShowReady(SHOW)).toBe(true);
    expect(podcastShowReady({ ...SHOW, title: '  ' })).toBe(false);
    expect(podcastShowReady({ ...SHOW, author: '' })).toBe(false);
    expect(podcastShowReady({ ...SHOW, coverUrl: 'http://lixxonstudio.example/c.jpg' })).toBe(false);
    expect(podcastShowReady({ ...SHOW, coverUrl: '' })).toBe(false);
    expect(podcastShowReady({ ...SHOW, title: 'x'.repeat(129) })).toBe(false);
  });
});

describe('an episode\'s audio address is built only from the expected storage name', () => {
  it('builds the public podcast-audio address for an article id and .mp3', () => {
    expect(episodeAudioUrl('https://project.supabase.example/', `${ID}.mp3`)).toBe(AUDIO);
  });

  it('refuses any other name, so no odd address is ever built', () => {
    expect(episodeAudioUrl('https://project.supabase.example', `../secret/${ID}.mp3`)).toBeNull();
    expect(episodeAudioUrl('https://project.supabase.example', `${ID}.wav`)).toBeNull();
    expect(episodeAudioUrl('https://project.supabase.example', 'episode.mp3')).toBeNull();
    expect(episodeAudioUrl('http://project.supabase.example', `${ID}.mp3`)).toBeNull();
  });
});

describe('the feed lists only episodes with a real audio file', () => {
  it('an episode with real audio is an item with a real enclosure: the address, the byte length, and the type', () => {
    const xml = buildPodcastFeed(SHOW, [EPISODE]);
    expect(xml).toContain(`<enclosure url="${AUDIO}" length="2048" type="audio/mpeg"/>`);
    expect(xml).toContain('<guid isPermaLink="false">lixxon-episode-ep-1</guid>');
    expect(xml).toContain('<pubDate>Sat, 10 Oct 2026 09:00:00 GMT</pubDate>');
    expect(xml).toContain('<link>https://lixxonstudio.example/blog/easy-routine-dry-skin</link>');
  });

  it('an episode with no audio is left out, and never gets an enclosure', () => {
    const xml = buildPodcastFeed(SHOW, [{ ...EPISODE, id: 'ep-2', audioUrl: '', audioBytes: 0 }, { ...EPISODE, id: 'ep-3', audioUrl: 'https://x.example/a.mp3', audioBytes: 0 }]);
    expect(xml).not.toContain('<item>');
    expect(xml).not.toContain('<enclosure');
  });

  it('a feed with no episodes is still a valid show', () => {
    const xml = buildPodcastFeed(SHOW, []);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<itunes:author>Lixxon Studio</itunes:author>');
    expect(xml).toContain('<itunes:image href="https://lixxonstudio.example/podcast-cover.jpg"/>');
    expect(xml).toContain('<itunes:category text="Health &amp; Fitness"/>');
    expect(xml).toContain('<atom:link href="https://lixxonstudio.example/podcast.xml" rel="self" type="application/rss+xml"/>');
    expect(xml).not.toContain('<item>');
  });

  it('special characters in titles and descriptions are escaped, so the XML stays valid', () => {
    const xml = buildPodcastFeed(SHOW, [{ ...EPISODE, title: 'Tom & "Jerry" <3', description: "it's <b>bold</b>" }]);
    expect(xml).toContain('<title>Tom &amp; &quot;Jerry&quot; &lt;3</title>');
    expect(xml).toContain('<description>it&apos;s &lt;b&gt;bold&lt;/b&gt;</description>');
    expect(xmlText('a&b')).toBe('a&amp;b');
  });

  it('the feed has no em dash and names no country, city, or currency', () => {
    const xml = buildPodcastFeed(SHOW, [EPISODE]);
    expect(xml).not.toMatch(/—|–/);
    expect(xml).not.toMatch(/Nigeria|Naira|Lagos|WAT|Abuja/);
  });

  it('the feed lists at most 300 episodes', () => {
    const many = Array.from({ length: 320 }, (_, index) => ({ ...EPISODE, id: `ep-${index}` }));
    expect((buildPodcastFeed(SHOW, many).match(/<item>/g) ?? []).length).toBe(300);
  });
});
