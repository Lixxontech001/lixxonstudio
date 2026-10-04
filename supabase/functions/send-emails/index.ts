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
  let sent = 0, failed = 0, skipped = 0;
  for (const m of batch || []) {
    let restock: { productId: string; alertId: string } | null = null;
    if (m.kind === "restock") {
      const match = /^restock:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(String(m.dedupe_key || ""));
      if (!match) {
        await sb.from("email_queue").update({ status: "skipped" }).eq("id", m.id);
        skipped++;
        continue;
      }
      const [, productId, alertId] = match;
      const [{ data: alert, error: alertError }, { data: product, error: productError }] = await Promise.all([
        sb.from("product_notifications").select("email, consented_at, notified_at").eq("product_id", productId).eq("alert_id", alertId).maybeSingle(),
        sb.from("products").select("is_active, stock_status").eq("id", productId).maybeSingle(),
      ]);
      if (alertError || productError) {
        console.error("restock queue validation failed", alertError?.message, productError?.message);
        failed++;
        continue;
      }
      if (!alert || alert.email.toLowerCase() !== String(m.to_email).toLowerCase() || !alert.consented_at || alert.notified_at
          || !product?.is_active || !["in_stock", "low"].includes(product.stock_status)) {
        await sb.from("email_queue").update({ status: "skipped" }).eq("id", m.id);
        skipped++;
        continue;
      }
      restock = { productId, alertId };
    }

    const ok = await sendEmail({ to: m.to_email, subject: m.subject, html: emailShell(m.subject, m.html) });
    await sb.from("email_queue").update({ status: ok ? "sent" : (m.attempts + 1 >= 3 ? "failed" : "queued"), attempts: m.attempts + 1, sent_at: ok ? new Date().toISOString() : null }).eq("id", m.id);
    if (ok) {
      if (restock) {
        const { error } = await sb.from("product_notifications").update({ notified_at: new Date().toISOString() })
          .eq("product_id", restock.productId).eq("alert_id", restock.alertId).is("notified_at", null);
        if (error) console.error("restock alert delivery status failed", error.message);
      }
      sent++;
    } else failed++;
  }
  return json({ ok: true, sent, failed, skipped, remaining_budget: Math.max(0, budget - sent) });
});
