/**
 * create-order — the ONLY way an order comes into existence.
 *
 * The browser sends product ids + quantities + optional promo / gift-card codes.
 * The server:
 *   1. loads real prices from `products` (never trusts client prices)
 *   2. validates & prices the promo code and gift card server-side
 *   3. (mode=quote) returns the authoritative totals for display, or
 *      (mode=create) atomically redeems promo/gift-card, inserts order + items,
 *      and returns { order_id, order_number, amount } for Flutterwave.
 *
 * `verify-payment` later compares the Flutterwave charge against orders.amount
 * stored here — the client never gets to tell us what it expected to pay.
 */
import {
  json, preflight, serviceClient, callerUser, clientIp, rateLimit, normEmail, cleanText,
} from "../_shared/http.ts";
import { deliverCommerceNotifications } from "../_shared/commerceFulfillment.ts";

interface CartLine { id: string; quantity: number; pwyw_price?: number }
interface GiftCardPurchase { amount: number; recipient_email: string; recipient_name?: string; message?: string }
interface Body {
  mode?: "quote" | "create";
  items?: CartLine[];
  gift_card?: GiftCardPurchase;
  promo_code?: string;
  gift_card_code?: string;
  email?: string;
  name?: string;
  currency?: string;
}

const CURRENCY = Deno.env.get("CHECKOUT_CURRENCY") || "USD";
const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const mode = body.mode === "create" ? "create" : "quote";
  const sb = serviceClient();
  const ip = clientIp(req);

  // rate limits: quotes are cheap but spammable; creates are precious
  const ok = await rateLimit(sb, ip, mode === "create" ? "order_create" : "order_quote", mode === "create" ? 10 : 60, 600);
  if (!ok) return json({ error: "Too many requests. Please wait a moment." }, 429);

  // ---- 1. validate cart shape
  const lines = (Array.isArray(body.items) ? body.items : [])
    .filter((l) => l && typeof l.id === "string" && /^[0-9a-f-]{36}$/i.test(l.id))
    .map((l) => ({ id: l.id, quantity: Math.min(10, Math.max(1, Math.floor(Number(l.quantity) || 1))), pwyw: Number(l.pwyw_price) }));

  // optional gift-card purchase (a virtual line item, no product row)
  let gift: GiftCardPurchase | null = null;
  if (body.gift_card && typeof body.gift_card === "object") {
    const amt = round2(Number(body.gift_card.amount));
    const rEmail = normEmail(body.gift_card.recipient_email);
    if (!(amt >= 5 && amt <= 500)) return json({ error: "Gift cards can be between 5 and 500.", field: "gift_card" }, 400);
    if (!rEmail) return json({ error: "Please enter a valid recipient email.", field: "gift_card" }, 400);
    gift = { amount: amt, recipient_email: rEmail, recipient_name: cleanText(body.gift_card.recipient_name, 80), message: cleanText(body.gift_card.message, 300) };
  }
  if ((lines.length === 0 && !gift) || lines.length > 25) return json({ error: "Your cart is empty." }, 400);

  // merge duplicates (keep the highest pay-what-you-want offer)
  const qty = new Map<string, { q: number; pwyw: number }>();
  for (const l of lines) {
    const prev = qty.get(l.id);
    qty.set(l.id, { q: Math.min(10, (prev?.q || 0) + l.quantity), pwyw: Math.max(prev?.pwyw || 0, Number.isFinite(l.pwyw) ? l.pwyw : 0) });
  }

  // ---- 2. authoritative prices
  const { data: products, error: pErr } = qty.size
    ? await sb.from("products")
        .select("id, name, slug, price, price_cents, is_active, is_digital, product_type, file_path, pay_what_you_want, min_price_cents, stock_status")
        .in("id", [...qty.keys()])
    : { data: [], error: null };
  if (pErr) return json({ error: "Could not load products." }, 500);

  type Priced = { id: string | null; name: string; slug: string; is_digital: boolean; product_type: string; file_path: string | null; unit: number; quantity: number; line_total: number };
  const priced: Priced[] = [];
  for (const [id, { q, pwyw }] of qty) {
    const p = (products || []).find((x) => x.id === id);
    if (!p || !p.is_active || p.stock_status === "out_of_stock" || p.stock_status === "coming_soon") return json({ error: "One of the items is no longer available." }, 409);
    if (p.product_type === "affiliate") return json({ error: `${p.name} cannot be purchased here.` }, 409);
    let cents = typeof p.price_cents === "number" ? p.price_cents : Math.round(parseFloat(String(p.price || "0").replace(/[^0-9.]/g, "")) * 100);
    if (p.pay_what_you_want) {
      // customer may pay MORE than the floor, never less
      const floor = Math.max(0, Number(p.min_price_cents ?? cents) || 0);
      const offered = Math.round(pwyw * 100);
      cents = Math.max(floor, Number.isFinite(offered) ? offered : floor);
      if (cents > 100000) return json({ error: "That's very generous, but the maximum is 1000." }, 400);
    }
    if (!Number.isFinite(cents) || cents < 0) return json({ error: "Invalid product price." }, 409);
    priced.push({ ...p, unit: cents / 100, quantity: q, line_total: round2((cents / 100) * q) } as Priced);
  }
  if (gift) {
    priced.push({ id: null, name: `Gift card for ${gift.recipient_name || gift.recipient_email}`, slug: "gift-card", is_digital: false, product_type: "gift_card", file_path: null, unit: gift.amount, quantity: 1, line_total: gift.amount });
  }
  // ---- 2b. bundle pricing: if every product of an active bundle is in the cart, the bundle
  // price replaces the sum of those items (one bundle per order, the best saving wins).
  let bundleSaving = 0;
  let bundleApplied: { id: string; name: string } | null = null;
  if (qty.size >= 2) {
    const { data: bundles } = await sb.from("product_bundles").select("id, name, bundle_price, items:product_bundle_items(product_id)").eq("is_active", true);
    for (const b of (bundles || []) as { id: string; name: string; bundle_price: number; items: { product_id: string }[] }[]) {
      const ids = (b.items || []).map((i) => i.product_id);
      if (ids.length < 2 || !ids.every((id) => qty.has(id))) continue;
      const full = ids.reduce((sum, id) => sum + (priced.find((p) => p.id === id)?.unit || 0), 0);
      const saving = round2(full - Number(b.bundle_price));
      if (saving > bundleSaving) { bundleSaving = saving; bundleApplied = { id: b.id, name: b.name }; }
    }
  }
  const subtotal = round2(priced.reduce((s, p) => s + p.line_total, 0) - bundleSaving);

  // ---- 3. promo code (validated server-side, never exposed)
  let discount = 0;
  let promo: { code: string; discount_type: string; discount_value: number } | null = null;
  const discountable = round2(subtotal - (gift ? gift.amount : 0)); // promos never apply to gift cards
  const promoCode = cleanText(body.promo_code, 40).toUpperCase();
  if (promoCode) {
    const { data: pc } = await sb
      .from("promo_codes")
      .select("code, discount_type, discount_value, is_active, max_uses, use_count, expires_at, min_subtotal")
      .ilike("code", promoCode)
      .maybeSingle();
    const valid = pc && pc.is_active
      && (!pc.expires_at || new Date(pc.expires_at) > new Date())
      && (pc.max_uses === null || pc.use_count < pc.max_uses)
      && discountable >= Number(pc.min_subtotal || 0) && discountable > 0;
    if (!valid) return json({ error: "That promo code is invalid, expired or not applicable.", field: "promo_code" }, 400);
    discount = pc!.discount_type === "percentage"
      ? round2(discountable * Math.min(100, Number(pc!.discount_value)) / 100)
      : Math.min(discountable, round2(Number(pc!.discount_value)));
    promo = { code: pc!.code, discount_type: pc!.discount_type, discount_value: Number(pc!.discount_value) };
  }

  // ---- 4. gift card
  let giftApplied = 0;
  const giftCode = cleanText(body.gift_card_code, 40).toUpperCase();
  const afterDiscount = round2(Math.max(0, subtotal - discount));
  if (giftCode && gift) return json({ error: "Gift cards can't be used to buy gift cards.", field: "gift_card_code" }, 400);
  if (giftCode) {
    const { data: gc } = await sb
      .from("gift_cards")
      .select("code, balance, is_active, expires_at")
      .ilike("code", giftCode)
      .maybeSingle();
    const valid = gc && gc.is_active && Number(gc.balance) > 0 && (!gc.expires_at || new Date(gc.expires_at) > new Date());
    if (!valid) return json({ error: "That gift card is invalid, empty or expired.", field: "gift_card_code" }, 400);
    giftApplied = Math.min(afterDiscount, round2(Number(gc!.balance)));
  }

  const amount = round2(Math.max(0, afterDiscount - giftApplied));
  const quote = {
    currency: CURRENCY,
    subtotal, discount, gift_card_amount: giftApplied, amount,
    bundle: bundleApplied ? { ...bundleApplied, saving: bundleSaving } : null,
    promo: promo ? { code: promo.code, discount_type: promo.discount_type, discount_value: promo.discount_value } : null,
    items: priced.map((p) => ({ id: p.id, name: p.name, slug: p.slug, unit_price: p.unit, quantity: p.quantity, line_total: p.line_total })),
  };
  if (mode === "quote") return json({ ok: true, quote });

  // ---- 5. CREATE
  const email = normEmail(body.email);
  const name = cleanText(body.name, 120);
  if (!email) return json({ error: "Please enter a valid email address.", field: "email" }, 400);
  if (!name) return json({ error: "Please enter your name.", field: "name" }, 400);

  const user = await callerUser(req);
  const orderNumber = `LXX-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  // atomically redeem promo & gift card BEFORE the order exists (both are reversible by admin)
  if (promo) {
    const { data: redeemed } = await sb.rpc("redeem_promo_code", { p_code: promo.code });
    if (redeemed !== true) return json({ error: "That promo code was just used up.", field: "promo_code" }, 409);
  }
  if (giftApplied > 0) {
    const { data: debited } = await sb.rpc("debit_gift_card", { p_code: giftCode, p_amount: giftApplied });
    if (debited !== true) return json({ error: "Gift card balance changed. Please re-apply it.", field: "gift_card_code" }, 409);
  }

  // customer upsert
  const { data: customer } = await sb
    .from("customers")
    .upsert({ email, name, user_id: user?.id ?? null }, { onConflict: "email" })
    .select("id")
    .maybeSingle();

  const fullyCovered = amount === 0;
  const { data: order, error: oErr } = await sb
    .from("orders")
    .insert({
      order_number: orderNumber,
      customer_id: customer?.id ?? null,
      customer_email: email,
      customer_name: name,
      user_id: user?.id ?? null,
      // Even a zero-balance order starts pending; the settlement RPC marks it paid
      // only after the line items exist and unlocks are committed atomically.
      status: "pending",
      payment_status: "pending",
      payment_provider: fullyCovered ? (giftApplied > 0 ? "gift_card" : "promo") : "flutterwave",
      amount,
      subtotal,
      discount_amount: discount,
      promo_code: promo?.code ?? null,
      gift_card_code: giftApplied > 0 ? giftCode : null,
      gift_card_amount: giftApplied,
      currency: CURRENCY,
      paid_at: fullyCovered ? new Date().toISOString() : null,
      meta: gift ? { gift_card: gift } : {},
    })
    .select("id, order_number, amount, currency")
    .single();
  if (oErr || !order) {
    console.error("order insert failed", oErr?.message);
    return json({ error: "Could not create your order. Please try again." }, 500);
  }

  const { error: iErr } = await sb.from("order_items").insert(
    priced.map((p) => ({
      order_id: order.id, product_id: p.id, product_name: p.name, product_slug: p.slug,
      price: p.unit, quantity: p.quantity, file_path: p.is_digital || p.product_type === "digital" ? p.file_path : null,
    })),
  );
  if (iErr) {
    console.error("order items failed", iErr.message);
    await sb.from("orders").update({ status: "failed", payment_status: "failed" }).eq("id", order.id);
    return json({ error: "Could not save your order items." }, 500);
  }

  // Zero-balance orders are settled directly through a privileged database
  // function. No internal HTTP secret is sent between Edge Functions.
  let entitlements: unknown[] = [];
  if (fullyCovered) {
    let settlement: unknown = null;
    for (let attempt = 0; attempt < 2 && !settlement; attempt += 1) {
      const { data, error } = await sb.rpc("commerce_settle_verified_order", {
        p_order_id: order.id,
        p_transaction_id: null,
        p_amount: 0,
        p_currency: CURRENCY,
        p_internal_zero: true,
        p_via_webhook: false,
      });
      if (!error && data && typeof data === "object" && (data as { ok?: unknown }).ok === true) settlement = data;
    }
    if (!settlement) {
      // Do not report a completed/unlocked order when the atomic commit failed.
      // Avoid a second checkout that could redeem the customer's promo/gift card again.
      return json({ error: "Your order was created, but we could not confirm the zero-balance unlock. Please contact support with the order number before retrying this payment method.", order_id: order.id, order_number: order.order_number }, 503);
    }
    const settledEntitlements = (settlement as { entitlements?: unknown }).entitlements;
    entitlements = Array.isArray(settledEntitlements) ? settledEntitlements : [];
    try { await deliverCommerceNotifications(sb, settlement); } catch { /* email is retryable; unlocks are already committed */ }
  }

  return json({
    ok: true,
    order_id: order.id,
    order_number: order.order_number,
    amount: Number(order.amount),
    currency: order.currency,
    fully_covered: fullyCovered,
    entitlements,
    quote,
  });
});
