/**
 * verify-payment — confirms a Flutterwave charge and fulfils the order.
 *
 * Three entry points, all converging on fulfilOrder():
 *   A. Browser callback   POST { transaction_id, tx_ref, order_id }
 *      → verifies with Flutterwave; amount/currency compared to orders.amount (DB), NOT the client.
 *   B. Flutterwave webhook POST with `verif-hash` header (set FLW_WEBHOOK_HASH)
 *      → same verification; makes fulfilment reliable even if the buyer closes the tab.
 *   C. Internal           POST { internal_fulfil: true, order_id } + x-internal-secret
 *      → for $0 orders fully covered by promo/gift card (called by create-order).
 *
 * Idempotent: a paid order returns its existing entitlements and never double-fulfils.
 */
import { json, preflight, serviceClient, sendEmail, emailShell, escapeHtml, siteUrl, clientIp, rateLimit } from "../_shared/http.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

interface Entitlement { product_id: string; product_name: string; download_token: string }

const FLW_SECRET = Deno.env.get("FLW_SECRET_KEY");
const FLW_WEBHOOK_HASH = Deno.env.get("FLW_WEBHOOK_HASH");
const INTERNAL_SECRET = Deno.env.get("INTERNAL_FN_SECRET");

async function existingEntitlements(sb: SupabaseClient, orderId: string): Promise<Entitlement[]> {
  const { data } = await sb
    .from("download_entitlements")
    .select("download_token, product_id, product:products(name)")
    .eq("order_id", orderId);
  // deno-lint-ignore no-explicit-any
  return ((data || []) as { product_id: string; product?: { name?: string } | null; download_token: string }[]).map((e) => ({ product_id: e.product_id, product_name: e.product?.name || "Digital product", download_token: e.download_token }));
}

async function fulfilOrder(sb: SupabaseClient, orderId: string, paymentRef: string | null, provider: string, viaWebhook: boolean) {
  const { data: order } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false as const, status: 404, error: "Order not found" };

  // idempotency — only the first caller flips pending → paid
  const { data: flipped } = await sb
    .from("orders")
    .update({
      payment_status: "paid", status: "fulfilled", payment_reference: paymentRef, payment_provider: provider,
      paid_at: new Date().toISOString(), webhook_verified: viaWebhook, updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .neq("payment_status", "paid")
    .select("id")
    .maybeSingle();

  if (!flipped) {
    if (viaWebhook) await sb.from("orders").update({ webhook_verified: true }).eq("id", orderId);
    return { ok: true as const, order, entitlements: await existingEntitlements(sb, orderId), already: true };
  }

  const { data: items } = await sb.from("order_items").select("product_id, quantity").eq("order_id", orderId);
  const ids = (items || []).map((i) => i.product_id).filter(Boolean);
  const { data: products } = ids.length
    ? await sb.from("products").select("id, name, file_path, is_digital, product_type").in("id", ids)
    : { data: [] };

  const entitlements: Entitlement[] = [];
  const rows = [];
  for (const item of items || []) {
    const p = (products || []).find((x) => x.id === item.product_id);
    if (!p || !(p.is_digital || p.product_type === "digital") || !p.file_path) continue;
    const token = crypto.randomUUID();
    rows.push({
      order_id: orderId, customer_email: order.customer_email, product_id: p.id, file_path: p.file_path,
      download_token: token, download_count: 0, max_downloads: 5 * Math.max(1, item.quantity || 1),
      expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
    });
    entitlements.push({ product_id: p.id, product_name: p.name, download_token: token });
  }
  if (rows.length) await sb.from("download_entitlements").insert(rows);

  // gift-card purchase → issue the card and email the recipient
  const gift = order.meta?.gift_card;
  if (gift && Number(gift.amount) > 0) {
    const code = `LXG-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase().match(/.{1,4}/g)!.join("-")}`;
    const { error: gErr } = await sb.from("gift_cards").insert({
      code, initial_balance: gift.amount, balance: gift.amount, buyer_email: order.customer_email,
      recipient_email: gift.recipient_email, message: gift.message || null, is_active: true, order_id: orderId,
      expires_at: new Date(Date.now() + 365 * 864e5).toISOString(), delivered_at: new Date().toISOString(),
    });
    if (!gErr) {
      await sendEmail({
        to: gift.recipient_email,
        subject: `${order.customer_name || "Someone"} sent you a Lixxon Studio gift card`,
        html: emailShell(`A gift for you${gift.recipient_name ? `, ${escapeHtml(gift.recipient_name)}` : ""}`, `
          <p>${escapeHtml(order.customer_name || order.customer_email)} sent you a <strong>${order.currency} ${Number(gift.amount).toFixed(2)}</strong> gift card.</p>
          ${gift.message ? `<blockquote style="border-left:3px solid #C48B71;margin:16px 0;padding:8px 16px;color:#2D2D2D;font-style:italic;">${escapeHtml(gift.message)}</blockquote>` : ""}
          <p style="font-size:22px;letter-spacing:.15em;font-family:monospace;background:#F2EDE7;padding:16px;text-align:center;">${code}</p>
          <p>Enter this code at checkout on <a href="${siteUrl()}/shop" style="color:#A87056;">${siteUrl().replace(/^https?:\/\//, "")}/shop</a>. Valid for 12 months.</p>`),
      });
    }
  }

  // mark gift card as delivered if this order bought one (handled by gift-card function), clear abandoned cart
  await sb.from("abandoned_carts").update({ recovered: true }).eq("email", order.customer_email).eq("recovered", false);

  // receipt + download email (Resend free tier; silently skipped if not configured)
  const site = siteUrl();
  const list = entitlements.map((e) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #E8DFD8;">${escapeHtml(e.product_name)}</td>
     <td style="padding:10px 0;border-bottom:1px solid #E8DFD8;text-align:right;"><a href="${site}/account/downloads?token=${e.download_token}" style="color:#A87056;font-weight:600;">Download →</a></td></tr>`
  ).join("");
  await sendEmail({
    to: order.customer_email,
    subject: `Your receipt — Order ${order.order_number}`,
    html: emailShell(`Thank you, ${order.customer_name || "there"}.`, `
      <p>Order <strong>${escapeHtml(order.order_number)}</strong> is confirmed.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#5A5A5A;">Subtotal</td><td style="text-align:right;">${order.currency} ${Number(order.subtotal ?? order.amount).toFixed(2)}</td></tr>
        ${Number(order.discount_amount) > 0 ? `<tr><td style="padding:6px 0;color:#5A5A5A;">Discount${order.promo_code ? ` (${escapeHtml(order.promo_code)})` : ""}</td><td style="text-align:right;">− ${order.currency} ${Number(order.discount_amount).toFixed(2)}</td></tr>` : ""}
        ${Number(order.gift_card_amount) > 0 ? `<tr><td style="padding:6px 0;color:#5A5A5A;">Gift card</td><td style="text-align:right;">− ${order.currency} ${Number(order.gift_card_amount).toFixed(2)}</td></tr>` : ""}
        <tr><td style="padding:10px 0;font-weight:600;border-top:1px solid #1A1A1A;">Paid</td><td style="text-align:right;font-weight:600;border-top:1px solid #1A1A1A;">${order.currency} ${Number(order.amount).toFixed(2)}</td></tr>
      </table>
      ${entitlements.length ? `<h3 style="font-weight:500;margin:24px 0 8px;">Your downloads</h3><table style="width:100%;border-collapse:collapse;">${list}</table>
      <p style="color:#5A5A5A;font-size:13px;">Each link allows 5 downloads and expires in 30 days. Sign in at <a href="${site}/account" style="color:#A87056;">${site.replace(/^https?:\/\//, "")}/account</a> with this email any time to download again.</p>` : ""}
    `),
  });

  return { ok: true as const, order, entitlements, already: false };
}

async function verifyWithFlutterwave(transactionId: string) {
  const r = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
    headers: { Authorization: `Bearer ${FLW_SECRET}`, "Content-Type": "application/json" },
  });
  const data = await r.json().catch(() => null);
  return data && data.status === "success" ? data.data : null;
}

/** Shared check: FLW tx must match the DB order exactly. */
async function settle(sb: SupabaseClient, orderId: string, transactionId: string, viaWebhook: boolean) {
  const { data: order } = await sb.from("orders").select("id, order_number, amount, currency, payment_status").eq("id", orderId).maybeSingle();
  if (!order) return json({ verified: false, error: "Order not found" }, 404);
  if (order.payment_status === "paid") {
    const r = await fulfilOrder(sb, orderId, String(transactionId), "flutterwave", viaWebhook);
    return json({ verified: true, status: "success", already_paid: true, entitlements: r.ok ? r.entitlements : [], order_number: order.order_number });
  }
  if (!FLW_SECRET) return json({ verified: false, error: "Payment verification not configured (FLW_SECRET_KEY)." }, 503);

  const tx = await verifyWithFlutterwave(transactionId);
  const fail = async (reason: string, status = "failed") => {
    await sb.from("orders").update({ payment_status: status, status: "failed", payment_reference: String(transactionId) }).eq("id", orderId).neq("payment_status", "paid");
    return json({ verified: false, error: reason, status }, 400);
  };
  if (!tx) return fail("Flutterwave could not verify this transaction");
  if (tx.status !== "successful") return fail(`Transaction ${tx.status}`, tx.status === "cancelled" ? "cancelled" : "failed");
  if (tx.tx_ref !== order.order_number) return fail("Transaction reference mismatch");
  if (Math.abs(parseFloat(tx.amount) - Number(order.amount)) > 0.009) return fail("Amount mismatch");
  if (String(tx.currency).toUpperCase() !== String(order.currency).toUpperCase()) return fail("Currency mismatch");

  const r = await fulfilOrder(sb, orderId, String(tx.id ?? transactionId), "flutterwave", viaWebhook);
  if (!r.ok) return json({ verified: false, error: r.error }, r.status);
  return json({ verified: true, status: "success", order_id: orderId, order_number: r.order.order_number, customer_email: r.order.customer_email, entitlements: r.entitlements });
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const sb = serviceClient();

  // ---- B. Flutterwave webhook
  const verifHash = req.headers.get("verif-hash");
  if (verifHash) {
    if (!FLW_WEBHOOK_HASH || verifHash !== FLW_WEBHOOK_HASH) return json({ error: "Invalid webhook signature" }, 401);
    const payload = await req.json().catch(() => null);
    const data = payload?.data ?? payload;
    const txRef = data?.tx_ref || data?.txRef;
    const txId = data?.id;
    if (!txRef || !txId) return json({ received: true, ignored: "no tx_ref" });
    const { data: order } = await sb.from("orders").select("id").eq("order_number", txRef).maybeSingle();
    if (!order) return json({ received: true, ignored: "unknown order" });
    const res = await settle(sb, order.id, String(txId), true);
    return json({ received: true, result: await res.json() });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ verified: false, error: "Invalid JSON" }, 400); }

  // ---- C. internal fulfilment of $0 orders
  if (body.internal_fulfil === true) {
    if (!INTERNAL_SECRET || req.headers.get("x-internal-secret") !== INTERNAL_SECRET) return json({ error: "Forbidden" }, 403);
    const { data: order } = await sb.from("orders").select("id, amount").eq("id", String(body.order_id)).maybeSingle();
    if (!order || Number(order.amount) !== 0) return json({ error: "Not a zero-amount order" }, 400);
    const r = await fulfilOrder(sb, order.id, null, "promo_or_gift_card", false);
    return r.ok ? json({ verified: true, entitlements: r.entitlements }) : json({ error: r.error }, r.status);
  }

  // ---- A. browser callback
  const ok = await rateLimit(sb, clientIp(req), "verify_payment", 30, 600);
  if (!ok) return json({ verified: false, error: "Too many attempts" }, 429);
  const { transaction_id, order_id } = body as { transaction_id?: string | number; order_id?: string };
  if (!transaction_id || !order_id || !/^[0-9a-f-]{36}$/i.test(String(order_id))) return json({ verified: false, error: "Missing required fields" }, 400);
  return settle(sb, String(order_id), String(transaction_id), false);
});
