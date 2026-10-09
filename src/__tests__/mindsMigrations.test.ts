import { describe, expect, it } from 'vitest';
import ordersSql from '../../supabase/migrations/20261009150000_buddy_orders.sql?raw';
import dailyLogSql from '../../supabase/migrations/20261009160000_minds_daily_log.sql?raw';
import notableSql from '../../supabase/migrations/20261009170000_minds_notable_events.sql?raw';
import reportWriterSql from '../../supabase/migrations/20261009180000_buddy_night_report_writer.sql?raw';

const OWNER_RULE = 'public.is_admin() AND (public.is_owner() OR public.is_founder())';
const ALL = { ordersSql, dailyLogSql, notableSql, reportWriterSql };

describe('Minds phase 2 migrations (additive, owner only)', () => {
  it('every new table is owner-only: admin, and owner or founder', () => {
    expect(ordersSql).toContain(OWNER_RULE);
    expect(dailyLogSql).toContain(OWNER_RULE);
    expect(notableSql).toContain(OWNER_RULE);
  });

  it('no table is open to anon or the public', () => {
    for (const sql of Object.values(ALL)) {
      expect(sql).not.toMatch(/\bTO (anon|public)\b/i);
      expect(sql).not.toMatch(/GRANT [^;]*\bTO (anon|public)\b/i);
    }
    expect(ordersSql).toContain('REVOKE ALL ON public.buddy_orders FROM PUBLIC, anon');
    expect(dailyLogSql).toContain('REVOKE ALL ON public.minds_daily_log FROM PUBLIC, anon, authenticated');
    expect(notableSql).toContain('REVOKE ALL ON public.minds_notable_events FROM PUBLIC, anon');
  });

  it('the daily log cannot be written, changed or deleted from the browser', () => {
    expect(dailyLogSql).toContain('GRANT SELECT ON public.minds_daily_log TO authenticated');
    expect(dailyLogSql).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/i);
    expect(dailyLogSql).not.toMatch(/GRANT [^;]*(INSERT|UPDATE|DELETE)[^;]*minds_daily_log/i);
  });

  it('the owner can add an order only as waiting, with no reason and no done time', () => {
    expect(ordersSql).toMatch(/FOR INSERT TO authenticated[\s\S]*status = 'waiting'/);
    expect(ordersSql).toMatch(/blocked_reason IS NULL/);
    expect(ordersSql).toMatch(/done_at IS NULL/);
    expect(ordersSql).not.toMatch(/FOR UPDATE/i);
    expect(ordersSql).not.toMatch(/FOR DELETE/i);
  });

  it('an order has exactly three states, and blocked orders must say why', () => {
    expect(ordersSql).toContain("CHECK (status IN ('waiting', 'done', 'blocked'))");
    expect(ordersSql).toContain("CONSTRAINT buddy_orders_blocked_reason_check CHECK ((status = 'blocked') = (blocked_reason IS NOT NULL))");
  });

  it('the owner may only mark a notable event seen', () => {
    expect(notableSql).toContain('GRANT UPDATE (seen_at) ON public.minds_notable_events TO authenticated');
    expect(notableSql).not.toMatch(/FOR DELETE/i);
  });

  it('a Takeover or Kill change is recorded as a notable event by the database', () => {
    expect(notableSql).toContain('AFTER UPDATE ON public.minds_controls');
    expect(notableSql).toContain("'takeover_changed'");
    expect(notableSql).toContain("'kill_changed'");
    expect(notableSql).toContain('SECURITY DEFINER');
  });

  it('the night report is one per owner per day, enforced by the database', () => {
    expect(reportWriterSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS buddy_reports_one_per_owner_day ON public.buddy_reports (owner_id, report_date)');
  });

  it('no migration schedules anything, sends anything, or writes to posts or products', () => {
    for (const sql of Object.values(ALL)) {
      expect(sql).not.toMatch(/cron\./i);
      expect(sql).not.toMatch(/pg_net|net\.http|send_email|resend/i);
      expect(sql).not.toMatch(/\bposts\b/i);
      expect(sql).not.toMatch(/\bproducts\b/i);
    }
  });
});
