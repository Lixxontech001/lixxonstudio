// The Executioner's run on the owner's oldest waiting product-line order.
// Owner only. The browser sends the owner's local day. The run itself lives in _shared/placementRun.ts;
// this file only reads the state, hands the run its doors (database and Gemini), and reports back in plain words.
// Nothing runs on a timer. The owner starts a run through Buddy.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { callerUser, env, serviceClient } from "../_shared/http.ts";
import { isAllowedAutomationOrigin } from "../_shared/automationKeyChecks.ts";
import { readWaitingOrders, type BuddyOrder } from "../_shared/buddyOrders.ts";
import { makeMindThink } from "../_shared/mindThink.ts";
import {
  runPlacementOrder,
  type ApplyEdit,
  type GapRecord,
  type KillScope,
  type PortResult,
  type RunArticle,
  type RunInput,
  type RunLog,
  type RunOutcome,
} from "../_shared/placementRun.ts";
import type { ShopProduct } from "../_shared/productPlacement.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 512;
const KEY_NAME = "gemini_api_key";
const ARTICLE_LIMIT = 20;
const SHOP_LIMIT = 200;
const EDIT_LIMIT = 500;
const KILL_SCOPES = ["none", "all", "analyst", "strategist", "ceo", "executioner", "auditor"] as const;
/** Database rule messages, mapped to the plain reason the run understands. Anything else is a plain failure. */
const KNOWN_REASONS = ["takeover_off", "killed", "order_not_waiting", "paragraph_changed", "checksum_mismatch", "slot_missing", "article_missing"] as const;

function corsFor(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!isAllowedAutomationOrigin(origin, env("SITE_URL"))) return null;
  return {
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Apikey, Content-Type, X-Client-Info",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function reply(req: Request, body: unknown, status = 200): Response {
  const cors = corsFor(req);
  return new Response(JSON.stringify(body), { status: cors ? status : 403, headers: { ...JSON_HEADERS, ...(cors || {}) } });
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The database's message names the rule that refused the change. Only the known names become reasons. */
function reasonFrom(message: string): string {
  return KNOWN_REASONS.find((reason) => message.includes(reason)) ?? (/at most 3 products/i.test(message) ? "cap" : /at most 3 articles/i.test(message) ? "drip" : "failed");
}

function parseKill(value: unknown): KillScope {
  return (KILL_SCOPES as readonly string[]).includes(String(value)) ? (value as KillScope) : "all";
}

export async function handleRun(req: Request): Promise<Response> {
  const cors = corsFor(req);
  if (!cors) return new Response(null, { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed." }, 405);
  if (req.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reply(req, { error: "JSON request body required." }, 415);
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return reply(req, { error: "Request body is too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(req, { error: "Invalid request body." }, 400);
  }
  const localDay = asRecord(body)?.local_day;
  if (typeof localDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(localDay)) {
    return reply(req, { error: "A local day is required." }, 400);
  }

  const user = await callerUser(req);
  if (!user) return reply(req, { error: "Owner authentication required." }, 401);

  const supabaseUrl = env("SUPABASE_URL", "SUPABASE_PROJECT_URL");
  const anonKey = env("SUPABASE_ANON_KEY", "SUPABASE_KEY");
  if (!supabaseUrl || !anonKey) return reply(req, { error: "The Executioner is not configured." }, 503);

  // Owner check: the same owner-only read Buddy uses. The key itself is never read here.
  try {
    const userClient: SupabaseClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.rpc("automation_list_secrets");
    if (error || !Array.isArray(data)) return reply(req, { error: "Owner-only access is required." }, 403);
  } catch {
    return reply(req, { error: "Owner-only access is required." }, 403);
  }

  let sb: SupabaseClient;
  try {
    sb = serviceClient();
  } catch {
    return reply(req, { error: "The Executioner is not configured." }, 503);
  }
  const owner = user.id;

  // Switches first. Takeover is on only when the saved value is exactly true. An unknown Kill value stops everything.
  const controlsRow = await sb.from("minds_controls").select("takeover,kill_scope").eq("id", 1).maybeSingle();
  if (controlsRow.error) return reply(req, { status: "held", detail: "Minds settings could not be read. Nothing changed." });
  const takeover = asRecord(controlsRow.data)?.takeover === true;
  const killScope = parseKill(asRecord(controlsRow.data)?.kill_scope ?? "none");

  // The owner's oldest waiting product-line order. Other orders wait.
  const orderRows = await sb
    .from("buddy_orders")
    .select("id,instruction,mind,status,created_at")
    .eq("owner_id", owner)
    .eq("status", "waiting")
    .order("created_at", { ascending: true })
    .limit(50);
  const waiting = await readWaitingOrders(async () => (orderRows.error || !Array.isArray(orderRows.data) ? null : orderRows.data));
  if (!waiting.ok) return reply(req, { status: "held", detail: "Waiting orders could not be read. Nothing changed." });
  const order = waiting.orders.find((item) => item.lane.lane === "product_line") as BuddyOrder | undefined;
  if (!order) return reply(req, { status: "nothing_to_do", detail: "No waiting product-line order." });

  // Reads for the run: articles, shop, slots, the minds' past edits, and today's drip.
  const [articleRows, productRows, slotRows, editRows, dripRows] = await Promise.all([
    sb.from("posts").select("id,title,content").eq("status", "published").order("published_at", { ascending: false }).limit(ARTICLE_LIMIT),
    sb.from("products").select("id,name,is_digital,price_cents").eq("is_active", true).or("currency.eq.USD,currency.is.null").order("name", { ascending: true }).limit(SHOP_LIMIT),
    sb.from("post_product_slots").select("post_id,product_id").eq("owner_id", owner).is("removed_at", null),
    sb.from("post_product_edits").select("id,post_id,product_ids,sentences_added,applied_at").eq("owner_id", owner).order("applied_at", { ascending: true }).limit(EDIT_LIMIT),
    sb.from("post_drip_days").select("post_id").eq("owner_id", owner).eq("local_day", localDay),
  ]);
  if (articleRows.error || productRows.error || slotRows.error || editRows.error || dripRows.error) {
    return reply(req, { status: "held", detail: "Site reads failed. Nothing changed." });
  }

  const shop: ShopProduct[] = (productRows.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    isDigital: row.is_digital === true,
    priceUsd: typeof row.price_cents === "number" ? row.price_cents / 100 : null,
  }));
  const liveByPost = new Map<string, string[]>();
  for (const slot of slotRows.data ?? []) {
    const key = String(slot.post_id);
    liveByPost.set(key, [...(liveByPost.get(key) ?? []), String(slot.product_id)]);
  }
  const editsByPost = new Map<string, RunArticle["liveEdits"]>();
  for (const edit of editRows.data ?? []) {
    const key = String(edit.post_id);
    const list = editsByPost.get(key) ?? [];
    list.push({ id: String(edit.id), productIds: (edit.product_ids as string[]) ?? [], sentencesAdded: String(edit.sentences_added ?? "") });
    editsByPost.set(key, list);
  }
  const articles: RunArticle[] = (articleRows.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    title: String(row.title ?? "Untitled"),
    content: typeof row.content === "string" ? row.content : null,
    liveProductIds: liveByPost.get(String(row.id)) ?? [],
    liveEdits: editsByPost.get(String(row.id)) ?? [],
  }));

  const input: RunInput = {
    order: { id: order.id, instruction: order.instruction },
    localDay,
    takeover,
    killScope,
    shop,
    articles,
    touchedToday: (dripRows.data ?? []).map((row: Record<string, unknown>) => String(row.post_id)),
  };

  const think = makeMindThink(async () => {
    try {
      const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: KEY_NAME });
      return !error && typeof data === "string" && data.length > 0 ? data : null;
    } catch {
      return null;
    }
  });

  const orderId = order.id;
  const logRow = async (entry: RunLog) => {
    await sb.from("minds_daily_log").insert({
      owner_id: owner,
      day: localDay,
      mind: entry.mind,
      action: clip(entry.action, 120),
      outcome: entry.outcome,
      detail: clip(entry.detail, 500),
      order_id: orderId,
    });
  };

  const outcome: RunOutcome = await runPlacementOrder(input, {
    think,
    applyEdit: async (edit: ApplyEdit): Promise<PortResult> => {
      const { error } = await sb.rpc("minds_apply_placement", {
        p_owner_id: owner,
        p_order_id: edit.orderId,
        p_post_id: edit.postId,
        p_local_day: edit.localDay,
        p_line_index: edit.lineIndex,
        p_before_line: edit.beforeLine,
        p_after_line: edit.afterLine,
        p_before_checksum: edit.beforeChecksum,
        p_after_checksum: edit.afterChecksum,
        p_sentences_added: edit.sentencesAdded,
        p_product_ids: edit.productIds,
        p_removed_product_ids: edit.removedProductIds,
        p_auditor_note: edit.auditorNote,
        p_title: edit.title,
        p_detail: clip(edit.detail, 500),
      });
      return error ? { ok: false, reason: reasonFrom(error.message) } : { ok: true };
    },
    recordGap: async (gap: GapRecord): Promise<PortResult> => {
      const { error } = await sb.rpc("minds_record_gap", {
        p_owner_id: owner,
        p_order_id: gap.orderId,
        p_post_id: gap.postId,
        p_angle: gap.angle,
        p_note: gap.note,
        p_reason: gap.reason,
        p_title: gap.title,
        p_local_day: gap.localDay,
      });
      return error ? { ok: false, reason: reasonFrom(error.message) } : { ok: true };
    },
    log: logRow,
    notable: async (kind, title, detail) => {
      await sb.from("minds_notable_events").insert({ owner_id: owner, mind: "auditor", kind, title: clip(title, 160), detail: clip(detail, 500) });
    },
  });

  return reply(req, { status: outcome.status, detail: outcome.detail, order_id: order.id });
}

Deno.serve(handleRun);
