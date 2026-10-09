// The plain words for an honest skip or a closed door. A step that did not run is written to the daily log with these words,
// and the morning briefing's Problems section lists them. One list, used by both, so the two cannot drift apart.
// Reader copy is not in this file. These are owner-facing words only.

export const HONEST_SKIP_PHRASES: readonly string[] = Object.freeze([
  "no video yet",
  "no picture yet",
  "audio not made yet",
  "video not made yet",
  "this door is closed",
]);

/** True when a log line says a step did not run for a plain, honest reason. */
export function isHonestSkip(text: string): boolean {
  const lower = text.toLowerCase();
  return HONEST_SKIP_PHRASES.some((phrase) => lower.includes(phrase));
}

/** The most honest-skip lines the briefing shows at once. The rest are still in the log. */
export const HONEST_SKIP_LINE_LIMIT = 6;
