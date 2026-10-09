// The minds' one door to Gemini. Same key path and same single call as Buddy's chat (callGemini).
// The key is read by the caller through its existing Vault path; a mind never sees it.
// Pure logic: no Deno globals, so it can be tested under Vitest.

import { callGemini } from "./buddyThink.ts";

export type MindThinkFailure = "no_key" | "rejected" | "rate_limited" | "unavailable" | "empty";
export type MindThinkResult = { ok: true; text: string } | { ok: false; reason: MindThinkFailure };

/** Returns a think function for the minds. One request, one Gemini call, or none when there is no key. */
export function makeMindThink(
  getKey: () => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
): (request: { mind: string; system: string; prompt: string }) => Promise<MindThinkResult> {
  return async (request) => {
    const key = await getKey();
    if (!key) return { ok: false, reason: "no_key" };
    const result = await callGemini(
      key,
      { system: request.system, turns: [{ role: "user", text: request.prompt }] },
      fetchImpl,
    );
    return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.outcome };
  };
}
