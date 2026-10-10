// The Executioner's run on the owner's oldest waiting runnable order (a product line, or today's daily run).
// Owner only. The browser sends the owner's local day, and optionally one order id the owner chose.
// The run itself lives in _shared/placementRun.ts; the choice lives in _shared/runDay.ts.
// This file reads the state, hands the run its doors (database and Gemini), and reports back in plain words.
// Takeover off, or a Kill that stops the run: this returns before any read or log, and orders stay waiting.
// Nothing runs on a timer yet. The owner starts a run through Buddy.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { callerUser, env, serviceClient } from "../_shared/http.ts";
import { isAllowedAutomationOrigin } from "../_shared/automationKeyChecks.ts";
import { readWaitingOrders } from "../_shared/buddyOrders.ts";
import { makeMindThink } from "../_shared/mindThink.ts";
import { blockedDetail, runDay } from "../_shared/runDay.ts";
import { checkArticleImage, fetchArticleImage } from "../_shared/articleImage.ts";
import { runDayPacks, type DayPacksResult, type PackRow, type PackSource } from "../_shared/dayPacks.ts";
import { runDoors, type AudioLoad, type DoorRunResult, type VideoLoad } from "../_shared/runDoors.ts";
import { NO_DEVICE_COPY, PUSH_HELP_COPY, notifyOwnerDevices, shouldBuzz, type PushStatus } from "../_shared/notablePush.ts";
import type { PushTarget, VapidCredentials } from "../_shared/webPush.ts";
import { DOOR_WINDOW_DAYS, type DoorArticle } from "../_shared/doorPosts.ts";
import { planJobNotable, scanNotableSources, type ClickRow, type NotablePlan, type NotablePorts, type OrderRow, type ScanResult } from "../_shared/notableSources.ts";
import { ownerDayWindow } from "../_shared/mindsNightReport.ts";
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
const KEY_NAME = "gemini_api_key";
const ARTICLE_LIMIT = 20;
const SHOP_LIMIT = 200;
const EDIT_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KILL_SCOPES = ["none", "all", "analyst", "strategist", "ceo", "executioner", "auditor"] as const;
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
  const requestedOrder = asRecord(body)?.order_id;
  if (requestedOrder !== undefined && requestedOrder !== null && (typeof requestedOrder !== "string" || !UUID.test(requestedOrder))) {
    return reply(req, { error: "The order id is not valid." }, 400);
  }
  const orderId = typeof requestedOrder === "string" ? requestedOrder : null;

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

  // Takeover off, or Kill on a mind the run needs: nothing else is read, nothing is logged, orders stay waiting.
  const blocked = blockedDetail(takeover, killScope);
  if (blocked) return reply(req, { status: "held", detail: blocked, order_id: orderId });

  // The owner's waiting orders, oldest first. Other orders wait.
  const orderRows = await sb
    .from("buddy_orders")
    .select("id,instruction,mind,status,created_at")
    .eq("owner_id", owner)
    .eq("status", "waiting")
    .order("created_at", { ascending: true })
    .limit(50);
  const waiting = await readWaitingOrders(async () => (orderRows.error || !Array.isArray(orderRows.data) ? null : orderRows.data));
  if (!waiting.ok) return reply(req, { status: "held", detail: "Waiting orders could not be read. Nothing changed." });
  const think = makeMindThink(async () => {
    try {
      const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: KEY_NAME });
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
  const doors = await runDoorsSafely(sb, owner, localDay, takeover, killScope);
  if (doors.posted > 0) {
    await recordNotable(
      sb,
      owner,
      localDay,
      "executioner",
      "door_posted",
      `${doors.posted} ${doors.posted === 1 ? "free door posted" : "free doors posted"} today`,
      "The Executioner sent these. Each one is in the log.",
    );
  }
  // Shop facts the owner should hear about, then a placement job that really changed an article.
  // Each is written once (source keys). Neither can fail the day run.
  try {
    await scanShopNotables(sb, owner, localDay);
  } catch {
    // The shop scan is extra. Nothing else in the run depends on it.
  }
  const job = planJobNotable(outcome.status, outcome.orderId);
  if (job) await recordNotable(sb, owner, localDay, job.mind, job.kind, job.title, job.detail, job.key);
  const doorsReply = { status: doors.status, posted: doors.posted };
  if (outcome.status === "cannot_think") {
    return reply(req, { status: outcome.status, detail: clip(`${outcome.detail} ${doors.detail}`, 800), order_id: outcome.orderId, doors: doorsReply });
  }
  const packs = await runPacksForDay(sb, owner, localDay, takeover, killScope, think);
  const detail = clip(`${outcome.detail} ${packs.detail} ${doors.detail}`, 800);
  return reply(req, {
    status: outcome.status,
    detail,
    order_id: outcome.orderId,
    packs: { status: packs.status, saved: packs.saved },
    doors: doorsReply,
  });
}

/** The three VAPID values from Vault (the same reads the push handler makes), or null when any one is missing. */
async function loadPushCredentials(sb: SupabaseClient): Promise<VapidCredentials | null> {
  const read = async (name: string): Promise<string | null> => {
    try {
      const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: name });
      return !error && typeof data === "string" && data.trim().length > 0 ? data.trim() : null;
    } catch {
      return null;
    }
  };
  const publicKey = await read("vapid_public_key");
  const subject = await read("vapid_subject");
  const privateKey = await read("vapid_private_key");
  return publicKey && subject && privateKey ? { publicKey, subject, privateKey } : null;
}

/**
 * Writes one notable event, then buzzes the owner's devices when the kind buzzes. Never throws into the run.
 * A kind that buzzes and has no device, or no keys, is written once to the daily log, with the plain words for the owner.
 */
async function recordNotable(
  sb: SupabaseClient,
  owner: string,
  localDay: string,
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
      .select("id")
      .single();
    if (error || !data) return null;
    if (!shouldBuzz(kind)) return null;
    const outcome = await notifyOwnerDevices(kind, title, {
      loadCredentials: () => loadPushCredentials(sb),
      loadTargets: async (): Promise<PushTarget[]> => {
        const { data: rows, error: rowsError } = await sb.rpc("push_test_targets", { p_owner_user_id: owner, p_limit: 10 });
        if (rowsError || !Array.isArray(rows)) throw new Error("targets");
        return rows.map((row: Record<string, unknown>) => ({
          id: String(row.id ?? ""),
          device_id: typeof row.device_id === "string" ? row.device_id : undefined,
          endpoint: String(row.endpoint ?? ""),
          p256dh: String(row.p256dh ?? ""),
          auth_key: String(row.auth_key ?? ""),
        }));
      },
      markGone: async (target: PushTarget) => {
        if (!target.id) return;
        await sb.from("push_device_subscriptions").update({ enabled: false, revoked_at: new Date().toISOString() }).eq("id", target.id);
      },
    });
    await sb.from("minds_notable_events").update({ push_note: outcome.status }).eq("id", data.id);
    if (outcome.status === "no_device" || outcome.status === "not_configured") {
      await sb.from("minds_daily_log").insert({
        owner_id: owner,
        day: localDay,
        mind,
        action: "Owner phone push",
        outcome: "skipped",
        detail: clip(outcome.status === "no_device" ? NO_DEVICE_COPY : PUSH_HELP_COPY, 500),
        order_id: null,
      });
    }
    return outcome.status;
  } catch {
    return null;
  }
}

/** The door step never throws into the run. A read or write failure is a plain held step, and nothing more is sent. */
async function runDoorsSafely(
  sb: SupabaseClient,
  owner: string,
  localDay: string,
  takeover: boolean,
  killScope: KillScope,
): Promise<DoorRunResult> {
  try {
    return await runDoorsForDay(sb, owner, localDay, takeover, killScope);
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
): Promise<DoorRunResult> {
  const siteOrigin = env("SITE_URL") || null;
  const nowMs = Date.now();
  const since = new Date(nowMs - DOOR_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return runDoors(
    { localDay, takeover, killScope, nowMs, siteOrigin },
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
          action: `Posted to ${entry.door}`,
          outcome: entry.outcome,
          detail: clip(entry.detail, 500),
          order_id: null,
        });
      },
    },
  );
}

/** Makes today's gated packs for one article, through the pack door. Reads the site first; nothing is read when Takeover is off. */
async function runPacksForDay(
  sb: SupabaseClient,
  owner: string,
  localDay: string,
  takeover: boolean,
  killScope: KillScope,
  think: ReturnType<typeof makeMindThink>,
): Promise<DayPacksResult> {
  const siteOrigin = env("SITE_URL") || null;
  const [existing, articleRows, slotRows, productRows] = await Promise.all([
    sb.from("minds_packs").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("local_day", localDay),
    sb.from("posts").select("id,title,slug,cover_image").eq("status", "published").order("published_at", { ascending: false }).limit(ARTICLE_LIMIT),
    sb.from("post_product_slots").select("post_id,product_id").eq("owner_id", owner).is("removed_at", null),
    sb.from("products").select("id,name,is_digital,price_cents").eq("is_active", true).or("currency.eq.USD,currency.is.null").order("name", { ascending: true }).limit(SHOP_LIMIT),
  ]);
  if (existing.error || articleRows.error || slotRows.error || productRows.error) {
    return { status: "held", detail: "Site reads for the packs failed. Nothing changed.", saved: 0, postId: null };
  }
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
  const result = await runDayPacks(
    { localDay, takeover, killScope, articles, shop, siteOrigin, alreadyMade: (existing.count ?? 0) > 0 },
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
  if (readyPacks > 0) {
    await recordNotable(
      sb,
      owner,
      localDay,
      "executioner",
      "pack_ready",
      `${readyPacks} gated ${readyPacks === 1 ? "pack is" : "packs are"} ready`,
      "Instagram, TikTok, Facebook and Pinterest packs are ready for you to post by hand. Nothing was posted for you.",
    );
  }
  return result;
}

/**
 * Reads the shop's paid orders, today's product clicks and sources, and writes what is new as notable events.
 * Only the day run calls this, so Takeover and Kill already allowed the run. Reads only; writes are notable rows.
 */
async function scanShopNotables(sb: SupabaseClient, owner: string, localDay: string): Promise<ScanResult> {
  const window = ownerDayWindow(localDay);
  const ports: NotablePorts = {
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
    record: async (plan: NotablePlan): Promise<boolean> => {
      const status = await recordNotable(sb, owner, localDay, plan.mind, plan.kind, plan.title, plan.detail, plan.key);
      return status !== null;
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
      return error ? { ok: false, reason: reasonFrom(error.message) } : { ok: true };
    },
    log: (entry: RunLog) => logRow(orderId, entry),
    notable: async (kind, title, detail) => {
      await recordNotable(sb, owner, localDay, "auditor", kind, title, detail);
    },
  });

  return outcome;
}

Deno.serve(handleRun);
