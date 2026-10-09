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
import type { BriefingFacts } from "../_shared/buddyBriefing.ts";
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
      const [articles, orders, views, failures] = await Promise.all([
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
      ]);
      const titleRows = (Array.isArray(articles.data) ? articles.data : []) as Array<{ title?: unknown }>;
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
        failures: { ok: !failures.error, count: failures.count ?? 0, codes },
      };
    },
    // Read-only. Articles: titles and dates only, never the body. Products: names and USD prices only.
    readSiteFacts: async (nowIso: string): Promise<SiteFacts> => {
      try {
        const [articles, products] = await Promise.all([
          userClient
            .from("posts")
            .select("title,slug,published_at", { count: "exact" })
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
  const deps: BuddyThinkDeps = {
    keyConfigured: async () => keyConfigured,
    readKey: async () => {
      try {
        const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: KEY_NAME });
        return !error && typeof data === "string" && data.length > 0 ? data : null;
      } catch {
        return null;
      }
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
