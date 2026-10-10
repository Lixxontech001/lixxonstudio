// The day run's door step: post the newest fresh article to each open free door that is fully connected.
// Order per door: check connected, check today's cap, pick the article, reserve the post (the database refuses when
// Takeover is off or Kill stops the minds), send, then record the result. Pure logic. Doors come in through `ports`.
// Secret values are read only to send. They are never put in a detail, a log line, or a reply.
//
// A failure while recording the result never stops the step. The save is retried, and if it still fails the door is
// logged as a failed record and the other doors still run. A door that posted is never sent again the same day,
// because some doors (Telegram, Discord, Bluesky, Tumblr, Blogger) cannot tell a repeat from a new post.

import { DOORS, doorStatus, type DoorId } from "./doorRegistry.ts";
import { DOOR_LABEL } from "./buddyControls.ts";
import { nothingNewNote, notSentNote, sentLead, sentVerb } from "./rssHub.ts";
import { DOOR_DAILY_LIMIT, DOOR_MEDIA, DOOR_TEXT_LIMIT, DOORS_NEED_PICTURE, OPEN_DOORS, pickDoorArticle, type DoorArticle } from "./doorPosts.ts";
import { isHonestSkip } from "./honestSkips.ts";
import type { DoorSendResult } from "./doorAdapters.ts";
import { imageProblemNote, type ArticleImageLoad } from "./articleImage.ts";
import { blockedDetail, KILL_BLOCK_DETAIL, TAKEOVER_OFF_DETAIL } from "./runDay.ts";
import type { KillScope } from "./placementRun.ts";

/** A file a door sends, already read and checked. */
export type DoorMedia =
  | { kind: "image"; data: ArrayBuffer; contentType: string }
  | { kind: "video"; data: ArrayBuffer; contentType: string; bytes: number }
  | { kind: "audio"; path: string; bytes: number; contentType: string };

/** What a door gets besides its text: the file (if it needs one) and the article it is about. */
export interface DoorSendExtra {
  media: DoorMedia | null;
  articleId: string;
  title: string;
  articleUrl: string;
  localDay: string;
}

export type VideoLoad = { ok: true; data: ArrayBuffer; contentType: string; bytes: number } | { ok: false; reason: "no_video" | "not_readable" };
export type AudioLoad = { ok: true; path: string; bytes: number; contentType: string } | { ok: false; reason: "no_audio" | "not_readable" };

export const DOORS_NOTHING_CONNECTED_DETAIL = "No free door is connected yet. Connect one on Connections.";
export const FINISH_ATTEMPTS = 3;
const FINISH_PAUSE_MS = [1000, 3000];

export const ALL_DOORS_PAUSED_DETAIL = "Every free door is paused by you. Nothing was sent.";

export interface DoorRunInput {
  localDay: string;
  takeover: boolean;
  killScope: KillScope;
  nowMs: number;
  siteOrigin: string | null;
  /** Doors the owner paused in chat. A paused door is skipped and nothing is sent there. */
  pausedDoors?: readonly string[];
}

export type ReserveResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * A row from earlier today that is still queued: its send is done, or its failure is known, but its record was not saved.
 * `pendingStatus` says which: "posted" (the post went out) or "failed" (it did not). null means the send state is unknown.
 */
export interface PendingPost {
  id: string;
  pendingStatus: "posted" | "failed" | null;
  externalRef: string | null;
  errorNote: string | null;
}

export interface DoorRunPorts {
  readArticles: () => Promise<DoorArticle[]>;
  readPostedIds: (door: DoorId) => Promise<Set<string>>;
  countToday: (door: DoorId, localDay: string) => Promise<number>;
  readSecret: (name: string) => Promise<string | null>;
  reserve: (door: DoorId, articleId: string, localDay: string, articleUrl: string) => Promise<ReserveResult>;
  /** `key` is the reserved row's id. It is sent as the door's idempotency key where the door supports one. */
  send: (door: DoorId, values: Record<string, string>, text: string, key: string, extra: DoorSendExtra) => Promise<DoorSendResult>;
  /** Fetches and checks the article's own cover picture. Used only by doors that need a picture, before anything is reserved. */
  loadImage?: (cover: string, siteOrigin: string | null) => Promise<ArticleImageLoad>;
  /** The pack's real MP4 for this article and day. Before anything is reserved. */
  loadVideo?: (articleId: string, localDay: string) => Promise<VideoLoad>;
  /** The episode's audio file for this article. Before anything is reserved. */
  loadAudio?: (articleId: string) => Promise<AudioLoad>;
  finish: (id: string, status: "posted" | "failed", externalRef: string | null, errorNote: string | null) => Promise<void>;
  /** Queued rows for this door and day whose record was not saved yet. Read before any new send. */
  readPendingPosts: (door: DoorId, localDay: string) => Promise<PendingPost[]>;
  /** Keeps what a queued row needs to be saved later: whether it posted (or failed), its reference and its note. Never sends. */
  markPending: (id: string, status: "posted" | "failed", externalRef: string | null, errorNote: string | null) => Promise<void>;
  log: (entry: { door: DoorId; outcome: "done" | "failed" | "skipped"; detail: string }) => Promise<void>;
  /** Waits between save retries. Tests pass a no-op. */
  pause?: (ms: number) => Promise<void>;
}

export type DoorOutcomeKind = "posted" | "failed" | "skipped" | "not_connected";

export interface DoorOutcome {
  door: DoorId;
  outcome: DoorOutcomeKind;
  detail: string;
}

export interface DoorRunResult {
  status: "done" | "held" | "nothing_to_do";
  detail: string;
  posted: number;
  outcomes: DoorOutcome[];
}

const HELD_REASONS: Record<string, string> = {
  takeover_off: TAKEOVER_OFF_DETAIL,
  killed: KILL_BLOCK_DETAIL,
};

const CLIP = 600;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > CLIP ? `${flat.slice(0, CLIP - 1)}…` : flat;
}

/** Tries to record a result again, a few times. Returns false when every try failed. Never throws. */
async function finishWithRetry(
  ports: DoorRunPorts,
  id: string,
  status: "posted" | "failed",
  externalRef: string | null,
  errorNote: string | null,
): Promise<boolean> {
  for (let attempt = 1; attempt <= FINISH_ATTEMPTS; attempt++) {
    try {
      await ports.finish(id, status, externalRef, errorNote);
      return true;
    } catch {
      if (attempt < FINISH_ATTEMPTS) {
        const wait = FINISH_PAUSE_MS[attempt - 1] ?? 0;
        if (ports.pause) await ports.pause(wait);
        else await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  return false;
}

/** Keeps the state of a queued row for a later save. A failed keep is ignored: the row then stays queued with an unknown state. */
async function keepPendingSafely(ports: DoorRunPorts, id: string, status: "posted" | "failed", externalRef: string | null, errorNote: string | null): Promise<void> {
  try {
    await ports.markPending(id, status, externalRef, errorNote);
  } catch {
    // Nothing more can be done here. The next run will see a queued row with an unknown state, and will not send it again.
  }
}

/** Writes a log line. A failed log write is ignored, so it can never stop the step. */
async function logSafely(ports: DoorRunPorts, entry: { door: DoorId; outcome: "done" | "failed" | "skipped"; detail: string }): Promise<void> {
  try {
    await ports.log(entry);
  } catch {
    // The log is a record for the owner. A failed write must not undo or hide the post that already happened.
  }
}

type DoorStep = { held: string; posted: number } | DoorOutcome;

/**
 * Earlier today's queued rows for this door. Their record is saved again (a fourth try, and more on later runs the same day).
 * Nothing is sent again: a post that went out is only recorded. Returns null when there is nothing to save.
 */
async function savePendingPosts(input: DoorRunInput, ports: DoorRunPorts, door: DoorId): Promise<DoorOutcome | null> {
  const label = DOORS[door].label;
  let rows: PendingPost[];
  try {
    rows = await ports.readPendingPosts(door, input.localDay);
  } catch {
    return { door, outcome: "skipped", detail: `${label}: could not be checked today. ${notSentNote(door)}` };
  }
  const row = rows[0];
  if (!row) return null;

  if (row.pendingStatus === null) {
    // We cannot tell whether the earlier send went out, so nothing is sent again today.
    const detail = `${label}: an earlier post today needs a look. ${nothingNewNote(door)}`;
    await logSafely(ports, { door, outcome: "failed", detail: `${label}: an earlier post today has no saved state. It was not sent again. Check the log.` });
    return { door, outcome: "skipped", detail };
  }

  if (row.pendingStatus === "posted") {
    const saved = await finishWithRetry(ports, row.id, "posted", row.externalRef, null);
    if (saved) {
      const detail = `${sentLead(door, label)}: the record was saved on a later try today.`;
      await logSafely(ports, { door, outcome: "done", detail });
      return { door, outcome: "posted", detail };
    }
    const detail = `${label}: ${sentVerb(door)}, but the record could not be saved. Check the log.`;
    await logSafely(ports, { door, outcome: "failed", detail });
    return { door, outcome: "posted", detail };
  }

  // The earlier send did not go out. Its failure is recorded now. Nothing is sent again.
  const note = row.errorNote ?? notSentNote(door);
  const saved = await finishWithRetry(ports, row.id, "failed", null, note);
  if (saved) return { door, outcome: "failed", detail: `${label} did not take it: ${note}` };
  return { door, outcome: "skipped", detail: `${label}: an earlier try could not be saved yet. ${nothingNewNote(door)}` };
}

/** One door, start to finish. Only a held gate (Takeover off, Kill) stops the whole step. */
async function postToDoor(input: DoorRunInput, ports: DoorRunPorts, door: DoorId, readArticles: () => Promise<DoorArticle[]>, postedSoFar: number): Promise<DoorStep> {
  const label = DOORS[door].label;

  // Reading the saved values is the first step. A failure here means nothing was sent.
  const values: Record<string, string> = {};
  try {
    for (const field of DOORS[door].fields) {
      const value = await ports.readSecret(field.secretName);
      if (value) values[field.secretName] = value;
    }
  } catch {
    return { door, outcome: "skipped", detail: `${label}: could not be checked today. ${notSentNote(door)}` };
  }
  const status = doorStatus(door, new Set(Object.keys(values)));
  if (status.state !== "connected") return { door, outcome: "not_connected", detail: label };

  // An earlier try today that did not save its record is saved first. If that step has a result, the door's day is used.
  const pending = await savePendingPosts(input, ports, door);
  if (pending) return pending;

  try {
    if ((await ports.countToday(door, input.localDay)) >= DOOR_DAILY_LIMIT) {
      return { door, outcome: "skipped", detail: `${label}: already ${sentVerb(door)} today.` };
    }
  } catch {
    return { door, outcome: "skipped", detail: `${label}: could not be checked today. ${notSentNote(door)}` };
  }

  // A read of the articles that fails propagates. It happens before any door has sent, so nothing was posted.
  const articles = await readArticles();

  let pick: ReturnType<typeof pickDoorArticle>;
  try {
    pick = pickDoorArticle({
      articles,
      postedIds: await ports.readPostedIds(door),
      nowMs: input.nowMs,
      siteOrigin: input.siteOrigin,
      limit: DOOR_TEXT_LIMIT[door],
      needPicture: DOORS_NEED_PICTURE.includes(door),
    });
  } catch {
    return { door, outcome: "skipped", detail: `${label}: could not be checked today. ${notSentNote(door)}` };
  }
  if (!pick.ok) {
    const detail = pick.reason === "copy_not_clean"
      ? `${label}: the newest article title has text that cannot be ${sentVerb(door)}.`
      : pick.reason === "too_long"
        ? `${label}: the article link is too long for this door.`
        : DOORS_NEED_PICTURE.includes(door)
          ? `${label}: no picture yet. ${notSentNote(door)}`
          : `${label}: no new article to post yet.`;
    if (isHonestSkip(detail)) await logSafely(ports, { door, outcome: "skipped", detail });
    return { door, outcome: "skipped", detail };
  }

  // A door that needs a file checks it first. A missing or bad file skips the door before any post is reserved.
  let media: DoorMedia | null = null;
  const need = DOOR_MEDIA[door];
  if (need === "image") {
    let loaded: ArticleImageLoad;
    try {
      loaded = ports.loadImage
        ? await ports.loadImage(pick.article.coverImage ?? "", input.siteOrigin)
        : { ok: false, reason: "not_fetchable" };
    } catch {
      loaded = { ok: false, reason: "not_fetchable" };
    }
    if (!loaded.ok) {
      const detail = `${label}: ${imageProblemNote(loaded.reason)} ${notSentNote(door)}`;
      await logSafely(ports, { door, outcome: "skipped", detail });
      return { door, outcome: "skipped", detail };
    }
    media = { kind: "image", data: loaded.data, contentType: loaded.contentType };
  } else if (need === "video") {
    let loaded: VideoLoad;
    try {
      loaded = ports.loadVideo ? await ports.loadVideo(pick.article.id, input.localDay) : { ok: false, reason: "no_video" };
    } catch {
      loaded = { ok: false, reason: "not_readable" };
    }
    if (!loaded.ok) {
      const detail = loaded.reason === "no_video" ? `${label}: no video yet. ${notSentNote(door)}` : `${label}: the video could not be read. ${notSentNote(door)}`;
      if (loaded.reason === "no_video") await logSafely(ports, { door, outcome: "skipped", detail });
      return { door, outcome: "skipped", detail };
    }
    media = { kind: "video", data: loaded.data, contentType: loaded.contentType, bytes: loaded.bytes };
  } else if (need === "audio") {
    let loaded: AudioLoad;
    try {
      loaded = ports.loadAudio ? await ports.loadAudio(pick.article.id) : { ok: false, reason: "no_audio" };
    } catch {
      loaded = { ok: false, reason: "not_readable" };
    }
    if (!loaded.ok) {
      const detail = loaded.reason === "no_audio" ? `${label}: audio not made yet. ${notSentNote(door)}` : `${label}: the audio could not be read. ${notSentNote(door)}`;
      if (loaded.reason === "no_audio") await logSafely(ports, { door, outcome: "skipped", detail });
      return { door, outcome: "skipped", detail };
    }
    media = { kind: "audio", path: loaded.path, bytes: loaded.bytes, contentType: loaded.contentType };
  }

  let reserved: ReserveResult;
  try {
    reserved = await ports.reserve(door, pick.article.id, input.localDay, pick.articleUrl);
  } catch {
    return { door, outcome: "skipped", detail: `${label}: could not start the post. ${notSentNote(door)}` };
  }
  if (!reserved.ok) {
    if (HELD_REASONS[reserved.reason]) return { held: HELD_REASONS[reserved.reason], posted: postedSoFar };
    const detail = reserved.reason === "already_posted" || reserved.reason === "door_day_cap"
      ? `${label}: ${nothingNewNote(door)}`
      : `${label}: could not start the post. ${notSentNote(door)}`;
    return { door, outcome: "skipped", detail };
  }

  // From here on the door may have posted. Nothing below may report "nothing was posted" unless it is sure.
  let sent: DoorSendResult;
  try {
    sent = await ports.send(door, values, pick.text, reserved.id, {
      media,
      articleId: pick.article.id,
      title: pick.article.title,
      articleUrl: pick.articleUrl,
      localDay: input.localDay,
    });
  } catch {
    sent = { ok: false, reason: "Could not reach the door." };
  }

  if (sent.ok) {
    const saved = await finishWithRetry(ports, reserved.id, "posted", sent.externalRef, null);
    if (saved) {
      const detail = `${sentLead(door, label)}: "${pick.article.title}".${sent.note ? ` ${sent.note}` : ""}`;
      await logSafely(ports, { door, outcome: "done", detail });
      return { door, outcome: "posted", detail };
    }
    // The post went out, but its record could not be saved. The row stays queued, marked as posted, and a later run today saves it again. Nothing is sent again.
    await keepPendingSafely(ports, reserved.id, "posted", sent.externalRef, null);
    const detail = `${label}: ${sentVerb(door)}, but the record could not be saved. Check the log.`;
    await logSafely(ports, { door, outcome: "failed", detail });
    return { door, outcome: "posted", detail };
  }

  const recorded = await finishWithRetry(ports, reserved.id, "failed", null, sent.reason);
  if (!recorded) await keepPendingSafely(ports, reserved.id, "failed", null, sent.reason);
  // A door the service has closed is said in plain words, once a day. Nothing is posted, and nothing is scraped.
  const detail = sent.closed ? `${label}: this door is closed. ${notSentNote(door)}` : `${label} did not take it: ${sent.reason}`;
  await logSafely(ports, { door, outcome: "failed", detail });
  return { door, outcome: "failed", detail };
}

export async function runDoors(input: DoorRunInput, ports: DoorRunPorts): Promise<DoorRunResult> {
  const gate = blockedDetail(input.takeover, input.killScope);
  if (gate) return { status: "held", detail: gate, posted: 0, outcomes: [] };

  const paused = new Set<string>(input.pausedDoors ?? []);
  const doors = OPEN_DOORS.filter((door) => !paused.has(door));
  const pausedNames = OPEN_DOORS.filter((door) => paused.has(door)).map((door) => DOOR_LABEL[door]);
  if (doors.length === 0) return { status: "nothing_to_do", detail: ALL_DOORS_PAUSED_DETAIL, posted: 0, outcomes: [] };

  const outcomes: DoorOutcome[] = [];
  let articles: DoorArticle[] | null = null;
  const readArticles = async (): Promise<DoorArticle[]> => {
    articles ??= await ports.readArticles();
    return articles;
  };

  for (const door of doors) {
    const posted = outcomes.filter((item) => item.outcome === "posted").length;
    const step = await postToDoor(input, ports, door, readArticles, posted);
    if ("held" in step) {
      return { status: "held", detail: step.held, posted, outcomes };
    }
    outcomes.push(step);
  }

  const posted = outcomes.filter((item) => item.outcome === "posted").length;
  const notConnected = outcomes.filter((item) => item.outcome === "not_connected").map((item) => item.detail);
  if (notConnected.length === doors.length) {
    return { status: "nothing_to_do", detail: DOORS_NOTHING_CONNECTED_DETAIL, posted, outcomes };
  }
  const lines = outcomes.filter((item) => item.outcome !== "not_connected").map((item) => item.detail);
  if (notConnected.length > 0) lines.push(`Not connected yet: ${notConnected.join(", ")}.`);
  if (pausedNames.length > 0) lines.push(`Paused by you: ${pausedNames.join(", ")}.`);
  return { status: "done", detail: clip(lines.join(" ")), posted, outcomes };
}
