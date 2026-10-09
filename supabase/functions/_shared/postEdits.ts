// Rules for placing shop products on existing articles. Pure logic, no database and no Deno globals,
// so it runs under Vitest. The same numbers are enforced by the database triggers in the migrations.

/** At most this many live products on one article, all types together. */
export const PRODUCT_CAP = 3;
/** At most this many different articles touched by minds in one owner day. */
export const DRIP_DAILY_LIMIT = 3;
/** One apply adds at most this many sentences to a paragraph. */
export const MAX_ADDED_SENTENCES = 2;

/** SHA-256 of the exact paragraph text, as lowercase hex. Used to check the paragraph has not changed. */
export async function paragraphChecksum(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type ParagraphGuard = { ok: true } | { ok: false; reason: "paragraph_changed" };

/** Refuses when the paragraph is no longer the one the plan was made for, for example because the owner edited it. */
export async function paragraphUnchanged(current: string, expectedChecksum: string): Promise<ParagraphGuard> {
  return (await paragraphChecksum(current)) === expectedChecksum ? { ok: true } : { ok: false, reason: "paragraph_changed" };
}

/** True when adding `adding` live products keeps the article within the cap. */
export function capAllows(liveCount: number, adding: number): boolean {
  return liveCount + adding <= PRODUCT_CAP;
}

/** True when the article may be touched today: it already counts today, or fewer than the daily limit are counted. */
export function dripAllows(touchedToday: number, alreadyTouchedToday: boolean): boolean {
  return alreadyTouchedToday || touchedToday < DRIP_DAILY_LIMIT;
}
