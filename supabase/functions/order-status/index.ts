/**
 * order-status — public order tracking without exposing PII.
 * POST { order_number, email } → { status, payment_status, created_at, items:[{name, qty}] }
 * Both fields must match; rate-limited; never returns download tokens (those need sign-in).
 */
import { json, preflight, serviceClient, clientIp, rateLimit, normEmail, cleanText } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const sb = serviceClient();
  if (!(await rateLimit(sb, clientIp(req), "order_status", 10, 600))) return json({ error: "Too many lookups. Try again in a few minutes." }, 429);
  const body = await req.json().catch(() => ({}));
  const orderNumber = cleanText(body.order_number, 40).toUpperCase();
  const email = normEmail(body.email);
  if (!orderNumber || !email) return json({ error: "Enter your order number and email." }, 400);
  const { data: order } = await sb.from("orders")
    .select("order_number, status, payment_status, amount, currency, created_at, paid_at, items:order_items(product_name, quantity)")
    .eq("order_number", orderNumber).ilike("customer_email", email).maybeSingle();
  if (!order) return json({ error: "No order found with those details." }, 404);
  return json({ ok: true, order });
});
