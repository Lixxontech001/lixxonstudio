// The door a server-side clock uses to call another function: the internal secret, timing safe, and nothing else.
// Used by the 08:00 morning clock to start the day's run, which is the same run the owner starts by hand.
// Pure logic: no Deno globals, so it can be tested under Vitest with a fake fetch.

/** Length-safe comparison, so a wrong secret cannot be found a character at a time. */
export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** True when the request carries the internal secret. An unset secret is never a match. */
export function isInternalCall(req: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const supplied = req.headers.get("x-internal-secret") || "";
  return supplied.length > 0 && safeEqual(supplied, expected);
}

export interface InternalCallResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
}

/**
 * One POST to another function with the internal secret. A refused or unreadable answer is reported as not ok, and
 * the caller decides what to tell the owner. The body is JSON and nothing else is sent: no key, no token, no user.
 */
export async function callInternal(
  url: string,
  secret: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<InternalCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // An answer that cannot be read as one JSON object is not a run answer: it counts as not ok, whatever its status.
    let parsed: Record<string, unknown> | null = null;
    let readable = false;
    try {
      const text = await response.text();
      const value: unknown = text ? JSON.parse(text) : null;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
        readable = true;
      }
    } catch {
      readable = false;
    }
    return { ok: response.ok && readable, status: response.status, body: parsed };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/** The plain words for a call that did not go through. Never a raw status code or a message from the other side. */
export function internalCallDetail(result: InternalCallResult): string {
  if (result.ok) return "The run answered.";
  if (result.status === 0) return "The run could not be reached. Nothing changed.";
  if (result.status === 401 || result.status === 403) return "The run refused the internal call. Nothing changed.";
  if (result.status === 503) return "The run is not configured. Nothing changed.";
  return "The run did not finish. Nothing changed.";
}
