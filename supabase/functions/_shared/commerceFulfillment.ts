import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { emailShell, escapeHtml, sendEmail, siteUrl } from "./http.ts";

interface Entitlement {
  product_id: string;
  product_name: string;
  download_token: string;
}

interface FulfilledOrder {
  id: string;
  order_number: string;
  customer_email: string;
  customer_name: string | null;
  amount: number | string;
  currency: string;
  subtotal: number | string | null;
  discount_amount: number | string | null;
  gift_card_amount: number | string | null;
  promo_code: string | null;
}

interface IssuedGiftCard {
  code: string;
  amount: number | string;
  recipient_email: string;
  recipient_name: string | null;
  message: string | null;
}

export interface CommerceSettlement {
  ok: true;
  already_paid: boolean;
  order: FulfilledOrder;
  entitlements: Entitlement[];
  gift_card: IssuedGiftCard | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(value);
}

function isSettlement(value: unknown): value is CommerceSettlement {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.order)
      || typeof value.order.id !== "string" || !/^[0-9a-f-]{36}$/i.test(value.order.id)
      || typeof value.order.order_number !== "string" || value.order.order_number.length > 80
      || !validEmail(value.order.customer_email) || typeof value.order.currency !== "string"
      || !Array.isArray(value.entitlements) || value.entitlements.length > 100
      || !(value.gift_card === null || isRecord(value.gift_card))) return false;
  if (value.entitlements.some((item) => !isRecord(item)
      || typeof item.product_id !== "string" || !/^[0-9a-f-]{36}$/i.test(item.product_id)
      || typeof item.product_name !== "string" || item.product_name.length > 500
      || typeof item.download_token !== "string" || !/^[0-9a-f-]{36}$/i.test(item.download_token))) return false;
  if (value.gift_card !== null && (!isRecord(value.gift_card)
      || typeof value.gift_card.code !== "string" || !/^LXG-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}$/.test(value.gift_card.code)
      || !validEmail(value.gift_card.recipient_email))) return false;
  return true;
}

function amount(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function receiptHtml(settlement: CommerceSettlement): string {
  const order = settlement.order;
  const base = siteUrl();
  const rows = settlement.entitlements.map((item) => {
    const href = `${base}/account/downloads?token=${encodeURIComponent(item.download_token)}`;
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #E8DFD8;">${escapeHtml(item.product_name)}</td><td style="padding:10px 0;border-bottom:1px solid #E8DFD8;text-align:right;"><a href="${href}" style="color:#A87056;font-weight:600;">Download →</a></td></tr>`;
  }).join("");
  const subtotal = amount(order.subtotal ?? order.amount);
  const discount = amount(order.discount_amount);
  const giftCardAmount = amount(order.gift_card_amount);
  return emailShell(`Thank you, ${escapeHtml(order.customer_name || "there")}.`, `
    <p>Order <strong>${escapeHtml(order.order_number)}</strong> is confirmed.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:6px 0;color:#5A5A5A;">Subtotal</td><td style="text-align:right;">${escapeHtml(order.currency)} ${subtotal.toFixed(2)}</td></tr>
      ${discount > 0 ? `<tr><td style="padding:6px 0;color:#5A5A5A;">Discount${order.promo_code ? ` (${escapeHtml(order.promo_code)})` : ""}</td><td style="text-align:right;">− ${escapeHtml(order.currency)} ${discount.toFixed(2)}</td></tr>` : ""}
      ${giftCardAmount > 0 ? `<tr><td style="padding:6px 0;color:#5A5A5A;">Gift card</td><td style="text-align:right;">− ${escapeHtml(order.currency)} ${giftCardAmount.toFixed(2)}</td></tr>` : ""}
      <tr><td style="padding:10px 0;font-weight:600;border-top:1px solid #1A1A1A;">Paid</td><td style="text-align:right;font-weight:600;border-top:1px solid #1A1A1A;">${escapeHtml(order.currency)} ${amount(order.amount).toFixed(2)}</td></tr>
    </table>
    ${rows ? `<h3 style="font-weight:500;margin:24px 0 8px;">Your downloads</h3><table style="width:100%;border-collapse:collapse;">${rows}</table><p style="color:#5A5A5A;font-size:13px;">Each download link allows up to five uses and expires in 30 days. Sign in at <a href="${base}/account" style="color:#A87056;">${base.replace(/^https?:\/\//, "")}/account</a> with this email to find your downloads again.</p>` : ""}
  `);
}

function giftCardHtml(settlement: CommerceSettlement): string {
  const order = settlement.order;
  const gift = settlement.gift_card!;
  const name = order.customer_name || order.customer_email;
  const message = gift.message
    ? `<blockquote style="border-left:3px solid #C48B71;margin:16px 0;padding:8px 16px;color:#2D2D2D;font-style:italic;">${escapeHtml(gift.message)}</blockquote>`
    : "";
  const greeting = gift.recipient_name ? `, ${escapeHtml(gift.recipient_name)}` : "";
  const base = siteUrl();
  return emailShell(`A gift for you${greeting}`, `
    <p>${escapeHtml(name)} sent you a <strong>${escapeHtml(order.currency)} ${amount(gift.amount).toFixed(2)}</strong> gift card.</p>
    ${message}
    <p style="font-size:22px;letter-spacing:.15em;font-family:monospace;background:#F2EDE7;padding:16px;text-align:center;">${escapeHtml(gift.code)}</p>
    <p>Enter this code at checkout on <a href="${base}/shop" style="color:#A87056;">${base.replace(/^https?:\/\//, "")}/shop</a>. Valid for 12 months.</p>
  `);
}

async function deliverOne(
  sb: SupabaseClient,
  settlement: CommerceSettlement,
  jobType: "receipt" | "gift_card_email",
): Promise<boolean> {
  const { data: claimed, error: claimError } = await sb.rpc("commerce_claim_fulfillment_job", {
    p_order_id: settlement.order.id,
    p_job_type: jobType,
  });
  if (claimError || claimed !== true) return false;

  let delivered = false;
  let safeErrorCode = "EMAIL_PROVIDER_UNAVAILABLE";
  try {
    if (jobType === "receipt") {
      if (!validEmail(settlement.order.customer_email)) {
        safeErrorCode = "EMAIL_RECIPIENT_INVALID";
      } else {
        delivered = await sendEmail({
          to: settlement.order.customer_email,
          subject: `Your receipt — Order ${settlement.order.order_number}`,
          html: receiptHtml(settlement),
          idempotencyKey: `commerce-${settlement.order.id}-receipt-v1`,
        });
      }
    } else if (settlement.gift_card && validEmail(settlement.gift_card.recipient_email)) {
      delivered = await sendEmail({
        to: settlement.gift_card.recipient_email,
        subject: `${settlement.order.customer_name || "Someone"} sent you a Lixxon Studio gift card`,
        html: giftCardHtml(settlement),
        idempotencyKey: `commerce-${settlement.order.id}-gift-card-v1`,
      });
    } else {
      safeErrorCode = "EMAIL_RECIPIENT_INVALID";
    }
    if (!delivered && safeErrorCode !== "EMAIL_RECIPIENT_INVALID" && !Deno.env.get("RESEND_API_KEY")) {
      safeErrorCode = "EMAIL_NOT_CONFIGURED";
    }
  } catch {
    safeErrorCode = "EMAIL_PROVIDER_UNAVAILABLE";
  }

  const { error: completeError } = await sb.rpc("commerce_complete_fulfillment_job", {
    p_order_id: settlement.order.id,
    p_job_type: jobType,
    p_success: delivered,
    p_error_code: delivered ? null : safeErrorCode,
  });
  return delivered && !completeError;
}

/**
 * Jobs are claimed under a row lock and are retryable after provider failures or
 * an expired worker lease. Stable provider idempotency keys protect the narrow
 * case where delivery succeeded but the Edge Function lost its response.
 */
export async function deliverCommerceNotifications(
  sb: SupabaseClient,
  rawSettlement: unknown,
): Promise<{ receipt: boolean; giftCard: boolean }> {
  if (!isSettlement(rawSettlement)) return { receipt: false, giftCard: false };
  const settlement = rawSettlement;
  const receipt = await deliverOne(sb, settlement, "receipt");
  const giftCard = settlement.gift_card
    ? await deliverOne(sb, settlement, "gift_card_email")
    : false;
  return { receipt, giftCard };
}
