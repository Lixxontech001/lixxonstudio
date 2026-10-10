// The one server path that sends an owner push for a notable. Used by the browser's Takeover/Kill call, the chat Kill,
// the blocked-order write, the day run, and the server flush (buddy-night-clock). Every caller goes through attemptRow,
// so every caller obeys the same rules: a notable with push_note 'sent' is never sent again, a notable is claimed
// ('pending') before the send, and a missing key or device writes one daily-log line the first time only.
// Sends only to the owner's own confirmed devices, through notifyOwnerDevices (the same VAPID keys). Never throws.
// Never logs or returns a key, an endpoint or a device detail.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { BUZZ_KINDS, NO_DEVICE_COPY, PUSH_HELP_COPY, notifyOwnerDevices, shouldBuzz, type PushNotifyDeps, type PushStatus } from "./notablePush.ts";
import { OWNER_UTC_OFFSET_HOURS } from "./mindsNightReport.ts";
import type { PushTarget, VapidCredentials } from "./webPush.ts";

/** The browser and chat paths only push a row this fresh. */
export const NOTICE_WINDOW_MS = 120_000;
/** The flush retries rows written within this window (no older). */
export const RETRY_WINDOW_MS = 3 * 24 * 3_600_000;
/** A pending claim older than this is a crashed attempt, and may be retried. */
export const PENDING_STALE_MS = 10 * 60_000;
/** Notes the flush may retry. 'sent' is never in this list. */
export const RETRYABLE_NOTES: readonly string[] = ["pending", "failed", "no_device", "not_configured"];

/** The daily log accepts these minds only. A notable's own mind (for example "owner") is shown as "buddy" there. */
const DAILY_LOG_MINDS = ["buddy", "analyst", "strategist", "ceo", "executioner", "auditor"];

export interface NotableRow {
  id: string;
  owner: string;
  mind: string;
  kind: string;
  title: string;
  happenedAt: string;
  pushNote: string | null;
  claimedAt: string | null;
}

/** 'claimed': this attempt may send. 'lost': another attempt holds it. 'error': the claim could not be written. */
export type ClaimResult = "claimed" | "lost" | "error";

export interface NotablePushPorts {
  /** The newest unpushed notable of this kind for one owner, written since the given time. Null when none. */
  findNewestUnpushed(owner: string, kind: string, sinceIso: string): Promise<NotableRow | null>;
  /** Every notable of a buzz kind written since the given time, for any owner, that may still need a push. */
  listRetryable(sinceIso: string, owner?: string): Promise<NotableRow[]>;
  /** Moves the row from one of the given notes to 'pending', only if it is still in one of them. */
  claim(row: NotableRow, from: Array<string | null>, nowIso: string): Promise<ClaimResult>;
  setPushNote(row: NotableRow, status: PushStatus): Promise<void>;
  logSkip(row: NotableRow, detail: string): Promise<void>;
  deps(owner: string): PushNotifyDeps;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** The owner's calendar day for a timestamp, on the same clock the daily log uses. */
export function ownerDayOf(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return new Date().toISOString().slice(0, 10);
  return new Date(time + OWNER_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/**
 * One attempt for one notable. `from` is the note the row must still have to be claimed: null for a new row, or the
 * retryable note it has now. If another attempt already holds the row, nothing is sent and nothing is written.
 * A claim that cannot be written (for example, the migration is not applied yet) still sends, as before Phase E.
 */
export async function attemptRow(row: NotableRow, ports: NotablePushPorts, nowMs: number = Date.now()): Promise<PushStatus | null> {
  const prev = row.pushNote;
  const from: Array<string | null> = prev === null ? [null] : [prev];
  const nowIso = new Date(nowMs).toISOString();
  let reached = false;
  let lost = false;
  const deps: PushNotifyDeps = {
    ...ports.deps(row.owner),
    beforeSend: async () => {
      reached = true;
      let result: ClaimResult;
      try {
        result = await ports.claim(row, from, nowIso);
      } catch {
        result = "error";
      }
      if (result === "lost") lost = true;
      return result !== "lost";
    },
  };
  const outcome = await notifyOwnerDevices(row.kind, row.title, deps);
  if (reached && lost) return null;
  try {
    await ports.setPushNote(row, outcome.status);
  } catch {
    // The push itself already happened or was skipped. Only the note is lost (see the report for the one risk).
  }
  if ((outcome.status === "no_device" || outcome.status === "not_configured") && prev === null) {
    try {
      await ports.logSkip(row, outcome.status === "no_device" ? NO_DEVICE_COPY : PUSH_HELP_COPY);
    } catch {
      // The skip line is extra. Nothing else depends on it.
    }
  }
  return outcome.status;
}

/**
 * Attempts one owner push for the newest unpushed notable of this kind, written since the browser window. Used right
 * after a switch is saved (browser) or a Kill is made (chat). Returns the status, or null when nothing was attempted.
 */
export async function pushNewestNotable(kind: string, ports: NotablePushPorts & { owner?: string }, nowMs: number = Date.now()): Promise<PushStatus | null> {
  try {
    if (!shouldBuzz(kind) || !ports.owner) return null;
    const row = await ports.findNewestUnpushed(ports.owner, kind, new Date(nowMs - NOTICE_WINDOW_MS).toISOString());
    if (!row || row.pushNote !== null) return null;
    return await attemptRow(row, ports, nowMs);
  } catch {
    return null;
  }
}

export interface FlushResult {
  ok: boolean;
  considered: number;
  attempted: number;
  sent: number;
}

/**
 * The server flush. Sends every buzzing notable that has no 'sent' note yet, written within the retry window, whether
 * or not a browser ever called. Run from the server clock (buddy-night-clock) and at the start of the day run.
 * Rules: 'sent' is never sent again. A fresh 'pending' claim is in progress and is left alone. A stale one is retried.
 * Keys and devices are checked on every attempt, so a row retried later is sent once keys or a device appear.
 */
export async function flushUnpushedNotables(ports: NotablePushPorts, nowMs: number = Date.now(), owner?: string): Promise<FlushResult> {
  let rows: NotableRow[];
  try {
    rows = await ports.listRetryable(new Date(nowMs - RETRY_WINDOW_MS).toISOString(), owner);
  } catch {
    return { ok: false, considered: 0, attempted: 0, sent: 0 };
  }
  const result: FlushResult = { ok: true, considered: rows.length, attempted: 0, sent: 0 };
  for (const row of rows) {
    if (!shouldBuzz(row.kind)) continue;
    if (row.pushNote === "sent") continue;
    if (row.pushNote !== null && !RETRYABLE_NOTES.includes(row.pushNote)) continue;
    if (row.pushNote === "pending" && row.claimedAt !== null && Date.parse(row.claimedAt) > nowMs - PENDING_STALE_MS) continue;
    const status = await attemptRow(row, ports, nowMs);
    if (status === null) continue;
    result.attempted += 1;
    if (status === "sent") result.sent += 1;
  }
  return result;
}

export async function loadPushCredentials(sb: SupabaseClient): Promise<VapidCredentials | null> {
  const read = async (name: string): Promise<string | null> => {
    try {
      const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: name });
      return !error && typeof data === "string" && data.trim().length > 0 ? data.trim() : null;
    } catch {
      return null;
    }
  };
  const publicKey = await read("vapid_public_key");
  const subject = await read("vapid_subject");
  const privateKey = await read("vapid_private_key");
  return publicKey && subject && privateKey ? { publicKey, subject, privateKey } : null;
}

/** The owner's push deps: VAPID from Vault, confirmed devices from the owner's rows, delivery notes through the record function. */
export function ownerPushDeps(sb: SupabaseClient, owner: string, send?: PushNotifyDeps["send"]): PushNotifyDeps {
  return {
    loadCredentials: () => loadPushCredentials(sb),
    loadTargets: async (): Promise<PushTarget[]> => {
      const { data: rows, error: rowsError } = await sb.rpc("push_test_targets", { p_owner_user_id: owner, p_limit: 10 });
      if (rowsError || !Array.isArray(rows)) throw new Error("targets");
      return rows.map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ""),
        device_id: typeof row.device_id === "string" ? row.device_id : undefined,
        endpoint: String(row.endpoint ?? ""),
        p256dh: String(row.p256dh ?? ""),
        auth_key: String(row.auth_key ?? ""),
      }));
    },
    // The same record function the push handler uses. It revokes and scrubs the device in one step.
    markGone: async (target: PushTarget) => {
      if (!target.id) return;
      const { error } = await sb.rpc("push_record_delivery", { p_id: target.id, p_status: "expired" });
      if (error) throw new Error("record expired");
    },
    markSent: async (target: PushTarget) => {
      if (!target.id) return;
      await sb.rpc("push_record_delivery", { p_id: target.id, p_status: "sent" });
    },
    send,
  };
}

const ROW_COLUMNS = "id,owner_id,mind,kind,title,happened_at,push_note,push_claimed_at";

function rowFrom(data: Record<string, unknown>): NotableRow {
  return {
    id: String(data.id),
    owner: String(data.owner_id),
    mind: String(data.mind),
    kind: String(data.kind),
    title: String(data.title ?? ""),
    happenedAt: String(data.happened_at),
    pushNote: typeof data.push_note === "string" ? data.push_note : null,
    claimedAt: typeof data.push_claimed_at === "string" ? data.push_claimed_at : null,
  };
}

/**
 * The real ports on the service client. `owner` scopes the browser and chat path (findNewestUnpushed). The flush
 * (listRetryable) reads every owner's rows; every write is scoped to the row's own owner.
 */
export function servicePushPorts(sb: SupabaseClient, send?: PushNotifyDeps["send"]): NotablePushPorts {
  return {
    findNewestUnpushed: async (owner, kind, sinceIso) => {
      const { data, error } = await sb
        .from("minds_notable_events")
        .select(ROW_COLUMNS)
        .eq("owner_id", owner)
        .eq("kind", kind)
        .is("push_note", null)
        .gte("happened_at", sinceIso)
        .order("happened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("notable read");
      return data ? rowFrom(data as Record<string, unknown>) : null;
    },
    listRetryable: async (sinceIso, owner) => {
      let query = sb
        .from("minds_notable_events")
        .select(ROW_COLUMNS)
        .in("kind", [...BUZZ_KINDS])
        .gte("happened_at", sinceIso)
        .or(`push_note.is.null,push_note.in.(${RETRYABLE_NOTES.join(",")})`);
      if (owner) query = query.eq("owner_id", owner);
      const { data, error } = await query.order("happened_at", { ascending: true }).limit(100);
      if (error) throw new Error("notable list");
      return Array.isArray(data) ? data.map((item) => rowFrom(item as Record<string, unknown>)) : [];
    },
    claim: async (row, from, nowIso) => {
      let query = sb.from("minds_notable_events").update({ push_note: "pending", push_claimed_at: nowIso }).eq("id", row.id).eq("owner_id", row.owner);
      const named = from.filter((item): item is string => item !== null);
      if (from.includes(null)) {
        query = named.length === 0 ? query.is("push_note", null) : query.or(`push_note.is.null,push_note.in.(${named.join(",")})`);
      } else {
        query = query.in("push_note", named);
      }
      const { data, error } = await query.select("id");
      if (error) return "error";
      return Array.isArray(data) && data.length === 1 ? "claimed" : "lost";
    },
    setPushNote: async (row, status) => {
      const { error } = await sb.from("minds_notable_events").update({ push_note: status }).eq("id", row.id).eq("owner_id", row.owner);
      if (error) throw new Error("note");
    },
    logSkip: async (row, detail) => {
      const { error } = await sb.from("minds_daily_log").insert({
        owner_id: row.owner,
        day: ownerDayOf(row.happenedAt),
        mind: DAILY_LOG_MINDS.includes(row.mind) ? row.mind : "buddy",
        action: "Owner phone push",
        outcome: "skipped",
        detail: clip(detail, 500),
        order_id: null,
      });
      if (error) throw new Error("log");
    },
    deps: (owner) => ownerPushDeps(sb, owner, send),
  };
}

/** The browser and chat path: the same ports, bound to one owner. */
export function ownerNotablePorts(sb: SupabaseClient, owner: string, send?: PushNotifyDeps["send"]): NotablePushPorts & { owner: string } {
  return { ...servicePushPorts(sb, send), owner };
}
