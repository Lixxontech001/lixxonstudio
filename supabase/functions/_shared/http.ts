// Shared helpers for all edge functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

// C0 control characters (except \t \n \r) plus DEL — stripped from all free-text input.
const CONTROL_CHARS = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(8) + String.fromCharCode(11) + String.fromCharCode(12) + String.fromCharCode(14) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]", "g");

/**
 * Read an env var, trying each name in order and returning the first truthy value.
 * Lets the same code work across Supabase CLI, Vercel integration, Railway, etc.
 */
export function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v) return v;
  }
  return undefined;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  return null;
}

export function serviceClient(): SupabaseClient {
  const url = env("SUPABASE_URL", "SUPABASE_PROJECT_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");
  if (!url || !key) throw new Error("Supabase service credentials not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Returns the caller's verified user (if an Authorization: Bearer <user jwt> header is present). */
export async function callerUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const anonKey = env("SUPABASE_ANON_KEY", "SUPABASE_KEY") || "";
  if (!token || token === anonKey) return null;
  try {
    const client = createClient(env("SUPABASE_URL", "SUPABASE_PROJECT_URL")!, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    // Pass the bearer explicitly: Edge Functions have no browser session storage,
    // so getUser() without a JWT would always report a missing session.
    const { data } = await client.auth.getUser(token);
    return data.user ?? null;
  } catch {
    return null;
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "0.0.0.0"
  );
}

export async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** DB-backed sliding-window rate limit. Returns true when the request is allowed. */
export async function rateLimit(
  sb: SupabaseClient,
  key: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const salt = Deno.env.get("RATE_LIMIT_SALT") || "lixxon";
  const keyHash = await sha256(`${salt}:${key}`);
  const { data, error } = await sb.rpc("check_rate_limit", {
    p_key_hash: keyHash,
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("rate limit rpc failed", error.message);
    return true; // fail open on infra error, but log it
  }
  return data === true;
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // strip control chars, collapse whitespace runs, trim, cap length
  return v.replace(CONTROL_CHARS, "").replace(/\s{3,}/g, "\n\n").trim().slice(0, max);
}

export function normEmail(v: unknown): string {
  const e = cleanText(v, 320).toLowerCase();
  return EMAIL_RE.test(e) ? e : "";
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Send an email through Resend (free tier). No-op when RESEND_API_KEY is absent. */
export async function sendEmail(opts: { to: string; subject: string; html: string; replyTo?: string; idempotencyKey?: string }): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  const from = Deno.env.get("EMAIL_FROM") || "Lixxon Studio <onboarding@resend.dev>";
  const idempotencyKey = opts.idempotencyKey && /^[A-Za-z0-9:_-]{1,128}$/.test(opts.idempotencyKey)
    ? opts.idempotencyKey
    : undefined;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, reply_to: opts.replyTo }),
    });
    return r.ok;
  } catch {
    // Never include transport errors, headers or recipient data in function logs.
    console.error("email send failed");
    return false;
  }
}

export function emailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#FDFBF7;font-family:Georgia,'Times New Roman',serif;color:#1A1A1A;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <p style="letter-spacing:.3em;text-transform:uppercase;font-size:11px;color:#A87056;margin:0 0 24px;font-family:Inter,Arial,sans-serif;">Lixxon Studio</p>
  <h1 style="font-weight:400;font-size:26px;line-height:1.25;margin:0 0 16px;">${escapeHtml(title)}</h1>
  <div style="font-size:15px;line-height:1.65;color:#2D2D2D;font-family:Inter,Arial,sans-serif;">${bodyHtml}</div>
  <p style="margin-top:40px;font-size:12px;color:#5A5A5A;font-family:Inter,Arial,sans-serif;">Skincare, style &amp; minimalist wellness · <a href="${Deno.env.get("SITE_URL") || "https://lixxonstudio.com"}" style="color:#A87056;">lixxonstudio.com</a></p>
</div></body></html>`;
}

export function siteUrl(): string {
  return (Deno.env.get("SITE_URL") || "https://lixxonstudio.com").replace(/\/$/, "");
}
