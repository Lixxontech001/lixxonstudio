// The minds' one door to the brains. It walks the same brain chain as Buddy's chat (brainChain.ts): the first saved
// brain that answers wins, and a brain with no saved key is skipped. The keys are read by the caller through its
// existing Vault path; a mind never sees a key.
// Pure logic: no Deno globals, so it can be tested under Vitest.

import { askBrains, type BrainFailure, type BrainPorts } from "./brainChain.ts";
import { callGemini } from "./buddyThink.ts";

export type MindThinkFailure = "no_key" | "rejected" | "rate_limited" | "unavailable" | "empty";
export type MindThinkResult = { ok: true; text: string } | { ok: false; reason: MindThinkFailure };

/** The minds name only these failures. A reply that cannot be read counts as unavailable to them. */
function failureFor(outcome: BrainFailure | "none_saved"): MindThinkFailure {
  if (outcome === "none_saved") return "no_key";
  if (outcome === "unreadable") return "unavailable";
  return outcome;
}

/**
 * Returns a think function for the minds. One request walks the saved brains in order, and each brain is tried once.
 * `readSecret` reads one Vault entry on the server (null when not saved). `fetchImpl` is the fetch for the brains.
 */
export function makeMindThink(
  readSecret: (secretName: string) => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
): (request: { mind: string; system: string; prompt: string }) => Promise<MindThinkResult> {
  const ports: BrainPorts = {
    readSecret,
    fetchImpl,
    askGemini: (apiKey, input) => callGemini(apiKey, input, fetchImpl),
  };
  return async (request) => {
    const answer = await askBrains({ system: request.system, turns: [{ role: "user", text: request.prompt }] }, ports);
    if (answer.ok) return { ok: true, text: answer.text };
    return { ok: false, reason: failureFor(answer.lastOutcome) };
  };
}
