/**
 * verify-payment — verifies Flutterwave transactions and settles orders atomically.
 * Browser callbacks, Flutterwave webhooks, and zero-balance orders converge on the
 * service-role-only commerce_settle_verified_order() database function.
 */
import { json, preflight, serviceClient, clientIp, rateLimit } from "../_shared/http.ts";
import { deliverCommerceNotifications } from "../_shared/commerceFulfillment.ts";
import {
  checkFlutterwaveTransaction,
  normalizeFlutterwaveTransactionId,
  paymentReferenceMatches,
  timingSafeSecretEqual,
  type FlutterwaveTransaction,
} from "../../../src/lib/paymentVerification.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const FLW_SECRET = Deno.env.get("FLW_SECRET_KEY");
const FLW_WEBHOOK_HASH = Deno.env.get("FLW_WEBHOOK_HASH");
const JSON_HEADERS = { "Cache-Control": "no-store" };

interface OrderReference {
  id: string;
  order_number: string;
  amount: number | string;
  currency: string;
  payment_status: string;
  payment_reference: string | null;
  payment_provider: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function readBoundedJson(req: Request, limit: number): Promise<unknown | null> {
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(body)); } catch { return null; }
}

async function verifyWithFlutterwave(transactionId: string): Promise<
  { kind: "verified"; transaction: FlutterwaveTransaction } | { kind: "invalid" } | { kind: "unavailable" }
> {
  if (!FLW_SECRET) return { kind: "unavailable" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response | null = null;
  try {
    response = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${FLW_SECRET}`, Accept: "application/json" },
    });
    if (!response.ok) return response.status === 429 || response.status >= 500
      ? { kind: "unavailable" }
      : { kind: "invalid" };
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload)) return { kind: "unavailable" };
    if (payload.status !== "success") return { kind: "invalid" };
    if (!isRecord(payload.data)) return { kind: "unavailable" };
    return { kind: "verified", transaction: payload.data as FlutterwaveTransaction };
  } catch {
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timeout);
    try { await response?.body?.cancel(); } catch { /* Provider payloads are never logged. */ }
  }
}

function verificationFailure(reason: string): Response {
  const messages: Record<string, string> = {
    transaction_id_invalid: "Flutterwave could not verify this transaction.",
    transaction_not_successful: "This transaction has not completed successfully.",
    reference_mismatch: "The payment reference does not match this order.",
    amount_mismatch: "The verified payment amount does not match this order.",
    currency_mismatch: "The verified payment currency does not match this order.",
  };
  return json({ verified: false, error: messages[reason] || "Payment verification failed." }, 400, JSON_HEADERS);
}

async function settleVerified(
  sb: SupabaseClient,
  order: OrderReference,
  transactionId: string | null,
  amount: number,
  currency: string,
  internalZero: boolean,
  viaWebhook: boolean,
): Promise<Response> {
  const { data, error } = await sb.rpc("commerce_settle_verified_order", {
    p_order_id: order.id,
    p_transaction_id: transactionId,
    p_amount: amount,
    p_currency: currency,
    p_internal_zero: internalZero,
    p_via_webhook: viaWebhook,
  });
  if (error) {
    if (error.code === "P0002") return json({ verified: false, error: "Order not found." }, 404, JSON_HEADERS);
    if (error.code === "22023") return json({ verified: false, error: "Payment could not be safely matched to this order." }, 409, JSON_HEADERS);
    return json({ verified: false, error: "Order fulfilment is temporarily unavailable. The payment reference remains unchanged; retry shortly." }, 503, JSON_HEADERS);
  }
  if (!isRecord(data) || data.ok !== true || !isRecord(data.order)
      || typeof data.order.order_number !== "string" || !Array.isArray(data.entitlements)) {
    return json({ verified: false, error: "Order fulfilment returned an incomplete result. Please retry shortly." }, 503, JSON_HEADERS);
  }

  try { await deliverCommerceNotifications(sb, data); } catch { /* durable mail jobs remain retryable */ }
  return json({
    verified: true,
    status: "success",
    already_paid: data.already_paid === true,
    order_id: order.id,
    order_number: data.order.order_number,
    entitlements: data.entitlements,
  }, 200, JSON_HEADERS);
}

async function settleFlutterwave(
  sb: SupabaseClient,
  orderId: string,
  requestedTransactionId: unknown,
  viaWebhook: boolean,
): Promise<Response> {
  const transactionId = normalizeFlutterwaveTransactionId(requestedTransactionId);
  if (!transactionId) return verificationFailure("transaction_id_invalid");

  const { data: rawOrder, error: orderError } = await sb
    .from("orders")
    .select("id, order_number, amount, currency, payment_status, payment_reference, payment_provider")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) return json({ verified: false, error: "Order status is temporarily unavailable." }, 503, JSON_HEADERS);
  const order = rawOrder as OrderReference | null;
  if (!order) return json({ verified: false, error: "Order not found." }, 404, JSON_HEADERS);

  // A paid callback is accepted only for the exact Flutterwave reference recorded
  // by an earlier successful verification. No browser/webhook field can replace it.
  if (order.payment_status === "paid") {
    if (order.payment_provider !== "flutterwave"
        || !paymentReferenceMatches(order.payment_reference, transactionId)) {
      return json({ verified: false, error: "This transaction does not match the order's recorded payment." }, 409, JSON_HEADERS);
    }
    return await settleVerified(sb, order, transactionId, Number(order.amount), order.currency, false, viaWebhook);
  }

  if (!FLW_SECRET) return json({ verified: false, error: "Payment verification is not configured." }, 503, JSON_HEADERS);
  const providerResult = await verifyWithFlutterwave(transactionId);
  if (providerResult.kind === "unavailable") {
    return json({ verified: false, error: "Flutterwave verification is temporarily unavailable. Please retry." }, 503, JSON_HEADERS);
  }
  if (providerResult.kind === "invalid") return verificationFailure("transaction_id_invalid");

  const check = checkFlutterwaveTransaction({
    orderNumber: order.order_number,
    amount: Number(order.amount),
    currency: order.currency,
  }, providerResult.transaction, transactionId);
  if (!check.ok) return verificationFailure(check.reason);
  return await settleVerified(sb, order, check.transactionId, check.amount, check.currency, false, viaWebhook);
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, JSON_HEADERS);

  const sb = serviceClient();
  const verifHash = req.headers.get("verif-hash");
  if (verifHash !== null) {
    if (!FLW_WEBHOOK_HASH || !timingSafeSecretEqual(verifHash, FLW_WEBHOOK_HASH)) {
      return json({ error: "Invalid webhook signature." }, 401, JSON_HEADERS);
    }
    const payload = await readBoundedJson(req, 16 * 1024);
    if (!isRecord(payload)) return json({ error: "Invalid webhook payload." }, 400, JSON_HEADERS);
    const webhookData = isRecord(payload.data) ? payload.data : payload;
    const txRef = webhookData.tx_ref ?? webhookData.txRef;
    const transactionId = normalizeFlutterwaveTransactionId(webhookData.id);
    if (typeof txRef !== "string" || !transactionId) {
      return json({ received: true, ignored: "missing_payment_reference" }, 200, JSON_HEADERS);
    }
    const { data: order, error } = await sb.from("orders").select("id").eq("order_number", txRef).maybeSingle();
    if (error) return json({ received: false, error: "Order lookup is temporarily unavailable." }, 503, JSON_HEADERS);
    if (!order) return json({ received: true, ignored: "unknown_order" }, 200, JSON_HEADERS);
    const result = await settleFlutterwave(sb, order.id, transactionId, true);
    const resultBody = await result.json().catch(() => null);
    if (result.status >= 500) return json({ received: false, error: "Payment verification is temporarily unavailable; retry this webhook." }, 503, JSON_HEADERS);
    return json({ received: true, result: resultBody }, 200, JSON_HEADERS);
  }

  const body = await readBoundedJson(req, 8 * 1024);
  if (!isRecord(body)) return json({ verified: false, error: "Invalid request." }, 400, JSON_HEADERS);
  if (body.internal_fulfil === true) {
    return json({ verified: false, error: "The internal zero-balance settlement route has been retired." }, 410, JSON_HEADERS);
  }

  const ok = await rateLimit(sb, clientIp(req), "verify_payment", 30, 600);
  if (!ok) return json({ verified: false, error: "Too many attempts. Please wait and retry." }, 429, JSON_HEADERS);
  const transactionId = normalizeFlutterwaveTransactionId(body.transaction_id);
  const orderId = typeof body.order_id === "string" && /^[0-9a-f-]{36}$/i.test(body.order_id) ? body.order_id : null;
  if (!transactionId || !orderId) return json({ verified: false, error: "Missing required payment details." }, 400, JSON_HEADERS);
  return await settleFlutterwave(sb, orderId, transactionId, false);
});
