// Buddy's night report clock. Called by pg_cron through pg_net with the internal function secret, never by a browser.
// It flushes owner pushes that are still waiting, then writes each owner's night report once, when the night is due. The rules and the tick are in _shared/nightReportClock.ts.
// It has no owner session, so it does not use the owner check. The internal secret is the only way in.

import { env, json, serviceClient } from "../_shared/http.ts";
import { runNightClock } from "../_shared/nightReportClock.ts";
import { flushUnpushedNotables, servicePushPorts } from "../_shared/notablePushServer.ts";

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const expected = env("INTERNAL_FN_SECRET");
  const supplied = req.headers.get("x-internal-secret") || "";
  if (!expected || !safeEqual(supplied, expected)) return json({ error: "Forbidden" }, 403);

  let sb;
  try {
    sb = serviceClient();
  } catch {
    return json({ error: "Buddy is not configured." }, 503);
  }

  // Owner pushes that were not sent when they were written (the browser closed, a key or device was missing) go out
  // here, on the server clock. Counts only: no titles, devices or keys are returned.
  const flush = await flushUnpushedNotables(servicePushPorts(sb));
  const result = await runNightClock(sb, new Date());
  return json({ ...result, push_flush: { ok: flush.ok, considered: flush.considered, attempted: flush.attempted, sent: flush.sent } }, result.status === "failed" ? 503 : 200);
});
