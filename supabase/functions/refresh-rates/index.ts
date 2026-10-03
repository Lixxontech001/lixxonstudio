/**
 * refresh-rates — pulls USD base rates from a free, key-less public API and caches them
 * in `currency_rates` (display only; Flutterwave charges in CHECKOUT_CURRENCY).
 * Call daily from the GitHub Actions cron with x-internal-secret.
 */
import { json, preflight, serviceClient } from "../_shared/http.ts";

const INTERNAL_SECRET = Deno.env.get("INTERNAL_FN_SECRET");
const WANT = ["NGN", "GBP", "EUR", "CAD", "GHS", "KES", "ZAR"];

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (!INTERNAL_SECRET || req.headers.get("x-internal-secret") !== INTERNAL_SECRET) return json({ error: "Forbidden" }, 403);
  // free & no key: https://github.com/fawazahmed0/exchange-api (CDN-hosted, daily)
  const sources = [
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
    "https://latest.currency-api.pages.dev/v1/currencies/usd.json",
    "https://open.er-api.com/v6/latest/USD",
  ];
  let rates: Record<string, number> | null = null;
  for (const src of sources) {
    try {
      const r = await fetch(src);
      if (!r.ok) continue;
      const d = await r.json();
      const map = d.usd ?? d.rates;
      if (map && typeof map === "object") {
        rates = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toUpperCase(), Number(v)]));
        break;
      }
    } catch { /* try next */ }
  }
  if (!rates) return json({ error: "No rate source reachable" }, 502);
  const sb = serviceClient();
  const rows = WANT.filter((c) => Number.isFinite(rates![c]) && rates![c] > 0).map((c) => ({ code: c, rate: rates![c], updated_at: new Date().toISOString() }));
  rows.push({ code: "USD", rate: 1, updated_at: new Date().toISOString() });
  const { error } = await sb.from("currency_rates").upsert(rows, { onConflict: "code" });
  return error ? json({ error: error.message }, 500) : json({ ok: true, updated: rows.length });
});
