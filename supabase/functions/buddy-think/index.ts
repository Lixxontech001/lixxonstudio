import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { callerUser, env, serviceClient, sha256 } from "../_shared/http.ts";
import { isAllowedAutomationOrigin } from "../_shared/automationKeyChecks.ts";
import {
  callGemini,
  HISTORY_TURNS,
  handleBuddyThink,
  type BuddyThinkDeps,
  type ChatKind,
  type ChatRole,
  type GeminiTurn,
} from "../_shared/buddyThink.ts";
import { BRIEFING_NOTABLE_KINDS, briefingApplied, briefingDoors, briefingGaps, briefingNotables, briefingPacks, type BriefingFacts, type BriefingMindRow } from "../_shared/buddyBriefing.ts";
import { weekWindows, type WeekFacts } from "../_shared/buddyWeek.ts";
import { type MindLogLine, type MindName } from "../_shared/buddyRouter.ts";
import { controlChange, controlDoneLine, type ControlAction } from "../_shared/buddyControls.ts";
import { ownerClock } from "../_shared/mindsNightReport.ts";
import { STATE_DOOR_LIMIT, STATE_LOG_LIMIT, STATE_NOTABLE_LIMIT, STATE_ORDER_LIMIT, type BuddyStateFacts } from "../_shared/buddyStateFacts.ts";
import {
  SITE_ARTICLE_LIMIT,
  SITE_PRODUCT_LIMIT,
  siteFactsFromReads,
  type SiteFacts,
} from "../_shared/buddySiteFacts.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 4096;
const KEY_NAME = "gemini_api_key";
const LIMITS = { probe: { limit: 5, window: 600 }, ask: { limit: 30, window: 600 } } as const;

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
  return new Response(JSON.stringify(body), {
    status: cors ? status : 403,
    headers: { ...JSON_HEADERS, ...(cors || {}) },
  });
}

async function readBoundedBody(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return "";
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
  return new TextDecoder().decode(body);
}

/** Chat storage uses the owner's own session, so row-level security decides what is visible. */
function chatStore(userClient: SupabaseClient) {
  return {
    loadChat: async (chatId: string) => {
      const { data, error } = await userClient.from("buddy_chats").select("id,title").eq("id", chatId).maybeSingle();
      if (error || !data) return null;
      return { id: String(data.id), title: typeof data.title === "string" ? data.title : null };
    },
    loadHistory: async (chatId: string): Promise<GeminiTurn[] | null> => {
      const { data, error } = await userClient
        .from("buddy_messages")
        .select("role,content")
        .eq("chat_id", chatId)
        .in("kind", ["reply", "briefing"])
        .order("created_at", { ascending: false })
        .limit(HISTORY_TURNS);
      if (error || !Array.isArray(data)) return null;
      return data
        .reverse()
        .map((row: { role: string; content: string }) => ({
          role: row.role === "owner" ? "user" : "model",
          text: row.content,
        }) as GeminiTurn);
    },
    saveMessage: async (chatId: string, role: ChatRole, kind: ChatKind, content: string, payload: Record<string, unknown> | null = null) => {
      const row: Record<string, unknown> = { chat_id: chatId, role, kind, content };
      if (payload) row.payload = payload;
      const { error } = await userClient.from("buddy_messages").insert(row);
      return !error;
    },
    touchChat: async (chatId: string, title: string) => {
      await userClient.from("buddy_chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
      await userClient.from("buddy_chats").update({ title }).eq("id", chatId).is("title", null);
    },
    now: () => new Date(),
    getSeenAt: async () => {
      const { data, error } = await userClient.from("buddy_owner_state").select("last_seen_at").maybeSingle();
      if (error) return { ok: false as const };
      const seen = data?.last_seen_at;
      return { ok: true as const, seenAt: typeof seen === "string" ? seen : null };
    },
    markSeen: async (atIso: string) => {
      const { error } = await userClient
        .from("buddy_owner_state")
        .upsert({ last_seen_at: atIso, updated_at: atIso }, { onConflict: "owner_id" });
      return !error;
    },
    readBriefingFacts: async (sinceIso: string): Promise<BriefingFacts> => {
      // Packs from the last three days that still need the owner (ready to post by hand, or blocked).
      const packsSinceIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const [articles, orders, views, failures, mindRows, waitingOrders, appliedEdits, openGaps, packRead, doorRead, notableRead, messageRead] = await Promise.all([
        userClient
          .from("posts")
          .select("title", { count: "exact" })
          .eq("status", "published")
          .gt("published_at", sinceIso)
          .order("published_at", { ascending: false })
          .limit(5),
        userClient
          .from("orders")
          .select("amount,currency", { count: "exact" })
          .eq("payment_status", "paid")
          .gt("created_at", sinceIso)
          .limit(1000),
        userClient
          .from("article_views")
          .select("id", { count: "exact", head: true })
          .gt("created_at", sinceIso),
        userClient
          .from("automation_logs")
          .select("event_code", { count: "exact" })
          .eq("status", "failed")
          .gt("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(5),
        userClient
          .from("minds_daily_log")
          .select("happened_at,mind,action,outcome,detail")
          .gt("happened_at", sinceIso)
          .order("happened_at", { ascending: false })
          .limit(200),
        userClient
          .from("buddy_orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "waiting"),
        // The minds' applied article changes since the owner last looked. Owner session, so row-level security applies.
        userClient
          .from("post_product_edits")
          .select("post_id,product_ids,applied_at")
          .gt("applied_at", sinceIso)
          .order("applied_at", { ascending: false })
          .limit(5),
        // Product gaps not yet marked seen.
        userClient
          .from("minds_gap_notes")
          .select("angle,created_at")
          .is("seen_at", null)
          .order("created_at", { ascending: false })
          .limit(5),
        // The owner's packs that need him. Owner session, so row-level security applies.
        userClient
          .from("minds_packs")
          .select("channel,status,blocked_reason,post_id,created_at")
          .in("status", ["ready", "blocked"])
          .gt("created_at", packsSinceIso)
          .order("created_at", { ascending: false })
          .limit(10),
        // The free-door send log since the owner last looked: what went out, failed, or is still saving.
        // Owner session, so row-level security applies.
        userClient
          .from("minds_door_posts")
          .select("door,status,post_id,error_note,created_at")
          .gt("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(20),
        // The notable events the minds wrote since the owner last looked (only the kinds the briefing reads). Owner session.
        userClient
          .from("minds_notable_events")
          .select("kind,title,detail,happened_at")
          .in("kind", [...BRIEFING_NOTABLE_KINDS])
          .gt("happened_at", sinceIso)
          .order("happened_at", { ascending: false })
          .limit(50),
        // Reader form messages since the owner last looked. Only a count is read (head), never a name, an address or the text.
        // Read-only: Buddy never replies to a reader. Owner session, so row-level security applies.
        userClient
          .from("contact_messages")
          .select("id", { count: "exact", head: true })
          .gt("created_at", sinceIso),
      ]);
      const doorRows = (Array.isArray(doorRead.data) ? doorRead.data : []) as Array<{ door?: unknown; status?: unknown; post_id?: unknown; error_note?: unknown }>;
      // Titles and product names for the applied changes. A failed read leaves the names out, never guessed.
      const editRows = (Array.isArray(appliedEdits.data) ? appliedEdits.data : []) as Array<{ post_id?: unknown; product_ids?: unknown }>;
      const packRows = (Array.isArray(packRead.data) ? packRead.data : []) as Array<{ channel?: unknown; status?: unknown; blocked_reason?: unknown; post_id?: unknown }>;
      const postIds = [...new Set([...editRows, ...packRows, ...doorRows].map((row) => String(row.post_id || "")).filter(Boolean))];
      const productIds = [...new Set(editRows.flatMap((row) => (Array.isArray(row.product_ids) ? row.product_ids.map(String) : [])))];
      const [titleRead, nameRead] = await Promise.all([
        postIds.length ? userClient.from("posts").select("id,title").in("id", postIds) : Promise.resolve({ data: [], error: null }),
        productIds.length ? userClient.from("products").select("id,name").in("id", productIds) : Promise.resolve({ data: [], error: null }),
      ]);
      const postTitles: Record<string, string> = {};
      for (const row of (Array.isArray(titleRead.data) ? titleRead.data : []) as Array<{ id?: unknown; title?: unknown }>) {
        if (typeof row.id === "string" && typeof row.title === "string") postTitles[row.id] = row.title;
      }
      const productNames: Record<string, string> = {};
      for (const row of (Array.isArray(nameRead.data) ? nameRead.data : []) as Array<{ id?: unknown; name?: unknown }>) {
        if (typeof row.id === "string" && typeof row.name === "string") productNames[row.id] = row.name;
      }
      const appliedOk = !appliedEdits.error && !titleRead.error && !nameRead.error;
      const mindLogRows = Array.isArray(mindRows.data) ? mindRows.data : null;
      const titleRows = (Array.isArray(articles.data) ? articles.data : []) as Array<{ title?: unknown }>;
      // This week (last 7 days) against last week (the 7 days before): article views and paid orders. Counts only.
      const w = weekWindows(new Date());
      const weekViews = (from: string, to: string) =>
        userClient.from("article_views").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to);
      const weekPaid = (from: string, to: string) =>
        userClient.from("orders").select("id", { count: "exact", head: true }).eq("payment_status", "paid").gte("created_at", from).lt("created_at", to);
      const [tv, lv, tp, lp] = await Promise.all([weekViews(w.thisStart, w.end), weekViews(w.lastStart, w.thisStart), weekPaid(w.thisStart, w.end), weekPaid(w.lastStart, w.thisStart)]);
      const weeks: WeekFacts = {
        ok: !tv.error && !lv.error && !tp.error && !lp.error,
        thisWeek: { views: tv.count ?? 0, paid: tp.count ?? 0 },
        lastWeek: { views: lv.count ?? 0, paid: lp.count ?? 0 },
      };
      const orderRows = (Array.isArray(orders.data) ? orders.data : []) as Array<{ amount?: unknown; currency?: unknown }>;
      const failureRows = (Array.isArray(failures.data) ? failures.data : []) as Array<{ event_code?: unknown }>;
      const usdTotal = orderRows
        .filter((row) => row.currency === "USD")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const codeList: string[] = failureRows.map((row) => String(row.event_code || "")).filter((code) => code.length > 0);
      const codes: string[] = [...new Set(codeList)].slice(0, 3);
      return {
        articles: {
          ok: !articles.error,
          count: articles.count ?? 0,
          titles: titleRows.map((row) => String(row.title || "Untitled").slice(0, 120)),
        },
        orders: { ok: !orders.error, paidCount: orders.count ?? orderRows.length, usdTotal: Math.round(usdTotal * 100) / 100 },
        views: { ok: !views.error, count: views.count ?? 0 },
        weeks,
        failures: { ok: !failures.error, count: failures.count ?? 0, codes },
        minds: { ok: !mindRows.error && mindLogRows !== null, rows: (mindLogRows ?? []) as BriefingMindRow[] },
        waiting: { ok: !waitingOrders.error, count: waitingOrders.count ?? 0 },
        applied: { ok: appliedOk, rows: briefingApplied(editRows as Array<{ post_id: unknown; product_ids: unknown }>, postTitles, productNames) },
        gaps: { ok: !openGaps.error, rows: briefingGaps((Array.isArray(openGaps.data) ? openGaps.data : []) as Array<{ angle: unknown }>) },
        packs: { ok: !packRead.error, rows: briefingPacks(packRows, postTitles) },
        doors: { ok: !doorRead.error, rows: briefingDoors(doorRows, postTitles) },
        notables: { ok: !notableRead.error, rows: briefingNotables(Array.isArray(notableRead.data) ? notableRead.data : []) },
        messages: { ok: !messageRead.error, count: messageRead.count ?? 0 },
      };
    },
    // The "which mind?" order waiting on the last message of this chat. Owner session, so row-level security applies.
    loadPendingOrder: async (chatId: string) => {
      const { data, error } = await userClient
        .from("buddy_messages")
        .select("role,payload")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) return { ok: false as const };
      const last = Array.isArray(data) ? data[0] : null;
      if (!last || last.role !== "buddy" || !last.payload || typeof last.payload !== "object") {
        return { ok: true as const, instruction: null };
      }
      const pending = (last.payload as Record<string, unknown>).pending_order;
      return { ok: true as const, instruction: typeof pending === "string" && pending.trim() ? pending.slice(0, 1000) : null };
    },
    // Files one order as waiting. The database rule allows only status "waiting" from the owner's session.
    saveOrder: async (_chatId: string, instruction: string, mind: MindName | null) => {
      const { error } = await userClient.from("buddy_orders").insert({ instruction, mind, status: "waiting" });
      return !error;
    },
    // The owner's orders that are still waiting, oldest first. Null when the read fails. Read by buddyOrders.ts.
    readWaitingOrderRows: async (): Promise<unknown[] | null> => {
      const { data, error } = await userClient
        .from("buddy_orders")
        .select("id,instruction,mind,status,created_at")
        .eq("status", "waiting")
        .order("created_at", { ascending: true })
        .limit(50);
      if (error || !Array.isArray(data)) return null;
      return data;
    },
    // Read-only log rows, newest first. Owner-only rows (row-level security).
    // Read only. The run never turns Takeover on; only the owner does, in Admin.
    readTakeover: async (): Promise<boolean | null> => {
      const { data, error } = await userClient.from("minds_controls").select("takeover").eq("id", 1).maybeSingle();
      if (error) return null;
      return data?.takeover === true;
    },
    // Read only, owner session (row-level security). Each part reports its own failure; nothing is guessed.
    readStateFacts: async (): Promise<BuddyStateFacts> => {
      const [controls, waiting, log, notable, doors] = await Promise.all([
        userClient.from("minds_controls").select("takeover,kill_scope").eq("id", 1).maybeSingle(),
        userClient
          .from("buddy_orders")
          .select("instruction,mind", { count: "exact" })
          .eq("status", "waiting")
          .order("created_at", { ascending: true })
          .limit(STATE_ORDER_LIMIT),
        userClient
          .from("minds_daily_log")
          .select("happened_at,day,mind,action,outcome,detail")
          .order("happened_at", { ascending: false })
          .limit(STATE_LOG_LIMIT),
        userClient
          .from("minds_notable_events")
          .select("happened_at,title")
          .order("happened_at", { ascending: false })
          .limit(STATE_NOTABLE_LIMIT),
        // Door sends, newest first. Owner session, so row-level security applies.
        userClient
          .from("minds_door_posts")
          .select("created_at,door,status")
          .order("created_at", { ascending: false })
          .limit(STATE_DOOR_LIMIT),
      ]);
      const controlsOk = !controls.error;
      const orderRows = (Array.isArray(waiting.data) ? waiting.data : []) as Array<{ instruction?: unknown; mind?: unknown }>;
      const logRows = Array.isArray(log.data) ? (log.data as MindLogLine[]) : null;
      const notableRows = (Array.isArray(notable.data) ? notable.data : []) as Array<{ happened_at?: unknown; title?: unknown }>;
      const doorRows = (Array.isArray(doors.data) ? doors.data : []) as Array<{ created_at?: unknown; door?: unknown; status?: unknown }>;
      return {
        takeover: controlsOk ? (controls.data?.takeover === true) : null,
        killScope: controlsOk ? String(controls.data?.kill_scope ?? "none") : null,
        orders: {
          ok: !waiting.error,
          total: waiting.count ?? orderRows.length,
          items: orderRows.map((row) => ({
            instruction: typeof row.instruction === "string" ? row.instruction : "",
            mind: typeof row.mind === "string" ? row.mind : null,
          })),
        },
        log: { ok: !log.error && logRows !== null, rows: logRows ?? [] },
        doors: {
          ok: !doors.error,
          rows: doorRows.map((row) => ({
            happenedAt: typeof row.created_at === "string" ? row.created_at : "",
            door: typeof row.door === "string" ? row.door : "",
            status: typeof row.status === "string" ? row.status : "",
          })),
        },
        notable: {
          ok: !notable.error,
          rows: notableRows.map((row) => ({
            happenedAt: typeof row.happened_at === "string" ? row.happened_at : "",
            title: typeof row.title === "string" ? row.title : "",
          })),
        },
      };
    },
    readMindLog: async (mind: MindName | null): Promise<MindLogLine[] | null> => {
      let query = userClient
        .from("minds_daily_log")
        .select("happened_at,day,mind,action,outcome,detail")
        .order("happened_at", { ascending: false })
        .limit(50);
      if (mind) query = query.eq("mind", mind);
      const { data, error } = await query;
      if (error || !Array.isArray(data)) return null;
      return data as MindLogLine[];
    },
    // Read-only. Articles: titles and dates only, never the body. Products: names and USD prices only.
    readSiteFacts: async (nowIso: string): Promise<SiteFacts> => {
      try {
        const [articles, products] = await Promise.all([
          userClient
            .from("posts")
            .select("title,slug,published_at,excerpt", { count: "exact" })
            .eq("status", "published")
            .lte("published_at", nowIso)
            .order("published_at", { ascending: false })
            .limit(SITE_ARTICLE_LIMIT),
          userClient
            .from("products")
            .select("name,price_cents", { count: "exact" })
            .eq("is_active", true)
            .or("currency.eq.USD,currency.is.null")
            .order("name", { ascending: true })
            .limit(SITE_PRODUCT_LIMIT),
        ]);
        return siteFactsFromReads(
          { data: articles.data, error: articles.error, count: articles.count },
          { data: products.data, error: products.error, count: products.count },
        );
      } catch {
        return siteFactsFromReads({ data: null, error: true }, { data: null, error: true });
      }
    },
    findOrCreateBriefing: async (localDate: string) => {
      const existing = await userClient
        .from("buddy_chats")
        .select("id")
        .eq("kind", "briefing")
        .eq("briefing_date", localDate)
        .maybeSingle();
      if (existing.error) return null;
      if (existing.data) return { id: String(existing.data.id), created: false };
      const inserted = await userClient
        .from("buddy_chats")
        .insert({ kind: "briefing", briefing_date: localDate })
        .select("id")
        .single();
      if (!inserted.error && inserted.data) return { id: String(inserted.data.id), created: true };
      // Another open of the app may have made today's thread a moment earlier. The unique rule keeps it to one.
      const again = await userClient
        .from("buddy_chats")
        .select("id")
        .eq("kind", "briefing")
        .eq("briefing_date", localDate)
        .maybeSingle();
      return again.data ? { id: String(again.data.id), created: false } : null;
    },
  };
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (!cors) return new Response(null, { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed." }, 405);
  if (req.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reply(req, { error: "JSON request body required." }, 415);
  }
  if (Number(req.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) {
    return reply(req, { error: "Request body is too large." }, 413);
  }
  const rawBody = await readBoundedBody(req, MAX_BODY_BYTES);
  if (rawBody === null) return reply(req, { error: "Request body is too large or unreadable." }, 413);
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return reply(req, { error: "Invalid request body." }, 400);
  }

  const user = await callerUser(req);
  if (!user) return reply(req, { error: "Owner authentication required." }, 401);

  const supabaseUrl = env("SUPABASE_URL", "SUPABASE_PROJECT_URL");
  const anonKey = env("SUPABASE_ANON_KEY", "SUPABASE_KEY");
  if (!supabaseUrl || !anonKey) return reply(req, { error: "Buddy is not configured." }, 503);

  // Owner check: the same owner-only catalogue read the Automation keys page uses. Its
  // answer also tells us whether the Google key is saved, without reading the key itself.
  let keyConfigured = false;
  let userClient: SupabaseClient;
  try {
    userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.rpc("automation_list_secrets");
    if (error || !Array.isArray(data)) return reply(req, { error: "Owner-only access is required." }, 403);
    const row = (data as Array<{ name?: unknown; configured?: unknown }>).find((entry) => entry?.name === KEY_NAME);
    keyConfigured = row?.configured === true;
  } catch {
    return reply(req, { error: "Owner-only access is required." }, 403);
  }

  let sb: ReturnType<typeof serviceClient>;
  try {
    sb = serviceClient();
  } catch {
    return reply(req, { error: "Buddy is not configured." }, 503);
  }

  const store = chatStore(userClient);
  // One Vault read through the service role. Used for the Google key and every other brain key.
  const readSecret = async (secretName: string): Promise<string | null> => {
    try {
      const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: secretName });
      return !error && typeof data === "string" && data.length > 0 ? data : null;
    } catch {
      return null;
    }
  };
  const deps: BuddyThinkDeps = {
    keyConfigured: async () => keyConfigured,
    // One pause, stop or start change, made in the owner's session (row-level security), then one daily-log line.
    // Only called when Takeover is on. Returns false when the change or the log line could not be saved.
    applyControl: async (action: ControlAction) => {
      try {
        const isDoor = action.kind === "pause_door" || action.kind === "resume_door";
        const current = await userClient.from("minds_controls").select(isDoor ? "kill_scope,paused_doors" : "kill_scope").eq("id", 1).maybeSingle();
        if (current.error || !current.data) return false;
        const row = current.data as unknown as Record<string, unknown>;
        const pausedDoors = Array.isArray(row.paused_doors) ? row.paused_doors.filter((item): item is string => typeof item === "string") : [];
        const killScope = typeof row.kill_scope === "string" ? row.kill_scope : "none";
        const change = controlChange(action, { killScope, pausedDoors });
        const saved = await userClient
          .from("minds_controls")
          .update({ ...change, updated_by: user.id, updated_at: new Date().toISOString(), change_source: "chat" })
          .eq("id", 1)
          .select("id");
        if (saved.error || !Array.isArray(saved.data) || saved.data.length === 0) return false;
        const now = new Date().toISOString();
        const logged = await sb.from("minds_daily_log").insert({
          owner_id: user.id,
          day: ownerClock(now),
          happened_at: now,
          mind: "buddy",
          action: "Owner changed a switch from chat",
          outcome: "done",
          detail: controlDoneLine(action).slice(0, 500),
        });
        return !logged.error;
      } catch {
        return false;
      }
    },
    readKey: () => readSecret(KEY_NAME),
    readSecret,
    // One plain-words line per answered question: which brain answered. Never names a key.
    logBrain: async (line: string) => {
      const now = new Date().toISOString();
      const logged = await sb.from("minds_daily_log").insert({
        owner_id: user.id,
        day: ownerClock(now),
        happened_at: now,
        mind: "buddy",
        action: "Buddy answered a question",
        outcome: "done",
        detail: line.slice(0, 500),
      });
      if (logged.error) throw new Error("log not saved");
    },
    allowCall: async (action) => {
      try {
        const salt = env("RATE_LIMIT_SALT") || "lixxon";
        const keyHash = await sha256(`${salt}:buddy-think:${action}:${user.id}`);
        const { data, error } = await sb.rpc("check_rate_limit", {
          p_key_hash: keyHash,
          p_action: `buddy_think_${action}`,
          p_limit: LIMITS[action].limit,
          p_window_seconds: LIMITS[action].window,
        });
        if (error) return null;
        return data === true;
      } catch {
        return null;
      }
    },
    askGemini: (apiKey, input) => callGemini(apiKey, input),
    recordProbe: async (status) => {
      try {
        await sb.rpc("test_automation_secret", { p_secret_name: KEY_NAME, p_result: status });
      } catch {
        // The probe answer is still returned to the owner; only the stored status is lost.
      }
    },
    ...store,
  };

  const result = await handleBuddyThink(payload, deps);
  return reply(req, result.body, result.status);
});
