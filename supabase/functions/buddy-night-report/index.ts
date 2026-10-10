// Buddy's night report, owner only. The owner's browser sends the owner's local day, and this writes that day's report once.
// The night clock (buddy-night-clock) writes the same report on a schedule. That schedule is not applied yet.
// The work lives in _shared/nightReportRun.ts. This file only checks the owner and passes the day on.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { callerUser, env, json, preflight, serviceClient } from "../_shared/http.ts";
import { runNightReport } from "../_shared/nightReportRun.ts";

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "A JSON body is required." }, 400);
  }
  const day = (body as { local_day?: unknown } | null)?.local_day;

  const user = await callerUser(req);
  if (!user) return json({ error: "Owner authentication required." }, 401);

  const supabaseUrl = env("SUPABASE_URL", "SUPABASE_PROJECT_URL");
  const anonKey = env("SUPABASE_ANON_KEY", "SUPABASE_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "Buddy is not configured." }, 503);

  // Owner check: the same owner-only read Buddy uses. Only the owner gets a report.
  try {
    const userClient: SupabaseClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.rpc("automation_list_secrets");
    if (error || !Array.isArray(data)) return json({ error: "Owner-only access is required." }, 403);
  } catch {
    return json({ error: "Owner-only access is required." }, 403);
  }

  let sb: SupabaseClient;
  try {
    sb = serviceClient();
  } catch {
    return json({ error: "Buddy is not configured." }, 503);
  }

  const result = await runNightReport(sb, user.id, day);
  return json(result, result.status === "failed" ? 503 : 200);
});
