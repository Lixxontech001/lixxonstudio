/**
 * send-emails — drains `email_queue` in small batches (respects Resend free tier: 100/day).
 * Trigger: Supabase pg_cron + pg_net every 20 minutes. The function URL and
 * INTERNAL_FN_SECRET are read from Supabase Vault; the manual GitHub
 * workflow_dispatch workflow remains as a recovery path.
 * Also processes `product_notifications` when a product flips back to in_stock.
 */
import { json, preflight, serviceClient, sendEmail, emailShell } from "../_shared/http.ts";

const INTERNAL_SECRET = Deno.env.get("INTERNAL_FN_SECRET");
const DAILY_CAP = Number(Deno.env.get("EMAIL_DAILY_CAP") || 90);

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (!INTERNAL_SECRET || req.headers.get("x-internal-secret") !== INTERNAL_SECRET) return json({ error: "Forbidden" }, 403);
  const sb = serviceClient();

  const since = new Date(Date.now() - 864e5).toISOString();
  const { count: sentToday } = await sb.from("email_queue").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", since);
  const budget = Math.max(0, DAILY_CAP - (sentToday || 0));
  if (budget === 0) return json({ ok: true, sent: 0, reason: "daily cap reached" });

  const { data: batch } = await sb.from("email_queue").select("*").eq("status", "queued").lte("scheduled_for", new Date().toISOString()).lt("attempts", 3).order("id").limit(Math.min(budget, 25));
  let sent = 0, failed = 0;
  for (const m of batch || []) {
    const ok = await sendEmail({ to: m.to_email, subject: m.subject, html: emailShell(m.subject, m.html) });
    await sb.from("email_queue").update({ status: ok ? "sent" : (m.attempts + 1 >= 3 ? "failed" : "queued"), attempts: m.attempts + 1, sent_at: ok ? new Date().toISOString() : null }).eq("id", m.id);
    if (ok) sent++; else failed++;
  }
  return json({ ok: true, sent, failed, remaining_budget: budget - sent });
});
