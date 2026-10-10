import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const RUN = read('supabase/functions/minds-run-placement/index.ts');
const DOORS_STEP = RUN.slice(RUN.indexOf('async function runDoorsSafely'), RUN.indexOf("/** Makes today's gated packs"));

describe('the free doors step is part of the day run, behind the same gates', () => {
  it('the day run calls the door step after placement and packs', () => {
    const doorsCall = RUN.indexOf('await runDoorsSafely(sb, owner, localDay, takeover, killScope, pausedDoors)');
    const packsCall = RUN.indexOf('await runPacksForDay(sb, owner, localDay, takeover, killScope, think)');
    expect(doorsCall).toBeGreaterThan(0);
    expect(packsCall).toBeGreaterThan(doorsCall);
  });

  it('the paused-door list is read only after the gate, and a missing column never stops the run', () => {
    const gate = RUN.indexOf('blockedDetail(takeover, killScope)');
    const pausedRead = RUN.indexOf('select("paused_doors")');
    expect(pausedRead).toBeGreaterThan(gate);
    expect(RUN).toContain('pausedRow.error ||');
  });

  it('the run returns early with Takeover off or Kill on, before any door is read', () => {
    const gate = RUN.indexOf('blockedDetail(takeover, killScope)');
    const doorsCall = RUN.indexOf('await runDoorsSafely(');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(doorsCall);
  });

  it('the only write path for door posts is the reserve and finish functions, service role', () => {
    expect(DOORS_STEP).toContain("sb.rpc(\"minds_reserve_door_post\"");
    expect(DOORS_STEP).toContain("sb.rpc(\"minds_finish_door_post\"");
    expect(DOORS_STEP).not.toMatch(/from\("minds_door_posts"\)\s*\.(insert|update|upsert|delete)/);
  });

  it('the door step never writes the articles', () => {
    expect(DOORS_STEP).not.toMatch(/from\("posts"\)\s*\.(insert|update|upsert|delete)/);
    // An object key named content would be a write to the article body. A word like contentType (a file type) is fine.
    expect(DOORS_STEP).not.toMatch(/\bcontent\s*:/);
  });

  it('the door step sends only through the six open adapters, and only to open doors', () => {
    expect(DOORS_STEP).toContain('sendTelegram(');
    expect(DOORS_STEP).toContain('sendDiscord(');
    expect(DOORS_STEP).toContain('sendBluesky(');
    expect(DOORS_STEP).toContain('sendMastodon(');
    expect(DOORS_STEP).toContain('sendTumblr(');
    expect(DOORS_STEP).toContain('sendBlogger(');
    expect(DOORS_STEP).not.toMatch(/instagram|tiktok|pinterest|facebook|whatsapp/i);
  });

  it('the door step also sends to Medium, WordPress.com and Pixelfed, and loads the picture only for Pixelfed', () => {
    expect(DOORS_STEP).toContain('sendMedium(');
    expect(DOORS_STEP).toContain('sendWordPressCom(');
    expect(DOORS_STEP).toContain('sendPixelfed(');
    expect(DOORS_STEP).toContain('fetchArticleImage(');
    expect(DOORS_STEP).toContain('cover_image');
  });

  it('Mastodon is sent with the reserved row id as its idempotency key', () => {
    expect(DOORS_STEP).toMatch(/sendMastodon\(\{[\s\S]*?\}, text, key, fetch\)/);
  });
});
