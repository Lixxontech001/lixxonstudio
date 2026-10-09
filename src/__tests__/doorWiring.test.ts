import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const RUN = read('supabase/functions/minds-run-placement/index.ts');
const DOORS_STEP = RUN.slice(RUN.indexOf('async function runDoorsSafely'), RUN.indexOf("/** Makes today's gated packs"));

describe('the free doors step is part of the day run, behind the same gates', () => {
  it('the day run calls the door step after placement and packs', () => {
    const doorsCall = RUN.indexOf('await runDoorsSafely(sb, owner, localDay, takeover, killScope)');
    const packsCall = RUN.indexOf('await runPacksForDay(sb, owner, localDay, takeover, killScope, think)');
    expect(doorsCall).toBeGreaterThan(0);
    expect(packsCall).toBeGreaterThan(doorsCall);
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
    expect(DOORS_STEP).not.toContain('content');
  });

  it('the door step sends only through the two open adapters, and only to open doors', () => {
    expect(DOORS_STEP).toContain('sendTelegram(');
    expect(DOORS_STEP).toContain('sendDiscord(');
    expect(DOORS_STEP).not.toMatch(/instagram|tiktok|pinterest|facebook|whatsapp/i);
  });
});
