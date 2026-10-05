import { parseAutomationHealthSnapshot } from '../../src/lib/automationHealth';

export const config = { runtime: 'edge' };

const MAX_RPC_BYTES = 48 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Vary': 'Authorization',
};

function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function isServiceKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true;
  const payload = value.split('.')[1];
  if (!payload) return false;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role === 'service_role';
  } catch {
    return false;
  }
}

function safeSupabaseUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    const local = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if ((!local && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* never inspect upstream error content */ }
}

async function readBounded(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > limit) {
    await discard(response);
    return null;
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
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
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Same-origin, read-only health proxy. All permission checks remain in the RPC. */
export async function handleAutomationHealth(
  req: Request,
  fetcher: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  const authorization = req.headers.get('authorization') || '';
  const match = /^Bearer ([^\s]{8,8192})$/.exec(authorization);
  if (!match) return json({ error: 'Sign in with an authorized admin account.' }, 401);

  const userToken = match[1];
  const supabaseUrl = safeSupabaseUrl(env('SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'VITE_SUPABASE_URL', 'VITE_PUBLIC_SUPABASE_URL') || '');
  const publicKey = env(
    'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY',
    'VITE_PUBLIC_SUPABASE_ANON_KEY', 'VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_KEY', 'VITE_SUPABASE_PUBLIC_KEY',
  );
  if (!supabaseUrl || !publicKey || isServiceKey(publicKey) || isServiceKey(userToken) || userToken === publicKey) {
    return json({ error: 'Automation health service is not configured safely.' }, 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${supabaseUrl}/rest/v1/rpc/automation_health_snapshot`, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: publicKey,
        Authorization: `Bearer ${userToken}`,
      },
      body: '{}',
    });

    if (!response.ok) {
      await discard(response);
      if (response.status === 401) return json({ error: 'Your sign-in is invalid or expired.' }, 401);
      if (response.status === 403) return json({ error: 'Automation health permission is required.' }, 403);
      if (response.status === 429) return json({ error: 'Health checks are temporarily rate-limited.' }, 429);
      return json({ error: 'The automation health database check is unavailable.' }, response.status >= 500 ? 503 : 502);
    }

    const raw = await readBounded(response, MAX_RPC_BYTES);
    if (raw === null) return json({ error: 'The health response exceeded its safe size limit.' }, 502);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({ error: 'The health response was invalid.' }, 502); }
    const safe = parseAutomationHealthSnapshot(payload);
    if (!safe) return json({ error: 'The health response did not match the safe diagnostic schema.' }, 502);
    return json(safe, 200);
  } catch {
    return json({ error: controller.signal.aborted ? 'The automation health check timed out.' : 'The automation health database check is unavailable.' }, controller.signal.aborted ? 504 : 503);
  } finally {
    clearTimeout(timeout);
  }
}

export default function handler(req: Request): Promise<Response> {
  return handleAutomationHealth(req);
}
