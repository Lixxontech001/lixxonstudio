// The Executioner's run on the owner's oldest waiting runnable order (a product line, or today's daily run).
// Owner only. The browser sends the owner's local day, and optionally one order id the owner chose.
// The run itself lives in _shared/placementRun.ts; the choice lives in _shared/runDay.ts.
// This file reads the state, hands the run its doors (database and Gemini), and reports back in plain words.
// Takeover off, or a Kill that stops the run: this returns before any read or log, and orders stay waiting.
// Two callers, one run: the owner (a signed-in session), and the 08:00 morning clock on the server, which has no
// session and proves itself with the internal function secret plus an owner id that is checked against app_admins.
// The owner path is unchanged, and a browser without a session still gets the same refusal it always did.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { callerUser, env, serviceClient } from "../_shared/http.ts";
import { isInternalCall } from "../_shared/internalCall.ts";
import { isAllowedAutomationOrigin } from "../_shared/automationKeyChecks.ts";
import { readWaitingOrders } from "../_shared/buddyOrders.ts";
import { makeMindThink } from "../_shared/mindThink.ts";
import { saveRunChatReport } from "../_shared/runChatReport.ts";
import { blockedDetail, runDay } from "../_shared/runDay.ts";
import { checkArticleImage, fetchArticleImage } from "../_shared/articleImage.ts";
import { runDayPacks, type DayPacksResult, type PackRow, type PackSource } from "../_shared/dayPacks.ts";
import { LEARN_LOOKBACK_DAYS, learnWindows, type PackCopy, type WindowLearning } from "../_shared/packCopy.ts";
import { doorFailNotices, runDoors, type AudioLoad, type DoorRunResult, type VideoLoad } from "../_shared/runDoors.ts";
import { shouldBuzz, type PushStatus } from "../_shared/notablePush.ts";
import { attemptRow, flushUnpushedNotables, ownerDayOf, ownerNotablePorts, pushNewestNotable, servicePushPorts, type NotableRow } from "../_shared/notablePushServer.ts";
import { DOOR_WINDOW_DAYS, type DoorArticle } from "../_shared/doorPosts.ts";
import { ORDER_READ_LIMIT, planJobNotable, scanNotableSources, type ClickRow, type NotablePlan, type NotablePorts, type OrderRow, type ScanResult } from "../_shared/notableSources.ts";
import { weekWindows, type WeekFacts } from "../_shared/buddyWeek.ts";
import { orderOutcomeLine } from "../_shared/buddyFeedback.ts";
import { LIVING_MINDS, STOPPED_ACTION, runLivingMinds, type LivingMindPorts } from "../_shared/buddyLivingMinds.ts";
import { doorPostedAct, doorSkippedAct, packSavedAct, reportAct, type ActPorts, type ActWords } from "../_shared/mindActs.ts";
import { factsWithMemory, freshTellings, TOLD_LIMIT, type ToldTelling } from "../_shared/mindMemory.ts";
import { readMemoryBlock } from "../_shared/mindMemoryServer.ts";
import { deadProductWindows, planDeadProductActs, salesByProduct, type PaidItem, type ProductSales } from "../_shared/deadProducts.ts";
import { draftFromPayload } from "../_shared/chatCaptions.ts";
import { COMPETITOR_CHANGE_KIND, COMPETITOR_SAVE_LIMIT, competitorLabel, publicPageProblem, runCompetitorReads, type CompetitorFetch, type SavedCompetitor } from "../_shared/competitors.ts";
import { runPriceChange } from "../_shared/priceRun.ts";
import type { PriceProduct } from "../_shared/priceChanges.ts";
import { ownerDayWindow } from "../_shared/mindsNightReport.ts";
import { doorLogAction, isRssDoor, sendRssPing } from "../_shared/rssHub.ts";
import { DOOR_LABEL } from "../_shared/buddyControls.ts";
import { DOORS } from "../_shared/doorRegistry.ts";
import { sendBlogger, sendBluesky, sendDiscord, sendMastodon, sendMedium, sendPixelfed, sendTelegram, sendTumblr, sendVimeo, sendWordPressCom, sendYouTube, VIDEO_MAX_BYTES } from "../_shared/doorAdapters.ts";
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
const ARTICLE_LIMIT = 20;
const SHOP_LIMIT = 200;
const EDIT_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KILL_SCOPES = ["none", "all", "analyst", "strategist", "ceo", "executioner", "auditor"] as const;
/** How long one rival page may take, and how much of it is read. Both keep the run small. */
const COMPETITOR_TIMEOUT_MS = 12000;
const COMPETITOR_MAX_BYTES = 600000;
/** Database rule messages, mapped to the plain reason the run understands. Anything else is a plain failure. */
const KNOWN_REASONS = ["takeover_off", "killed", "order_not_waiting", "paragraph_changed", "checksum_mismatch", "slot_missing", "article_missing", "already_posted", "door_day_cap", "door_not_open"] as const;

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

function reply(req: Request, body: unknown, status = 200, internal = false): Response {
  const cors = internal ? {} : corsFor(req);
  return new Response(JSON.stringify(body), { status: internal || cors ? status : 403, headers: { ...JSON_HEADERS, ...cors } });
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** The day's brief from the three thinking minds, as it arrives from the clock. Plain text, clipped, or empty. */
function clipBrief(value: unknown): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 1200 ? `${flat.slice(0, 1199)}…` : flat;
}

/**
 * The shop's own refusal, in plain words. The Auditor checks the price first, so these are the day's rules the plan
 * cannot see: a product already changed today, and the guard rails the database keeps whatever the plan says.
 */
function priceReasonFrom(message: string): string {
  if (/takeover_off/.test(message)) return "Takeover is off, so no price was changed.";
  if (/killed/.test(message)) return "A Kill switch stops the minds, so no price was changed.";
  if (/price_already_changed_today/.test(message)) return "This product's price already changed today. One change a day, so nothing else was written.";
  if (/price_not_usd/.test(message)) return "US dollar prices only. Nothing was changed.";
  if (/price_missing|price_free|price_too_low|price_too_high|price_same|price_too_big_a_step/.test(message)) return "The shop would not take that price. Nothing was changed.";
  if (/price_reason_money/.test(message)) return "The reason named money other than US dollars. Nothing was changed.";
  if (/price_no_reason/.test(message)) return "The change had no reason with it. Nothing was changed.";
  return "The shop would not take that price. Nothing was changed.";
}

/** One rival page, as its html. Public pages only, a short wait, and a size cap so one big page cannot fill the run. */
async function fetchCompetitorPage(url: string): Promise<CompetitorFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPETITOR_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    // A redirect may land somewhere that is not a public page. Nothing is read from there.
    const landed = publicPageProblem(response.url || url);
    if (landed) return { ok: false, reason: "it moved to an address that is not a public page." };
    if (!response.ok) return { ok: false, reason: `the page answered with status ${response.status}.` };
    const text = await response.text();
    if (!text) return { ok: false, reason: "the page came back empty." };
    return { ok: true, html: text.slice(0, COMPETITOR_MAX_BYTES) };
  } catch {
    return { ok: false, reason: "the page could not be reached in time." };
  } finally {
    clearTimeout(timer);
  }
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
  // The 08:00 morning clock has no session. It proves itself with the internal secret, and the owner id in the body
  // is checked against app_admins below. Everything else (a browser) goes down the owner-session path, unchanged.
  const internal = isInternalCall(req, env("INTERNAL_FN_SECRET"));
  // An internal call has no Origin, so the browser rule is not applied to it. A reply never carries CORS headers then.
  const cors = internal ? {} : corsFor(req);
  // Every answer below carries the same CORS decision that was made above.
  const out = (payload: unknown, status = 200) => reply(req, payload, status, internal);
  let chatReportContext: { client: SupabaseClient; owner: string; chatId: string } | null = null;
  const reportOut = async (payload: unknown, status = 200): Promise<Response> => {
    const result = asRecord(payload);
    const reportContext = chatReportContext;
    if (!reportContext || typeof result?.detail !== "string") return out(payload, status);
    const saved = await saveRunChatReport(
      { ownerId: reportContext.owner, chatId: reportContext.chatId, detail: result.detail },
      {
        saveBuddyReply: async ({ ownerId, chatId, content }) => {
          const { error } = await reportContext.client.from("buddy_messages").insert({
            owner_id: ownerId,
            chat_id: chatId,
            role: "buddy",
            kind: "reply",
            content,
          });
          return !error;
        },
        touchChat: async ({ ownerId, chatId }) => {
          const { error } = await reportContext.client
            .from("buddy_chats")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", chatId)
            .eq("owner_id", ownerId);
          if (error) throw new Error("chat");
        },
      },
    );
    return out({ ...result, chat_reply_saved: saved }, status);
  };
  if (!cors) return new Response(null, { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return out({ error: "Method not allowed." }, 405);
  if (req.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return out({ error: "JSON request body required." }, 415);
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return out({ error: "Request body is too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return out({ error: "Invalid request body." }, 400);
  }
  const localDay = asRecord(body)?.local_day;
  if (typeof localDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(localDay)) {
    return out({ error: "A local day is required." }, 400);
  }
  const requestedOrder = asRecord(body)?.order_id;
  if (requestedOrder !== undefined && requestedOrder !== null && (typeof requestedOrder !== "string" || !UUID.test(requestedOrder))) {
    return out({ error: "The order id is not valid." }, 400);
  }
  const requestedChat = asRecord(body)?.chat_id;
  if (requestedChat !== undefined && requestedChat !== null && (typeof requestedChat !== "string" || !UUID.test(requestedChat))) {
    return out({ error: "The chat id is not valid." }, 400);
  }
  // The clock never picks an order: an internal call always runs the oldest waiting order, as Run today does.
  // Only an owner browser call may return its result to a chat.
  const orderId = !internal && typeof requestedOrder === "string" ? requestedOrder : null;
  const chatId = !internal && typeof requestedChat === "string" ? requestedChat : null;
  const brief = internal ? clipBrief(asRecord(body)?.brief) : "";

  let user: { id: string } | null = null;
  if (!internal) {
    user = await callerUser(req);
    if (!user) return out({ error: "Owner authentication required." }, 401);
  }

  const supabaseUrl = env("SUPABASE_URL", "SUPABASE_PROJECT_URL");
  const anonKey = env("SUPABASE_ANON_KEY", "SUPABASE_KEY");
  if (!supabaseUrl || !anonKey) return out({ error: "The Executioner is not configured." }, 503);

  // Owner check, the only two ways in. A browser must pass the same owner-only read Buddy uses (the key itself is
  // never read here). The clock must pass the internal secret and name an owner that app_admins really lists.
  if (internal) {
    const claimed = asRecord(body)?.owner_id;
    if (typeof claimed !== "string" || !UUID.test(claimed)) return out({ error: "An owner id is required." }, 403);
    let sb: SupabaseClient;
    try {
      sb = serviceClient();
    } catch {
      return out({ error: "The Executioner is not configured." }, 503);
    }
    const { data, error } = await sb.from("app_admins").select("user_id").eq("user_id", claimed).eq("role", "owner").maybeSingle();
    if (error || !data) return out({ error: "Owner-only access is required." }, 403);
  } else {
    try {
      const userClient: SupabaseClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await userClient.rpc("automation_list_secrets");
      if (error || !Array.isArray(data)) return out({ error: "Owner-only access is required." }, 403);
    } catch {
      return out({ error: "Owner-only access is required." }, 403);
    }
  }

  let sb: SupabaseClient;
  try {
    sb = serviceClient();
  } catch {
    return out({ error: "The Executioner is not configured." }, 503);
  }
  const owner = internal ? String(asRecord(body)?.owner_id) : (user as { id: string }).id;
  if (chatId) {
    const { data: chat, error: chatError } = await sb.from("buddy_chats").select("id").eq("id", chatId).eq("owner_id", owner).maybeSingle();
    if (chatError || !chat) return out({ error: "That chat could not be found for this owner." }, 403);
    chatReportContext = { client: sb, owner, chatId };
  }

  // Owner pushes that are still waiting go out first, whatever the switches say. A sent row is never sent again.
  await flushUnpushedNotables(servicePushPorts(sb), Date.now(), owner);

  // Switches first. Takeover is on only when the saved value is exactly true. An unknown Kill value stops everything.
  const controlsRow = await sb.from("minds_controls").select("takeover,kill_scope").eq("id", 1).maybeSingle();
  if (controlsRow.error) return reportOut({ status: "held", detail: "Minds settings could not be read. Nothing changed." });
  const takeover = asRecord(controlsRow.data)?.takeover === true;
  const killScope = parseKill(asRecord(controlsRow.data)?.kill_scope ?? "none");

  // Takeover off, or Kill on a mind the run needs: no waiting order or site data is read, no site change is made, and no daily log is written.
  // If this came from a chat, reportOut still tells the owner why the run was held.
  const blocked = blockedDetail(takeover, killScope);
  if (blocked) return reportOut({ status: "held", detail: blocked, order_id: orderId });

  // The owner's waiting orders, oldest first. Other orders wait.
  const orderRows = await sb
    .from("buddy_orders")
    .select("id,instruction,mind,status,created_at")
    .eq("owner_id", owner)
    .eq("status", "waiting")
    .order("created_at", { ascending: true })
    .limit(50);
  const waiting = await readWaitingOrders(async () => (orderRows.error || !Array.isArray(orderRows.data) ? null : orderRows.data));
  if (!waiting.ok) return reportOut({ status: "held", detail: "Waiting orders could not be read. Nothing changed." });
  // The minds walk the same brain chain as Buddy. Each brain's key is read here, on the server, and never passed on.
  const think = makeMindThink(async (secretName: string) => {
    try {
      const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: secretName });
      return !error && typeof data === "string" && data.length > 0 ? data : null;
    } catch {
      return null;
    }
  });

  const logRow = async (orderIdForLog: string, entry: RunLog) => {
    await sb.from("minds_daily_log").insert({
      owner_id: owner,
      day: localDay,
      mind: entry.mind,
      action: clip(entry.action, 120),
      outcome: entry.outcome,
      detail: clip(entry.detail, 500),
      order_id: orderIdForLog,
    });
  };

  // The run's doors. The reads happen only when the run has been allowed to start.
  const runOneOrder = async (chosenId: string): Promise<{ status: string; detail: string }> => {
    const order = waiting.orders.find((item) => item.id === chosenId);
    if (!order) return { status: "nothing_to_do", detail: "That order is not waiting, or it cannot run yet." };
    return runAgainstSite(order.id, order.instruction, localDay, takeover, killScope, think, logRow, owner, sb);
  };

  // The team's brief, when the 08:00 clock sent one: the Analyst's read, the Strategist's plans and the CEO's order,
  // in the minds' own words. One log row, so the owner can read what the morning team planned. It changes nothing.
  if (brief) {
    await sb.from("minds_daily_log").insert({
      owner_id: owner,
      day: localDay,
      mind: "strategist",
      action: "The day's plan from the three minds",
      outcome: "done",
      detail: clip(brief, 500),
      order_id: null,
    });
  }

  const outcome = await runDay(
    {
      localDay,
      trigger: "owner",
      takeover,
      killScope,
      waiting: waiting.orders,
      orderId,
    },
    {
      createDailyOrder: async (day: string) => {
        const { data, error } = await sb.rpc("minds_queue_daily_run", { p_owner_id: owner, p_local_day: day });
        return !error && typeof data === "string" ? data : null;
      },
      runOrder: runOneOrder,
    },
  );

  // Gated packs follow the placement step, then the free doors. Takeover is on and Kill is off here (checked above).
  // The doors need no Gemini, so they run even when placement could not think. The packs step is skipped then,
  // because placement has already said so.
  // Only reached when Takeover and Kill allow the run. Doors the owner paused in chat. Read on its own, so a missing column never stops the run. A failed read pauses nothing.
  const pausedRow = await sb.from("minds_controls").select("paused_doors").eq("id", 1).maybeSingle();
  const pausedRaw = asRecord(pausedRow.data)?.paused_doors;
  const pausedDoors = pausedRow.error || !Array.isArray(pausedRaw) ? [] : pausedRaw.filter((item): item is string => typeof item === "string");
  const doors = await runDoorsSafely(sb, owner, localDay, takeover, killScope, pausedDoors);
  // The acts. A door send that did not go out is a notable of its own; a door that posted, and every door that
  // stayed quiet with its own plain reason, is told once per door per day. The Executioner did all of these, and each
  // one carries the log row and the buzz in the same telling.
  const acts = actPortsFor(sb, owner, localDay);
  for (const notice of doorFailNotices(doors.outcomes, localDay)) {
    await recordNotable(sb, owner, localDay, notice.mind, notice.kind, notice.title, notice.detail, notice.key);
  }
  // The RSS doors only ping the hub, so they are not counted as posts in the noticeable act.
  const posted = doors.outcomes.filter((item) => item.outcome === "posted");
  const postedReal = posted.filter((item) => !isRssDoor(item.door));
  const firstPost = postedReal[0];
  const articleTitle = firstPost?.articleTitle ?? "today's article";
  // An older article went out because nothing new was published. The telling says so, so the owner is never misled
  // into thinking it was a new one.
  const fromArchive = postedReal.some((item) => item.drip === true);
  if (postedReal.length > 0) {
    await reportAct(doorPostedAct("The free doors", articleTitle, localDay, fromArchive), acts);
  }
  // A quiet door is not silence: each one that did not post is told with the reason the door step gave. A step that
  // never reached a door at all (every door paused by the owner, or the step held) is told as one line, so the
  // morning is never quiet by accident.
  const quiet = doors.outcomes.filter((row) => row.outcome === "skipped" || row.outcome === "not_connected");
  if (quiet.length === 0 && posted.length === 0) {
    await reportAct(doorSkippedAct("The free doors", doors.detail, localDay), acts);
  }
  for (const item of quiet) {
    await reportAct(doorSkippedAct(DOORS[item.door].label, item.detail, localDay), acts);
  }
  // What the owner has already been told (Phase I slice 4). Read once, so the shop scan and the run's own acts
  // agree on what is news: the same telling is never made twice, and a day with nothing new stays Quiet.
  const told = await readToldTellings(sb, owner);
  // Shop facts the owner should hear about, then a placement job that really changed an article.
  // Each is written once (source keys). Neither can fail the day run.
  try {
    await scanShopNotables(sb, owner, localDay, told);
  } catch {
    // The shop scan is extra. Nothing else in the run depends on it.
  }
  // A product that sold nothing this week and nothing last week: told through the act list, never deleted, and only
  // once. Extra like the shop scan: a failure here never changes the day.
  try {
    for (const act of await scanDeadProducts(sb, localDay, told)) {
      await reportAct(act, acts);
    }
  } catch {
    // The dead-product check is extra. Nothing else in the run depends on it.
  }
  const job = planJobNotable(outcome.status, outcome.orderId);
  if (job) await recordNotable(sb, owner, localDay, job.mind, job.kind, job.title, job.detail, job.key);
  // The day's thinking steps: the Analyst, the Strategist and the CEO. They run on the day run (no order named),
  // and when the owner named a daily-run order. An explicitly named product-line order does not repeat these steps.
  // Per mind per local day: a mind with a done row today is not run again, and a failed or empty one may retry later.
  // Only when Takeover is on and Kill does not stop them (checked above, and again per mind).
  // Each writes its own daily-log row. Nothing here can fail the run.
  const namedDailyRun = orderId !== null && waiting.orders.some((order) => order.id === orderId && order.lane.lane === "daily_run");
  if (orderId === null || namedDailyRun) {
    try {
      await runLivingMindsForDay(sb, owner, localDay, takeover, killScope, think, waiting.orders);
    } catch {
      // The thinking steps are extra. Nothing else in the run depends on them.
    }
  }
  // Phase I slice 5: the rival pages the owner asked to watch, and the day's one US dollar price change. Both run
  // after the thinking minds (so a log row here never eats a mind's retry) and before the packs (so a pack's copy
  // carries the price the shop really shows). Each is extra: a failure in either never changes the day.
  try {
    await runCompetitorsForDay(sb, owner, localDay, takeover, killScope);
  } catch {
    // The rival reads are extra. Nothing else in the run depends on them.
  }
  try {
    const priced = await runPriceChange(
      { localDay, takeover, killScope },
      {
        readShop: async () => {
          const { data, error } = await sb
            .from("products")
            .select("id,name,price_cents,currency")
            .eq("is_active", true)
            .or("currency.eq.USD,currency.is.null")
            .order("name", { ascending: true })
            .limit(SHOP_LIMIT);
          if (error || !Array.isArray(data)) throw new Error("shop");
          return data.map((row: Record<string, unknown>): PriceProduct => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            priceUsd: typeof row.price_cents === "number" ? row.price_cents / 100 : null,
            currency: typeof row.currency === "string" ? row.currency : null,
          }));
        },
        readFacts: () => readMindFacts(sb),
        think: (request) => think(request),
        apply: async (candidate) => {
          const { data, error } = await sb.rpc("minds_apply_price_change", {
            p_owner_id: owner,
            p_product_id: candidate.productId,
            p_new_cents: Math.round(candidate.priceUsd * 100),
            p_local_day: localDay,
            p_why: candidate.why,
          });
          if (error) return { ok: false, reason: priceReasonFrom(error.message) };
          const row = asRecord(Array.isArray(data) ? data[0] : data);
          const fromCents = typeof row?.from_cents === "number" ? row.from_cents : null;
          const toCents = typeof row?.to_cents === "number" ? row.to_cents : null;
          if (fromCents === null || toCents === null) return { ok: false, reason: "The shop did not confirm the new price, so nothing is claimed about it." };
          return { ok: true, fromUsd: fromCents / 100, newUsd: toCents / 100 };
        },
        log: (entry) => acts.log({ mind: "executioner", action: entry.action, outcome: entry.outcome, detail: entry.detail }),
      },
    );
    if (priced.act) await reportAct(priced.act, acts);
  } catch {
    // The price check is extra. Nothing else in the run depends on it.
  }
  const doorsReply = { status: doors.status, posted: doors.posted };
  if (outcome.status === "cannot_think") {
    return reportOut({ status: outcome.status, detail: clip(`${outcome.detail} ${doors.detail}`, 800), order_id: outcome.orderId, doors: doorsReply });
  }
  const packs = await runPacksForDay(sb, owner, localDay, takeover, killScope, think, await readCaptionDraft(sb, owner, localDay));
  const detail = clip(`${orderOutcomeLine(outcome.status, outcome.detail)} ${packs.detail} ${doors.detail}`, 800);
  return reportOut({
    status: outcome.status,
    detail,
    order_id: outcome.orderId,
    packs: { status: packs.status, saved: packs.saved },
    doors: doorsReply,
  });
}

/**
 * Phase I slice 4: the tellings the owner has already heard, newest first. One read for the whole run, used by the
 * shop scan and by the acts the run reports itself. A failed read returns an empty list: memory that cannot be read
 * never silences a real telling.
 */
async function readToldTellings(sb: SupabaseClient, owner: string): Promise<ToldTelling[]> {
  try {
    const { data, error } = await sb
      .from("minds_notable_events")
      .select("title,detail,happened_at")
      .eq("owner_id", owner)
      .order("happened_at", { ascending: false })
      .limit(TOLD_LIMIT);
    if (error || !Array.isArray(data)) return [];
    return (data as Array<Record<string, unknown>>)
      .map((row) => ({
        day: typeof row.happened_at === "string" ? ownerDayOf(row.happened_at) : "",
        text: [typeof row.title === "string" ? row.title : "", typeof row.detail === "string" ? row.detail : ""].filter(Boolean).join(" "),
      }))
      .filter((item) => item.text.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Phase I slice 4: a product that sold nothing this week and nothing the 7 days before, and that has been on sale
 * through both weeks. Buddy never deletes a product. Each finding is told through the act list, so it is logged and
 * buzzed, and a finding the owner has already heard is not repeated. Never fails the run.
 */
async function scanDeadProducts(sb: SupabaseClient, localDay: string, told: readonly ToldTelling[]): Promise<ActWords[]> {
  try {
    const windows = deadProductWindows(new Date());
    const [productRead, orderRead] = await Promise.all([
      sb.from("products").select("id,name,created_at").eq("is_active", true).or("currency.eq.USD,currency.is.null").limit(SHOP_LIMIT),
      sb
        .from("orders")
        .select("id,created_at")
        .eq("payment_status", "paid")
        .gte("created_at", windows.lastStart)
        .order("created_at", { ascending: false })
        .limit(ORDER_READ_LIMIT),
    ]);
    if (productRead.error || orderRead.error) return [];
    const orderIds = (orderRead.data ?? []).map((row: Record<string, unknown>) => String(row.id ?? "")).filter(Boolean);
    const orderAt = new Map<string, string>();
    for (const row of orderRead.data ?? []) orderAt.set(String((row as Record<string, unknown>).id ?? ""), String((row as Record<string, unknown>).created_at ?? ""));
    const items: PaidItem[] = [];
    if (orderIds.length > 0) {
      const { data, error } = await sb.from("order_items").select("order_id,product_id").in("order_id", orderIds).limit(2000);
      if (error) return [];
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        items.push({ productId: typeof row.product_id === "string" ? row.product_id : null, at: orderAt.get(String(row.order_id ?? "")) ?? "" });
      }
    }
    const sales = salesByProduct(items, windows);
    const products: ProductSales[] = ((productRead.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const counted = sales.get(String(row.id));
      return {
        id: String(row.id),
        name: String(row.name ?? ""),
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
        paidThisWeek: counted?.thisWeek ?? 0,
        paidLastWeek: counted?.lastWeek ?? 0,
      };
    });
    // The same finding is never retold: memory holds what the owner has already heard, and only the new ones speak.
    return freshTellings(planDeadProductActs(products, windows, localDay), told).fresh;
  } catch {
    return [];
  }
}

/**
 * Phase I slice 4: the captions the owner drafted in the chat today, for today's pack. Read-only. Takeover is decided
 * by the pack step's own rule; this only finds the draft. Null when there is none, or when it cannot be read.
 */
async function readCaptionDraft(sb: SupabaseClient, owner: string, localDay: string): Promise<{ articleTitle: string; copy: PackCopy } | null> {
  try {
    const { data: chats, error: chatError } = await sb.from("buddy_chats").select("id").eq("owner_id", owner).order("updated_at", { ascending: false }).limit(5);
    if (chatError || !Array.isArray(chats) || chats.length === 0) return null;
    const chatIds = (chats as Array<Record<string, unknown>>).map((row) => String(row.id ?? "")).filter(Boolean);
    if (chatIds.length === 0) return null;
    const { data, error } = await sb
      .from("buddy_messages")
      .select("payload,created_at")
      .in("chat_id", chatIds)
      .eq("payload->>kind", "caption_draft")
      .order("created_at", { ascending: false })
      .limit(5);
    if (error || !Array.isArray(data)) return null;
    for (const row of data as Array<Record<string, unknown>>) {
      const draft = draftFromPayload(row.payload);
      if (draft && draft.day === localDay) return { articleTitle: draft.articleTitle, copy: draft.copy };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Writes one notable event, then buzzes the owner's devices when the kind buzzes. Never throws into the run.
 * A kind that buzzes and has no device, or no keys, is written once to the daily log, with the plain words for the owner.
 */
async function recordNotable(
  sb: SupabaseClient,
  owner: string,
  _localDay: string, // The skip line uses the row's own owner day (ownerDayOf), so the run day is not needed here.
  mind: string,
  kind: string,
  title: string,
  detail: string,
  sourceKey: string | null = null,
): Promise<PushStatus | null> {
  try {
    // A source key is sent only when there is one, so the run works before the source-key migration is applied.
    // A second row with the same key is refused by the database, so it is not written and does not buzz.
    const { data, error } = await sb
      .from("minds_notable_events")
      .insert({ owner_id: owner, mind, kind, title: clip(title, 160), detail: clip(detail, 500), ...(sourceKey ? { source_key: sourceKey } : {}) })
      .select("id,happened_at")
      .single();
    if (error || !data) return null;
    if (!shouldBuzz(kind)) return null;
    // The same claim-then-send path as every other owner push. The flush cannot send this row a second time.
    const row: NotableRow = {
      id: String(data.id),
      owner,
      mind,
      kind,
      title,
      happenedAt: String(data.happened_at ?? new Date().toISOString()),
      pushNote: null,
      claimedAt: null,
    };
    return await attemptRow(row, servicePushPorts(sb));
  } catch {
    return null;
  }
}

/**
 * Phase I slice 3: every act is told here. The log row and the notable that buzzes the phone are written together,
 * through the same notable helper the run already uses, so an act cannot happen silently and a push problem can
 * never take the log row with it.
 */
function actPortsFor(sb: SupabaseClient, owner: string, localDay: string): ActPorts {
  return {
    log: async (entry) => {
      const { error } = await sb.from("minds_daily_log").insert({
        owner_id: owner,
        day: localDay,
        mind: entry.mind,
        action: clip(entry.action, 120),
        outcome: entry.outcome,
        detail: clip(entry.detail, 500),
        order_id: null,
      });
      if (error) throw new Error("log");
    },
    notable: (kind, title, detail, key) => recordNotable(sb, owner, localDay, "executioner", kind, title, detail, key),
  };
}

/** The door step never throws into the run. A read or write failure is a plain held step, and nothing more is sent. */
async function runDoorsSafely(
  sb: SupabaseClient,
  owner: string,
  localDay: string,
  takeover: boolean,
  killScope: KillScope,
  pausedDoors: string[],
): Promise<DoorRunResult> {
  try {
    return await runDoorsForDay(sb, owner, localDay, takeover, killScope, pausedDoors);
  } catch {
    await recordNotable(sb, owner, localDay, "executioner", "mind_failed", "The free doors could not run", "Nothing was posted. Check the log.");
    return { status: "held", detail: "The free doors could not be read or written. Nothing was posted.", posted: 0, outcomes: [] };
  }
}

async function runDoorsForDay(
  sb: SupabaseClient,
  owner: string,
  localDay: string,
  takeover: boolean,
  killScope: KillScope,
  pausedDoors: string[],
): Promise<DoorRunResult> {
  const siteOrigin = env("SITE_URL") || null;
  const nowMs = Date.now();
  const since = new Date(nowMs - DOOR_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return runDoors(
    { localDay, takeover, killScope, nowMs, siteOrigin, pausedDoors },
    {
      readArticles: async () => {
        const { data, error } = await sb
          .from("posts")
          .select("id,title,slug,published_at,cover_image")
          .eq("status", "published")
          .gte("published_at", since)
          .order("published_at", { ascending: false })
          .limit(20);
        if (error || !Array.isArray(data)) throw new Error("articles");
        return data.map((row: Record<string, unknown>): DoorArticle => ({
          id: String(row.id),
          title: String(row.title ?? ""),
          slug: typeof row.slug === "string" ? row.slug : null,
          publishedAt: typeof row.published_at === "string" ? row.published_at : null,
          coverImage: typeof row.cover_image === "string" ? row.cover_image : null,
        }));
      },
      readPostedIds: async (door) => {
        const { data, error } = await sb.from("minds_door_posts").select("post_id").eq("owner_id", owner).eq("door", door);
        if (error || !Array.isArray(data)) throw new Error("posted");
        return new Set(data.map((row: Record<string, unknown>) => String(row.post_id)));
      },
      countToday: async (door, day) => {
        const { count, error } = await sb
          .from("minds_door_posts")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", owner)
          .eq("door", door)
          .eq("local_day", day)
          .in("status", ["queued", "posted"]);
        if (error) throw new Error("count");
        return count ?? 0;
      },
      // Phase I slice 5: the day's drip rows. The doors may send an older article only when nothing new is in the
      // window, and never more than three articles a day (the database's own rule). A failed read returns null, so
      // nothing older is stamped blind.
      countDripsToday: async (day) => {
        const { count, error } = await sb
          .from("post_drip_days")
          .select("post_id", { count: "exact", head: true })
          .eq("owner_id", owner)
          .eq("local_day", day);
        if (error) throw new Error("drips");
        return count ?? 0;
      },
      recordDrip: async (articleId, day) => {
        const { error } = await sb.rpc("minds_record_drip", { p_owner_id: owner, p_local_day: day, p_post_id: articleId });
        return !error;
      },
      readSecret: async (name) => {
        const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: name });
        if (error) throw new Error("secret");
        return typeof data === "string" && data.length > 0 ? data : null;
      },
      reserve: async (door, articleId, day, articleUrl) => {
        const { data, error } = await sb.rpc("minds_reserve_door_post", {
          p_owner_id: owner,
          p_door: door,
          p_post_id: articleId,
          p_local_day: day,
          p_article_url: articleUrl,
        });
        if (error) return { ok: false, reason: reasonFrom(error.message) };
        return typeof data === "string" ? { ok: true, id: data } : { ok: false, reason: "failed" };
      },
      loadImage: (cover, origin) => fetchArticleImage(cover, origin),
      loadVideo: async (articleId, day): Promise<VideoLoad> => {
        // The pack's saved MP4 for this article and day. Only a "ready" pack counts.
        const { data, error } = await sb
          .from("minds_packs")
          .select("video_path")
          .eq("owner_id", owner)
          .eq("post_id", articleId)
          .eq("local_day", day)
          .eq("status", "ready")
          .not("video_path", "is", null)
          .limit(1);
        if (error) return { ok: false, reason: "not_readable" };
        const path = Array.isArray(data) && typeof data[0]?.video_path === "string" ? data[0].video_path : null;
        if (!path) return { ok: false, reason: "no_video" };
        const { data: file, error: fileError } = await sb.storage.from("pack-videos").download(path);
        if (fileError || !file || file.size === 0 || file.size > VIDEO_MAX_BYTES) return { ok: false, reason: "not_readable" };
        const contentType = path.toLowerCase().endsWith(".mp4") ? "video/mp4" : file.type;
        return { ok: true, data: await file.arrayBuffer(), contentType, bytes: file.size };
      },
      loadAudio: async (articleId): Promise<AudioLoad> => {
        // The episode's audio is the public podcast bucket's file named by the article id. Only an MP3 counts.
        const path = `${articleId}.mp3`;
        const { data: file, error: fileError } = await sb.storage.from("podcast-audio").download(path);
        if (fileError || !file) return { ok: false, reason: "no_audio" };
        if (file.size === 0) return { ok: false, reason: "no_audio" };
        if (file.type !== "audio/mpeg") return { ok: false, reason: "not_readable" };
        return { ok: true, path, bytes: file.size, contentType: "audio/mpeg" };
      },
      send: async (door, values, text, key, extra) => {
        const media = extra.media;
        const video = media && media.kind === "video" ? { data: media.data, contentType: media.contentType, bytes: media.bytes } : null;
        if (door === "telegram") {
          return sendTelegram({ token: values.telegram_bot_token ?? "", chatId: values.telegram_chat_id ?? "" }, text, fetch);
        }
        if (door === "discord") return sendDiscord(values.discord_webhook_url ?? "", text, fetch);
        if (door === "bluesky") {
          return sendBluesky({ handle: values.bluesky_handle ?? "", appPassword: values.bluesky_app_password ?? "" }, text, fetch);
        }
        if (door === "mastodon") {
          return sendMastodon({ instanceUrl: values.mastodon_instance_url ?? "", accessToken: values.mastodon_access_token ?? "" }, text, key, fetch);
        }
        if (door === "tumblr") {
          return sendTumblr(
            {
              consumerKey: values.tumblr_consumer_key ?? "",
              consumerSecret: values.tumblr_consumer_secret ?? "",
              accessToken: values.tumblr_access_token ?? "",
              tokenSecret: values.tumblr_token_secret ?? "",
              blogName: values.tumblr_blog_name ?? "",
            },
            text,
            fetch,
          );
        }
        if (door === "blogger") {
          return sendBlogger(
            {
              clientId: values.blogger_client_id ?? "",
              clientSecret: values.blogger_client_secret ?? "",
              refreshToken: values.blogger_refresh_token ?? "",
              blogId: values.blogger_blog_id ?? "",
            },
            text,
            fetch,
          );
        }
        if (door === "medium") {
          return sendMedium({ accessToken: values.medium_integration_token ?? "" }, text, fetch);
        }
        if (door === "wordpress_com") {
          return sendWordPressCom(
            { site: values.wordpress_com_site ?? "", accessToken: values.wordpress_com_access_token ?? "" },
            text,
            fetch,
          );
        }
        if (door === "pixelfed") {
          const image = media && media.kind === "image" ? { data: media.data, contentType: media.contentType } : null;
          return sendPixelfed(
            { instanceUrl: values.pixelfed_instance_url ?? "", accessToken: values.pixelfed_access_token ?? "" },
            text,
            image,
            key,
            fetch,
          );
        }
        if (door === "youtube") {
          return sendYouTube(
            {
              clientId: values.youtube_client_id ?? "",
              clientSecret: values.youtube_client_secret ?? "",
              refreshToken: values.youtube_refresh_token ?? "",
            },
            text,
            extra.title,
            video,
            fetch,
          );
        }
        if (door === "vimeo") {
          return sendVimeo({ accessToken: values.vimeo_access_token ?? "" }, text, extra.title, video, fetch);
        }
        if (isRssDoor(door)) {
          // The RSS doors read the site feed and ping the free hub. Nothing is posted. The feed address comes from the site setting.
          const site = (env("SITE_URL") || "").replace(/\/+$/, "");
          return sendRssPing(site ? `${site}/rss.xml` : "", fetch);
        }
        if (door === "podcast") {
          // The feed is the door: an episode row is written, and /podcast.xml lists it. Nothing is sent elsewhere.
          if (!media || media.kind !== "audio") return { ok: false, reason: "audio not made yet." };
          const { data: episode, error: episodeError } = await sb
            .from("podcast_episodes")
            .insert({
              owner_id: owner,
              post_id: extra.articleId,
              title: extra.title.slice(0, 200),
              description: text.slice(0, 4000),
              article_url: extra.articleUrl,
              audio_path: media.path,
              audio_bytes: media.bytes,
              audio_type: media.contentType,
            })
            .select("id")
            .single();
          if (episodeError || !episode) return { ok: false, reason: "The podcast feed could not be updated." };
          return { ok: true, externalRef: String(episode.id) };
        }
        return { ok: false, reason: "This door is not open." };
      },
      finish: async (id, status, externalRef, errorNote) => {
        const { error } = await sb.rpc("minds_finish_door_post", {
          p_id: id,
          p_status: status,
          p_external_ref: externalRef,
          p_error_note: errorNote,
        });
        if (error) throw new Error("finish");
      },
      readPendingPosts: async (door, day) => {
        // Queued rows from today for this door whose record was not saved yet. Owner scoped.
        const { data, error } = await sb
          .from("minds_door_posts")
          .select("id,pending_status,external_ref,error_note")
          .eq("owner_id", owner)
          .eq("door", door)
          .eq("local_day", day)
          .eq("status", "queued");
        if (error || !Array.isArray(data)) throw new Error("pending");
        return data.map((row: Record<string, unknown>) => ({
          id: String(row.id),
          pendingStatus: row.pending_status === "posted" || row.pending_status === "failed" ? row.pending_status : null,
          externalRef: typeof row.external_ref === "string" ? row.external_ref : null,
          errorNote: typeof row.error_note === "string" ? row.error_note : null,
        }));
      },
      markPending: async (id, status, externalRef, errorNote) => {
        const { error } = await sb.rpc("minds_mark_door_post_pending", {
          p_id: id,
          p_status: status,
          p_external_ref: externalRef,
          p_error_note: errorNote,
        });
        if (error) throw new Error("pending");
      },
      log: async (entry) => {
        await sb.from("minds_daily_log").insert({
          owner_id: owner,
          day: localDay,
          mind: "executioner",
          action: doorLogAction(entry.door, DOOR_LABEL[entry.door] ?? entry.door, entry.outcome),
          outcome: entry.outcome,
          detail: clip(entry.detail, 500),
          order_id: null,
        });
      },
    },
  );
}

/** Makes today's gated packs for one article, through the pack door. Reads the site first; nothing is read when Takeover is off. */
/**
 * Reads the owner's measured successful posts over the lookback (packs marked "I posted this", and door sends that really went out,
 * RSS pings excluded) and ranks the posting windows. Any failed read keeps the current windows.
 */
/**
 * The three thinking steps for one local day. A mind with a done row today is skipped; the others run (a failed, skipped or
 * empty mind may retry the same day). Skipped entirely when the check itself cannot be read, so a flaky read never runs
 * them twice. Facts are read here, never by a mind.
 */
async function runLivingMindsForDay(
  sb: SupabaseClient,
  owner: string,
  localDay: string,
  takeover: boolean,
  killScope: KillScope,
  think: ReturnType<typeof makeMindThink>,
  orders: Array<{ instruction: string }>,
): Promise<void> {
  // Each mind is read on its own: a done row means no retry today; a failed, skipped or missing row may be retried.
  const today = await sb.from("minds_daily_log").select("mind,action,outcome").eq("owner_id", owner).eq("day", localDay).in("mind", [...LIVING_MINDS]);
  if (today.error) return;
  const rows = (today.data ?? []) as Array<{ mind: string; action: string; outcome: string }>;
  const doneToday = LIVING_MINDS.filter((mind) => rows.some((row) => row.mind === mind && row.outcome === "done"));
  const stoppedToday = LIVING_MINDS.filter((mind) => rows.some((row) => row.mind === mind && row.action === STOPPED_ACTION));
  if (doneToday.length === LIVING_MINDS.length) return;
  const ports: LivingMindPorts = {
    think: (request) => think(request),
    log: async (entry) => {
      await sb.from("minds_daily_log").insert({
        owner_id: owner,
        day: localDay,
        mind: entry.mind,
        action: clip(entry.action, 120),
        outcome: entry.outcome,
        detail: clip(entry.detail, 500),
        order_id: null,
      });
    },
  };
  // The same memory the 08:00 clock gives the minds: the facts, the last telling, and the owner's own chat. Read
  // once here; a memory that cannot be read leaves the minds with the facts alone.
  const facts = await readMindFacts(sb);
  let memory: string | null = null;
  try {
    memory = await readMemoryBlock(sb, owner, facts);
  } catch {
    memory = null;
  }
  await runLivingMinds(ports, {
    takeover,
    killScope,
    facts: factsWithMemory(facts, memory),
    orders: orders.map((order) => order.instruction),
    doneToday,
    stoppedToday,
  });
}

/**
 * Phase I slice 5: the rival pages the owner asked Buddy to watch, read ten at most a day, oldest first, public pages
 * only. A page that really changed is told through the notable list (which buzzes the phone, and is read by the
 * briefing and the night report) and through the daily log. A page that changed nothing says nothing. A page that
 * could not be read is not recorded, so it is tried again next run, and nothing is ever claimed about it.
 *
 * The daily-log rows name the Executioner, who carried the read out. The notable names the Strategist, the mind that
 * watches rivals. Neither uses a thinking mind's name, so a row written here never stops a mind's own retry today.
 * Only reached when Takeover is on and Kill allows the run.
 */
async function runCompetitorsForDay(sb: SupabaseClient, owner: string, localDay: string, takeover: boolean, killScope: KillScope): Promise<void> {
  const savedRead = await sb
    .from("minds_competitors")
    .select("id,url,label,last_read_at,last_title,last_fingerprint")
    .eq("owner_id", owner)
    .order("last_read_at", { ascending: true, nullsFirst: true })
    .limit(COMPETITOR_SAVE_LIMIT);
  if (savedRead.error || !Array.isArray(savedRead.data)) return;
  const saved: SavedCompetitor[] = savedRead.data.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    url: String(row.url ?? ""),
    label: typeof row.label === "string" && row.label ? row.label : competitorLabel(String(row.url ?? "")),
    lastReadAt: typeof row.last_read_at === "string" ? row.last_read_at : null,
    lastTitle: typeof row.last_title === "string" ? row.last_title : null,
    lastFingerprint: typeof row.last_fingerprint === "string" ? row.last_fingerprint : null,
  }));
  const lines: string[] = [];
  const result = await runCompetitorReads(
    { localDay, takeover, killScope },
    {
      readSaved: async () => saved,
      readReadToday: async () => {
        const { data, error } = await sb.from("minds_competitor_reads").select("competitor_id").eq("owner_id", owner).eq("local_day", localDay);
        if (error || !Array.isArray(data)) throw new Error("reads");
        return new Set(data.map((row: Record<string, unknown>) => String(row.competitor_id)));
      },
      readPage: (url) => fetchCompetitorPage(url),
      recordRead: async (read, page, changeNote, day) => {
        const { error } = await sb.rpc("minds_record_competitor_read", {
          p_owner_id: owner,
          p_competitor_id: read.id,
          p_local_day: day,
          p_title: page.title,
          p_fingerprint: page.fingerprint,
          p_change_note: changeNote,
        });
        return !error;
      },
      log: async (line) => {
        lines.push(line);
      },
    },
  );
  if (result.status !== "done") return;
  // One row for the day's read, then one row for each page that really changed. A day where no page could be read is
  // told as a skip, with the step's own reasons, so a rival step that did nothing is never silent about it.
  await sb.from("minds_daily_log").insert({
    owner_id: owner,
    day: localDay,
    mind: "executioner",
    action: "Read the rival pages",
    outcome: result.read > 0 ? "done" : "skipped",
    detail: clip(result.read > 0 ? result.detail : lines.join(" ") || result.detail, 500),
    order_id: null,
  });
  for (const change of result.changes) {
    await sb.from("minds_daily_log").insert({
      owner_id: owner,
      day: localDay,
      mind: "executioner",
      action: "Rival page changed",
      outcome: "done",
      detail: clip(change.detail, 500),
      order_id: null,
    });
    await recordNotable(sb, owner, localDay, "strategist", COMPETITOR_CHANGE_KIND, change.title, change.detail, change.key);
  }
}

/** This week and last week, as counts only: article views and paid orders. A failed read says so, and is never a guess. */
async function readMindFacts(sb: SupabaseClient): Promise<string> {
  const w = weekWindows(new Date());
  const views = (from: string, to: string) => sb.from("article_views").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to);
  const paid = (from: string, to: string) => sb.from("orders").select("id", { count: "exact", head: true }).eq("payment_status", "paid").gte("created_at", from).lt("created_at", to);
  const [tv, lv, tp, lp] = await Promise.all([views(w.thisStart, w.end), views(w.lastStart, w.thisStart), paid(w.thisStart, w.end), paid(w.lastStart, w.thisStart)]);
  if (tv.error || lv.error || tp.error || lp.error) return "The site numbers could not be read this run.";
  return `Last 7 days: ${tv.count ?? 0} article views and ${tp.count ?? 0} paid orders. The 7 days before: ${lv.count ?? 0} article views and ${lp.count ?? 0} paid orders.`;
}

async function readWindowLearning(sb: SupabaseClient, owner: string, now: Date): Promise<WindowLearning> {
  const since = new Date(now.getTime() - LEARN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [packs, doors] = await Promise.all([
    sb.from("minds_packs").select("posted_at").eq("owner_id", owner).eq("status", "posted_by_owner").gte("posted_at", since).limit(5000),
    sb.from("minds_door_posts").select("door,posted_at").eq("owner_id", owner).eq("status", "posted").gte("posted_at", since).limit(5000),
  ]);
  if (packs.error || doors.error) return learnWindows([], false);
  const times: string[] = [];
  for (const row of packs.data ?? []) if (typeof row.posted_at === "string") times.push(row.posted_at);
  for (const row of doors.data ?? []) {
    const name = row.door;
    if (typeof name !== "string" || isRssDoor(name) || typeof row.posted_at !== "string") continue;
    times.push(row.posted_at);
  }
  return learnWindows(times, true);
}

async function runPacksForDay(
  sb: SupabaseClient,
  owner: string,
  localDay: string,
  takeover: boolean,
  killScope: KillScope,
  think: ReturnType<typeof makeMindThink>,
  drafted: { articleTitle: string; copy: PackCopy } | null = null,
): Promise<DayPacksResult> {
  const siteOrigin = env("SITE_URL") || null;
  const [existing, articleRows, slotRows, productRows, templateRow] = await Promise.all([
    sb.from("minds_packs").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("local_day", localDay),
    sb.from("posts").select("id,title,slug,cover_image").eq("status", "published").order("published_at", { ascending: false }).limit(ARTICLE_LIMIT),
    sb.from("post_product_slots").select("post_id,product_id").eq("owner_id", owner).is("removed_at", null),
    sb.from("products").select("id,name,is_digital,price_cents").eq("is_active", true).or("currency.eq.USD,currency.is.null").order("name", { ascending: true }).limit(SHOP_LIMIT),
    sb.from("video_templates").select("id").eq("is_active", true).maybeSingle(),
  ]);
  if (existing.error || articleRows.error || slotRows.error || productRows.error) {
    return { status: "held", detail: "Site reads for the packs failed. Nothing changed.", saved: 0, postId: null };
  }
  const hasVideoLook = Boolean(!templateRow?.error && templateRow?.data?.id);
  const liveByPost = new Map<string, string[]>();
  for (const slot of slotRows.data ?? []) {
    const key = String(slot.post_id);
    liveByPost.set(key, [...(liveByPost.get(key) ?? []), String(slot.product_id)]);
  }
  const articles: PackSource[] = (articleRows.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    title: String(row.title ?? "Untitled"),
    slug: typeof row.slug === "string" ? row.slug : null,
    coverImage: typeof row.cover_image === "string" ? row.cover_image : null,
    liveProductIds: liveByPost.get(String(row.id)) ?? [],
  }));
  const shop = (productRows.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    isDigital: row.is_digital === true,
    priceUsd: typeof row.price_cents === "number" ? row.price_cents / 100 : null,
  }));
  let readyPacks = 0;
  let blockedPacks = 0;
  const learning = await readWindowLearning(sb, owner, new Date());
  const result = await runDayPacks(
    { localDay, takeover, killScope, articles, shop, siteOrigin, alreadyMade: (existing.count ?? 0) > 0, learning, draftedCopy: drafted, hasVideoLook },
    {
      think,
      checkImage: (cover, origin) => checkArticleImage(cover, origin),
      savePack: async (row: PackRow) => {
        const { error } = await sb.rpc("minds_save_pack", {
          p_owner_id: owner,
          p_channel: row.channel,
          p_local_day: row.localDay,
          p_post_id: row.postId,
          p_suggested_at_utc: row.suggestedAtUtc,
          p_suggested_label: row.suggestedLabel,
          p_caption: row.caption,
          p_pin_title: row.pinTitle,
          p_pin_description: row.pinDescription,
          p_article_url: row.articleUrl,
          p_image_path: row.imagePath,
          p_video_path: row.videoPath,
          p_product_ids: row.productIds,
          p_status: row.status,
          p_blocked_reason: row.blockedReason,
          p_auditor_verdict: row.auditorVerdict,
          p_auditor_note: row.auditorNote,
        });
        if (!error && row.status === "ready") readyPacks += 1;
        if (!error && row.status === "blocked") blockedPacks += 1;
        return error ? { ok: false, reason: reasonFrom(error.message) } : { ok: true };
      },
      log: async (entry) => {
        await sb.from("minds_daily_log").insert({
          owner_id: owner,
          day: localDay,
          mind: entry.mind,
          action: clip(entry.action, 120),
          outcome: entry.outcome,
          detail: clip(entry.detail, 500),
          order_id: null,
        });
      },
    },
  );
  // A saved pack is an act, and so is a pack the Auditor held back. Both are told: the log row, the buzz, the
  // briefing and the night report, with the honest status of each pack. Nothing was posted for the owner.
  if (readyPacks > 0 || blockedPacks > 0) {
    await reportAct(packSavedAct(readyPacks, blockedPacks, localDay), actPortsFor(sb, owner, localDay));
  }
  return result;
}

/**
 * Reads the shop's paid orders, today's product clicks and sources, and writes what is new as notable events.
 * Only the day run calls this, so Takeover and Kill already allowed the run. Reads only; writes are notable rows.
 */
async function scanShopNotables(sb: SupabaseClient, owner: string, localDay: string, told: readonly ToldTelling[]): Promise<ScanResult> {
  const window = ownerDayWindow(localDay);
  const ports: NotablePorts = {
    // Memory: a telling the owner has already heard is not written again (Phase I slice 4).
    readTold: async (): Promise<ToldTelling[]> => [...told],
    readPaidOrders: async (sinceIso: string): Promise<OrderRow[] | null> => {
      const { data, error } = await sb
        .from("orders")
        .select("id,amount,currency")
        .eq("payment_status", "paid")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error || !Array.isArray(data)) return null;
      return data.map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ""),
        amount: typeof row.amount === "number" ? row.amount : null,
        currency: typeof row.currency === "string" ? row.currency : null,
      }));
    },
    readClicks: async (startIso: string, endIso: string): Promise<ClickRow[] | null> => {
      const { data, error } = await sb
        .from("product_clicks")
        .select("source")
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .limit(2000);
      if (error || !Array.isArray(data)) return null;
      return data.map((row: Record<string, unknown>) => ({ source: typeof row.source === "string" ? row.source : null }));
    },
    readEarlierSources: async (sources: string[], beforeIso: string): Promise<string[] | null> => {
      const { data, error } = await sb
        .from("product_clicks")
        .select("source")
        .in("source", sources)
        .lt("created_at", beforeIso)
        .limit(2000);
      if (error || !Array.isArray(data)) return null;
      return data.map((row: Record<string, unknown>) => String(row.source ?? "")).filter((item) => item.length > 0);
    },
    // This week (last 7 days) against last week (the 7 days before): paid orders and article views. Counts only.
    readWeekCounts: async (now: Date): Promise<WeekFacts | null> => {
      const w = weekWindows(now);
      const views = (from: string, to: string) =>
        sb.from("article_views").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to);
      const paid = (from: string, to: string) =>
        sb.from("orders").select("id", { count: "exact", head: true }).eq("payment_status", "paid").gte("created_at", from).lt("created_at", to);
      const [tv, lv, tp, lp] = await Promise.all([views(w.thisStart, w.end), views(w.lastStart, w.thisStart), paid(w.thisStart, w.end), paid(w.lastStart, w.thisStart)]);
      const ok = !tv.error && !lv.error && !tp.error && !lp.error;
      return {
        ok,
        thisWeek: { views: tv.count ?? 0, paid: tp.count ?? 0 },
        lastWeek: { views: lv.count ?? 0, paid: lp.count ?? 0 },
      };
    },
    record: async (plan: NotablePlan): Promise<boolean> => {
      const status = await recordNotable(sb, owner, localDay, plan.mind, plan.kind, plan.title, plan.detail, plan.key);
      return status !== null;
    },
    // The daily log line a person can read later. Server writer only, same day as the event.
    logLine: async (plan: NotablePlan): Promise<void> => {
      await sb.from("minds_daily_log").insert({
        owner_id: owner,
        day: localDay,
        mind: plan.mind,
        action: clip(plan.title, 120),
        outcome: "done",
        detail: clip(plan.detail, 500),
      });
    },
  };
  return scanNotableSources(ports, {
    now: new Date(),
    localDay,
    dayStartIso: window.start,
    dayEndIso: window.end,
  });
}

/** Reads the site for one order, runs the placement, and writes through the database doors. */
async function runAgainstSite(
  orderId: string,
  instruction: string,
  localDay: string,
  takeover: boolean,
  killScope: KillScope,
  think: ReturnType<typeof makeMindThink>,
  logRow: (orderIdForLog: string, entry: RunLog) => Promise<void>,
  owner: string,
  sb: SupabaseClient,
): Promise<RunOutcome> {
  // Reads for the run: articles, shop, slots, the minds' past edits, and today's drip.
  const [articleRows, productRows, slotRows, editRows, dripRows] = await Promise.all([
    sb.from("posts").select("id,title,content").eq("status", "published").order("published_at", { ascending: false }).limit(ARTICLE_LIMIT),
    sb.from("products").select("id,name,is_digital,price_cents").eq("is_active", true).or("currency.eq.USD,currency.is.null").order("name", { ascending: true }).limit(SHOP_LIMIT),
    sb.from("post_product_slots").select("post_id,product_id").eq("owner_id", owner).is("removed_at", null),
    sb.from("post_product_edits").select("id,post_id,product_ids,sentences_added,applied_at").eq("owner_id", owner).order("applied_at", { ascending: true }).limit(EDIT_LIMIT),
    sb.from("post_drip_days").select("post_id").eq("owner_id", owner).eq("local_day", localDay),
  ]);
  if (articleRows.error || productRows.error || slotRows.error || editRows.error || dripRows.error) {
    return { status: "held", detail: "Site reads failed. Nothing changed." };
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
    order: { id: orderId, instruction },
    localDay,
    takeover,
    killScope,
    shop,
    articles,
    touchedToday: (dripRows.data ?? []).map((row: Record<string, unknown>) => String(row.post_id)),
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
      if (error) return { ok: false, reason: reasonFrom(error.message) };
      // The database writes the order_blocked notable in the same call. Its owner push is attempted here, once.
      await pushNewestNotable("order_blocked", ownerNotablePorts(sb, owner));
      return { ok: true };
    },
    log: (entry: RunLog) => logRow(orderId, entry),
    notable: async (kind, title, detail) => {
      await recordNotable(sb, owner, localDay, "auditor", kind, title, detail);
    },
  });

  return outcome;
}

Deno.serve(handleRun);
