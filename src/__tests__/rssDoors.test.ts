import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  RSS_DOORS,
  WEBSUB_HUB,
  hubPingBody,
  isRssDoor,
  nothingNewNote,
  notSentNote,
  sendRssPing,
  sentLead,
  sentVerb,
} from '../../supabase/functions/_shared/rssHub';
import { DOORS, DOOR_IDS } from '../../supabase/functions/_shared/doorRegistry';
import { OPEN_DOORS } from '../../supabase/functions/_shared/doorPosts';

const FEED = 'https://lixxonstudio.example/rss.xml';
const read = (path: string) => readFileSync(resolve(__dirname, '../../', path), 'utf8');

type Call = { url: string; method: string; body: string; contentType: string | null };

/** A fake ping: records each call, answers with the given status, or throws when asked to. */
function fakeHub(answer: 'ok' | 'refuse' | 'throw') {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    calls.push({ url, method: String(init.method), body: String(init.body), contentType: headers.get('Content-Type') });
    if (answer === 'throw') throw new Error('network down');
    return new Response(null, { status: answer === 'ok' ? 204 : 500 });
  });
  return { fetchImpl, calls };
}

describe('the four RSS doors are in the registry, with no secret and the same open list', () => {
  it('Flipboard, Google News, Microsoft Start and SmartNews are RSS doors, and nothing else is', () => {
    expect([...RSS_DOORS]).toEqual(['flipboard', 'google_news', 'microsoft_start', 'smartnews']);
    for (const door of RSS_DOORS) {
      expect(isRssDoor(door)).toBe(true);
      expect(DOOR_IDS as readonly string[]).toContain(door);
      expect(OPEN_DOORS as readonly string[]).toContain(door);
      expect(DOORS[door].fields).toHaveLength(0);
    }
    expect(isRssDoor('telegram')).toBe(false);
    expect(isRssDoor('instagram')).toBe(false);
  });

  it('the registry lists sixteen auto doors and the four gated channels are still not doors', () => {
    expect(OPEN_DOORS).toHaveLength(16);
    for (const channel of ['instagram', 'tiktok', 'facebook', 'pinterest']) {
      expect(DOOR_IDS as readonly string[]).not.toContain(channel);
      expect(OPEN_DOORS as readonly string[]).not.toContain(channel);
    }
  });
});

describe('the ping is a WebSub publish for the site feed', () => {
  it('the body names publish and the feed address, and nothing else', () => {
    expect(hubPingBody(FEED)).toBe('hub.mode=publish&hub.url=https%3A%2F%2Flixxonstudio.example%2Frss.xml');
  });

  it('a 204 from the hub is a sent ping, and the call goes to the hub as a form POST', async () => {
    const { fetchImpl, calls } = fakeHub('ok');
    const result = await sendRssPing(FEED, fetchImpl);
    expect(result).toEqual({ ok: true, externalRef: null });
    expect(calls).toEqual([{ url: WEBSUB_HUB, method: 'POST', body: hubPingBody(FEED), contentType: 'application/x-www-form-urlencoded' }]);
  });

  it('a refusal from the hub is a plain reason with the status, and the feed address is not echoed', async () => {
    const { fetchImpl } = fakeHub('refuse');
    const result = await sendRssPing(FEED, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'The RSS hub did not take the ping (status 500).' });
    expect(JSON.stringify(result)).not.toContain('lixxonstudio.example');
  });

  it('a network failure is a plain reason, never a stack trace', async () => {
    const { fetchImpl } = fakeHub('throw');
    const result = await sendRssPing(FEED, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'The RSS hub could not be reached.' });
  });

  it('no site address, or an address that is not the feed, is refused before any call is made', async () => {
    for (const bad of ['', 'http://lixxonstudio.example/rss.xml', 'https://lixxonstudio.example/feed.xml', 'https://lixxonstudio.example/rss.xml?x=1']) {
      const { fetchImpl, calls } = fakeHub('ok');
      const result = await sendRssPing(bad, fetchImpl);
      expect(result.ok, bad).toBe(false);
      expect(calls, bad).toHaveLength(0);
    }
  });
});

describe('the RSS doors never say posted in their log lines', () => {
  it('an RSS door is pinged, and every other door is posted', () => {
    expect(sentVerb('flipboard')).toBe('pinged');
    expect(sentVerb('telegram')).toBe('posted');
  });

  it('the success line reads "RSS updated and pinged for Flipboard"', () => {
    expect(sentLead('flipboard', 'Flipboard')).toBe('RSS updated and pinged for Flipboard');
    expect(sentLead('smartnews', 'SmartNews')).toBe('RSS updated and pinged for SmartNews');
    expect(sentLead('telegram', 'Telegram')).toBe('Posted to Telegram');
  });

  it('the skip and failure notes say pinged for RSS doors, and posted for the rest', () => {
    expect(notSentNote('google_news')).toBe('Nothing was pinged.');
    expect(nothingNewNote('microsoft_start')).toBe('Nothing new was pinged.');
    expect(notSentNote('discord')).toBe('Nothing was posted.');
    expect(nothingNewNote('discord')).toBe('Nothing new was posted.');
  });
});

describe('the site feed declares the hub, so the hub knows where to fetch', () => {
  it('the RSS channel links the hub and keeps its own self link', () => {
    const feeds = read('supabase/functions/feeds/index.ts');
    expect(feeds).toContain('import { WEBSUB_HUB } from "../_shared/rssHub.ts";');
    expect(feeds).toContain('rel="hub"');
    expect(feeds).toContain('rel="self"');
  });
});

describe('the day run sends the RSS doors by ping and keeps them out of the posted count', () => {
  const RUN = read('supabase/functions/minds-run-placement/index.ts');

  it('the send step pings the feed for each RSS door, using the site address from settings', () => {
    expect(RUN).toContain('if (isRssDoor(door)) {');
    expect(RUN).toContain('return sendRssPing(site ? `${site}/rss.xml` : "", fetch);');
  });

  it('the door notable counts real posts only, so a ping never reads as a post', () => {
    expect(RUN).toContain('const realPosts = doors.outcomes.filter((item) => item.outcome === "posted" && !isRssDoor(item.door)).length;');
    expect(RUN).toContain('if (realPosts > 0) {');
  });
});
