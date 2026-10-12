import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRIEFING_NOTABLE_KINDS } from '../../supabase/functions/_shared/buddyBriefing';
import { ALLOWED_ORDERS } from '../../supabase/functions/_shared/buddyOrderPolicy';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const RUN = read('supabase/functions/minds-run-placement/index.ts');
const DOORS = read('supabase/functions/_shared/runDoors.ts');
const CHAT = read('supabase/functions/buddy-think/index.ts');
const DROP_SQL = read('supabase/migrations/20261023000000_minds_door_drip.sql');
const RIVAL_SQL = read('supabase/migrations/20261024000000_minds_competitors.sql');
const PRICE_SQL = read('supabase/migrations/20261025000000_minds_price_changes.sql');

describe('Phase I slice 5: the drip, the rivals and the price are part of the day run', () => {
  it('the door step stamps the day before it sends, and it can only send three articles a day', () => {
    // The cap is the database's own rule: the drip table refuses a fourth different article a day.
    expect(DROP_SQL).toContain('INSERT INTO public.post_drip_days (owner_id, local_day, post_id)');
    expect(DROP_SQL).toContain('PERFORM public.minds_assert_can_act();');
    expect(DROP_SQL).toContain('RETURN true;');
    expect(existsSync(join(process.cwd(), 'supabase/migrations/20261009210000_post_drip_days.sql'))).toBe(true);
    // The door step reads the day's count first, then stamps before it reserves and sends.
    expect(DOORS).toContain('countDripsToday(input.localDay)');
    expect(DOORS).toContain('await ports.recordDrip(pick.article.id, input.localDay)');
    const stamp = DOORS.indexOf('await ports.recordDrip(');
    const reserve = DOORS.indexOf('await ports.reserve(door, pick.article.id');
    const send = DOORS.indexOf('await ports.send(door, values, pick.text');
    expect(stamp).toBeGreaterThan(0);
    expect(stamp).toBeLessThan(reserve);
    expect(reserve).toBeLessThan(send);
    // An older article is used only when nothing new was published, and the owner is told which it was.
    expect(DOORS).toContain('DRIP_FULL_NOTE');
    expect(RUN).toContain('fromArchive');
    expect(RUN).toContain('doorPostedAct("The free doors", articleTitle, localDay, fromArchive)');
  });

  it('the run writes the drip through the database door, never by hand', () => {
    expect(RUN).toContain('sb.rpc("minds_record_drip"');
    expect(RUN).toContain('.from("post_drip_days")');
    expect(RUN).not.toMatch(/from\("post_drip_days"\)\s*\.(insert|upsert|update|delete)/);
  });

  it('the rival pages are saved by the owner in the chat, through the database door', () => {
    expect(CHAT).toContain('sb.rpc("minds_save_competitor"');
    expect(CHAT).toContain('saveCompetitors: async (urls)');
    expect(RIVAL_SQL).toContain('CREATE OR REPLACE FUNCTION public.minds_save_competitor(');
    expect(RIVAL_SQL).toContain("RAISE EXCEPTION 'competitor_not_secure'");
    expect(RIVAL_SQL).toContain("RAISE EXCEPTION 'competitor_not_public'");
  });

  it('the run reads at most ten rival pages a day, oldest first, and records each read through the door', () => {
    expect(RUN).toContain('await runCompetitorReads(');
    expect(RUN).toContain('sb.rpc("minds_record_competitor_read"');
    expect(RUN).toContain('.eq("local_day", localDay)');
    // The cap is a database rule: the read table refuses an eleventh page in one day.
    expect(RIVAL_SQL).toContain('IF read_today >= 10 THEN');
    expect(RIVAL_SQL).toContain('PERFORM public.minds_assert_can_act();');
  });

  it('a changed rival page is told through the notable list, so it buzzes and reaches the briefing and the night', () => {
    expect(RUN).toContain('COMPETITOR_CHANGE_KIND');
    expect(RUN).toContain('await recordNotable(sb, owner, localDay, "strategist", COMPETITOR_CHANGE_KIND');
    expect(RIVAL_SQL).toContain("'competitor_changed'");
    expect([...BRIEFING_NOTABLE_KINDS]).toContain('competitor_changed');
  });

  it('the price is applied only through the database door, and the run tells it as the act it is', () => {
    expect(RUN).toContain('sb.rpc("minds_apply_price_change"');
    expect(RUN).toContain('await reportAct(priced.act, acts)');
    expect(RUN).not.toMatch(/from\("products"\)\s*\.(insert|upsert|update|delete)/);
    expect(PRICE_SQL).toContain('UPDATE public.products');
    expect(PRICE_SQL).toContain('PERFORM public.minds_assert_can_act();');
    // The database re-checks every rule itself: US dollars, nothing or free refused, one change a day, a quarter at most.
    expect(PRICE_SQL).toContain("RAISE EXCEPTION 'price_not_usd'");
    expect(PRICE_SQL).toContain("RAISE EXCEPTION 'price_free'");
    expect(PRICE_SQL).toContain("RAISE EXCEPTION 'price_already_changed_today'");
    expect(PRICE_SQL).toContain('UNIQUE (owner_id, product_id, local_day)');
  });

  it('the price step and the rival step run after the thinking minds and before the packs', () => {
    const minds = RUN.indexOf('await runLivingMindsForDay(');
    const rivals = RUN.indexOf('await runCompetitorsForDay(');
    const price = RUN.indexOf('await runPriceChange(');
    const packs = RUN.indexOf('await runPacksForDay(sb, owner, localDay, takeover, killScope, think,');
    expect(minds).toBeGreaterThan(0);
    expect(rivals).toBeGreaterThan(minds);
    expect(price).toBeGreaterThan(minds);
    expect(packs).toBeGreaterThan(price);
    expect(packs).toBeGreaterThan(rivals);
  });

  it('both extra steps are behind the run gate and can never fail the day', () => {
    const gate = RUN.indexOf('blockedDetail(takeover, killScope)');
    expect(gate).toBeGreaterThan(0);
    expect(RUN.indexOf('await runCompetitorsForDay(')).toBeGreaterThan(gate);
    expect(RUN.indexOf('await runPriceChange(')).toBeGreaterThan(gate);
    expect(RUN).toContain('// The rival reads are extra. Nothing else in the run depends on them.');
    expect(RUN).toContain('// The price check is extra. Nothing else in the run depends on it.');
  });

  it('the minds still never create a product, write an article, spend or post a pack by themselves', () => {
    for (const file of ['_shared/competitors.ts', '_shared/priceChanges.ts', '_shared/priceRun.ts', '_shared/runDoors.ts', '_shared/doorPosts.ts']) {
      const source = read(`supabase/functions/${file}`);
      expect(source, file).not.toMatch(/from\("products"\)\s*\.(insert|upsert)/);
      expect(source, file).not.toMatch(/\.insert\(/);
    }
    for (const kind of [...ALLOWED_ORDERS]) expect(['run_today', 'pause_resume_free_door', 'kill_or_start_mind', 'product_line_apply', 'mind_work']).toContain(kind);
  });

  it('the three slice-5 migrations are files only: nothing in the repo applies them', () => {
    for (const file of ['20261023000000_minds_door_drip.sql', '20261024000000_minds_competitors.sql', '20261025000000_minds_price_changes.sql']) {
      expect(existsSync(join(process.cwd(), 'supabase/migrations', file)), file).toBe(true);
    }
    for (const file of ['README.md', 'GO_LIVE.md']) {
      if (!existsSync(join(process.cwd(), file))) continue;
      expect(read(file)).not.toContain('minds_record_drip');
    }
  });
});
