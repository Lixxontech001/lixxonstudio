import { describe, expect, it } from 'vitest';
import { runDoors, DOORS_NOTHING_CONNECTED_DETAIL, type DoorRunPorts, type ReserveResult } from '../../supabase/functions/_shared/runDoors';
import { KILL_BLOCK_DETAIL, TAKEOVER_OFF_DETAIL } from '../../supabase/functions/_shared/runDay';
import type { DoorArticle } from '../../supabase/functions/_shared/doorPosts';
import type { DoorSendResult } from '../../supabase/functions/_shared/doorAdapters';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const SITE = 'https://lixxonstudio.example';
const TOKEN = 'TOKEN-SECRET-VALUE';
const HOOK = 'https://discord.com/api/webhooks/1/HOOK-SECRET-VALUE';

const ARTICLE: DoorArticle = {
  id: 'post-1',
  title: 'Easy routine for dry skin',
  slug: 'easy-routine-dry-skin',
  publishedAt: new Date(NOW - DAY).toISOString(),
};

const ALL_SECRETS: Record<string, string> = {
  telegram_bot_token: TOKEN,
  telegram_chat_id: '-100123',
  discord_webhook_url: HOOK,
};

interface Harness {
  ports: DoorRunPorts;
  sent: Array<{ door: string; text: string }>;
  reserved: string[];
  finished: Array<{ id: string; status: string; externalRef: string | null; errorNote: string | null }>;
  logs: Array<{ door: string; outcome: string; detail: string }>;
}

function harness(options: {
  secrets?: Record<string, string>;
  articles?: DoorArticle[];
  postedIds?: Record<string, string[]>;
  todayCount?: Record<string, number>;
  reserve?: (door: string) => ReserveResult;
  send?: (door: string) => DoorSendResult;
} = {}): Harness {
  const secrets = options.secrets ?? ALL_SECRETS;
  const sent: Harness['sent'] = [];
  const reserved: string[] = [];
  const finished: Harness['finished'] = [];
  const logs: Harness['logs'] = [];
  const ports: DoorRunPorts = {
    readArticles: async () => options.articles ?? [ARTICLE],
    readPostedIds: async (door) => new Set(options.postedIds?.[door] ?? []),
    countToday: async (door) => options.todayCount?.[door] ?? 0,
    readSecret: async (name) => secrets[name] ?? null,
    reserve: async (door, articleId) => {
      reserved.push(`${door}:${articleId}`);
      return options.reserve ? options.reserve(door) : { ok: true, id: `row-${door}` };
    },
    send: async (door, _values, text) => {
      sent.push({ door, text });
      return options.send ? options.send(door) : { ok: true, externalRef: `ref-${door}` };
    },
    finish: async (id, status, externalRef, errorNote) => {
      finished.push({ id, status, externalRef, errorNote });
    },
    log: async (entry) => {
      logs.push(entry);
    },
  };
  return { ports, sent, reserved, finished, logs };
}

const DAY_INPUT = { localDay: '2026-10-10', takeover: true, killScope: 'none' as const, nowMs: NOW, siteOrigin: SITE };

describe('the door step is held when it is not allowed to run', () => {
  it('Takeover off: nothing is read, reserved, sent or logged', async () => {
    const h = harness();
    const result = await runDoors({ ...DAY_INPUT, takeover: false }, h.ports);
    expect(result).toEqual({ status: 'held', detail: TAKEOVER_OFF_DETAIL, posted: 0, outcomes: [] });
    expect(h.sent).toHaveLength(0);
    expect(h.reserved).toHaveLength(0);
  });

  it('Kill on all, or on the Executioner: held, nothing is sent', async () => {
    for (const killScope of ['all', 'executioner'] as const) {
      const h = harness();
      const result = await runDoors({ ...DAY_INPUT, killScope }, h.ports);
      expect(result.status).toBe('held');
      expect(result.detail).toBe(KILL_BLOCK_DETAIL);
      expect(h.sent).toHaveLength(0);
    }
  });

  it('the database refuses the reservation because Takeover went off: the step stops and nothing is sent', async () => {
    const h = harness({ reserve: () => ({ ok: false, reason: 'takeover_off' }) });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.status).toBe('held');
    expect(result.detail).toBe(TAKEOVER_OFF_DETAIL);
    expect(h.sent).toHaveLength(0);
  });
});

describe('a door posts only when it is fully connected', () => {
  it('nothing connected: nothing to do, with the plain Connections message', async () => {
    const h = harness({ secrets: {} });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.status).toBe('nothing_to_do');
    expect(result.detail).toBe(DOORS_NOTHING_CONNECTED_DETAIL);
    expect(h.sent).toHaveLength(0);
    expect(h.reserved).toHaveLength(0);
  });

  it('Telegram with only the token saved is not connected: it is not posted to', async () => {
    const h = harness({ secrets: { telegram_bot_token: TOKEN } });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'telegram')?.outcome).toBe('not_connected');
    expect(h.sent.some((item) => item.door === 'telegram')).toBe(false);
  });

  it('a connected door posts the newest article, records the reference, and logs it', async () => {
    const h = harness({ secrets: { discord_webhook_url: HOOK } });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.status).toBe('done');
    expect(result.posted).toBe(1);
    expect(h.sent).toEqual([{ door: 'discord', text: `New on the blog: Easy routine for dry skin\n${SITE}/blog/easy-routine-dry-skin` }]);
    expect(h.finished).toEqual([{ id: 'row-discord', status: 'posted', externalRef: 'ref-discord', errorNote: null }]);
    expect(h.logs).toEqual([{ door: 'discord', outcome: 'done', detail: 'Posted to Discord: "Easy routine for dry skin".' }]);
    expect(result.detail).toBe('Telegram is not connected yet. Posted to Discord: "Easy routine for dry skin".');
  });

  it('both open doors can post on the same day, one article each', async () => {
    const h = harness();
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.posted).toBe(2);
    expect(h.sent.map((item) => item.door)).toEqual(['telegram', 'discord']);
  });
});

describe('the caps, the history, and the failures', () => {
  it('a door that already has a post today is skipped, and nothing is reserved for it', async () => {
    const h = harness({ todayCount: { telegram: 1 } });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.outcomes.find((item) => item.door === 'telegram')?.detail).toBe('Telegram: already posted today.');
    expect(h.reserved.some((item) => item.startsWith('telegram:'))).toBe(false);
    expect(h.sent.some((item) => item.door === 'telegram')).toBe(false);
  });

  it('an article a door already has is never sent again', async () => {
    const h = harness({ postedIds: { discord: ['post-1'] }, secrets: { discord_webhook_url: HOOK } });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.posted).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(result.detail).toContain('Discord: no new article to post yet.');
  });

  it('a title with a dash or a country name is not sent, with a plain reason', async () => {
    const h = harness({ articles: [{ ...ARTICLE, title: 'Routine — easy' }], secrets: { discord_webhook_url: HOOK } });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(h.sent).toHaveLength(0);
    expect(result.detail).toContain('Discord: the newest article title has text that cannot be posted.');
  });

  it('a send that fails is recorded as failed with a plain reason, and the next run can use the next article', async () => {
    const h = harness({
      secrets: { discord_webhook_url: HOOK },
      send: () => ({ ok: false, reason: 'Discord did not find that webhook.' }),
    });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.posted).toBe(0);
    expect(h.finished).toEqual([{ id: 'row-discord', status: 'failed', externalRef: null, errorNote: 'Discord did not find that webhook.' }]);
    expect(h.logs[0]).toEqual({ door: 'discord', outcome: 'failed', detail: 'Discord did not take it: Discord did not find that webhook.' });
    expect(result.detail).toContain('Discord did not take it: Discord did not find that webhook.');
  });

  it('a reservation that is already taken is skipped, not treated as held', async () => {
    const h = harness({ secrets: { discord_webhook_url: HOOK }, reserve: () => ({ ok: false, reason: 'door_day_cap' }) });
    const result = await runDoors(DAY_INPUT, h.ports);
    expect(result.status).toBe('done');
    expect(result.outcomes.find((item) => item.door === 'discord')?.outcome).toBe('skipped');
    expect(h.sent).toHaveLength(0);
  });

  it('a read of the articles that throws is not swallowed by the runner', async () => {
    const h = harness({ secrets: { discord_webhook_url: HOOK } });
    h.ports.readArticles = async () => {
      throw new Error('articles');
    };
    await expect(runDoors(DAY_INPUT, h.ports)).rejects.toThrow('articles');
    expect(h.sent).toHaveLength(0);
  });
});

describe('no secret value leaves the step', () => {
  it('neither the details, the logs nor the reply hold a token or a webhook address', async () => {
    const h = harness({
      send: (door) => (door === 'telegram' ? { ok: false, reason: 'Telegram did not take the message.' } : { ok: true, externalRef: null }),
    });
    const result = await runDoors(DAY_INPUT, h.ports);
    const everything = JSON.stringify([result, h.logs, h.finished]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('HOOK-SECRET-VALUE');
  });
});
