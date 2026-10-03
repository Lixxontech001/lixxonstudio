/**
 * download-file — the only path to a digital-products signed URL.
 *
 * POST { token }            → atomically consumes one download (DB function enforces cap + expiry)
 *                             and returns a 60-second signed URL.
 * Also accepts a signed-in customer JWT: if the token belongs to their email the count is
 * still consumed, but we also reveal remaining downloads.
 *
 * The `digital-products` bucket has no client-side policies at all, so the service role
 * inside this function is the only thing that can mint URLs.
 */
import { json, preflight, serviceClient, clientIp, rateLimit } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sb = serviceClient();
  if (!(await rateLimit(sb, clientIp(req), "download", 30, 600))) return json({ error: "Too many downloads. Try again shortly." }, 429);

  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "Invalid download link." }, 400);

  // peek first so we can give a precise error
  const { data: ent } = await sb
    .from("download_entitlements")
    .select("id, download_count, max_downloads, expires_at, file_path, product:products(name)")
    .eq("download_token", token)
    .maybeSingle();
  if (!ent) return json({ error: "This download link is invalid." }, 404);
  if (ent.expires_at && new Date(ent.expires_at) < new Date()) return json({ error: "This download link has expired. Sign in to your account to request a new one." }, 410);
  if (ent.download_count >= ent.max_downloads) return json({ error: "You have reached the download limit for this product." }, 429);

  const { data: filePath, error } = await sb.rpc("consume_download", { p_token: token });
  if (error || !filePath) return json({ error: "Download not permitted." }, 403);

  const { data: signed, error: sErr } = await sb.storage.from("digital-products").createSignedUrl(filePath, 60, {
    download: true,
  });
  if (sErr || !signed?.signedUrl) {
    console.error("sign failed", sErr?.message);
    return json({ error: "File is temporarily unavailable. Please contact support." }, 500);
  }

  return json({
    ok: true,
    url: signed.signedUrl,
    // deno-lint-ignore no-explicit-any
    product_name: (ent as { product?: { name?: string } | null }).product?.name ?? null,
    remaining: Math.max(0, ent.max_downloads - ent.download_count - 1),
  });
});
