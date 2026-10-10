// One server path for a notable that was written by a database function or by the owner's own switch.
// The day run's recordNotable writes its own row and uses ownerPushDeps directly. Everything here sends only to
// the owner's own confirmed devices, through notifyOwnerDevices (the same helper, the same VAPID keys).
// Never throws. Never logs or returns a key, an endpoint or a device detail.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { NO_DEVICE_COPY, PUSH_HELP_COPY, notifyOwnerDevices, shouldBuzz, type PushNotifyDeps, type PushStatus } from "./notablePush.ts";
import { OWNER_UTC_OFFSET_HOURS } from "./mindsNightReport.ts";
import type { PushTarget, VapidCredentials } from "./webPush.ts";

/** A notable row is pushed only if it was written this recently. Older rows were already seen, or never buzzed. */
export const NOTICE_WINDOW_MS = 120_000;

/** The daily log accepts these minds only. A notable's own mind (for example "owner") is shown as "buddy" there. */
const DAILY_LOG_MINDS = ["buddy", "analyst", "strategist", "ceo", "executioner", "auditor"];

export interface NewestNotable {
  id: string;
  mind: string;
  title: string;
  happenedAt: string;
}

export interface NotablePushPorts {
  /** The newest notable of this kind, written since the given time, that has not been pushed yet. Null when none. */
  findUnsent: (kind: string, sinceIso: string) => Promise<NewestNotable | null>;
  setPushNote: (id: string, status: PushStatus) => Promise<void>;
  logSkip: (entry: { day: string; mind: string; detail: string }) => Promise<void>;
  notify: PushNotifyDeps;
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
 * Attempts one owner push for the newest unsent notable of this kind. Returns the push status, or null when nothing
 * was attempted (kind does not buzz, no fresh row, or a read failed). A missing key or device is recorded on the row
 * and written once to the daily log, in plain words. A push that fails is recorded as failed, never as sent.
 */
export async function pushNewestNotable(kind: string, ports: NotablePushPorts, nowMs: number = Date.now()): Promise<PushStatus | null> {
  try {
    if (!shouldBuzz(kind)) return null;
    const since = new Date(nowMs - NOTICE_WINDOW_MS).toISOString();
    const row = await ports.findUnsent(kind, since);
    if (!row) return null;
    const outcome = await notifyOwnerDevices(kind, row.title, ports.notify);
    try {
      await ports.setPushNote(row.id, outcome.status);
    } catch {
      // The push itself already happened or was skipped. Only the note is lost.
    }
    if (outcome.status === "no_device" || outcome.status === "not_configured") {
      try {
        await ports.logSkip({
          day: ownerDayOf(row.happenedAt),
          mind: DAILY_LOG_MINDS.includes(row.mind) ? row.mind : "buddy",
          detail: clip(outcome.status === "no_device" ? NO_DEVICE_COPY : PUSH_HELP_COPY, 500),
        });
      } catch {
        // The skip line is extra. Nothing else depends on it.
      }
    }
    return outcome.status;
  } catch {
    return null;
  }
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

/** The real ports, for one owner, on the service client. Only that owner's rows are read or changed. */
export function ownerNotablePorts(sb: SupabaseClient, owner: string, send?: PushNotifyDeps["send"]): NotablePushPorts {
  return {
    findUnsent: async (kind, sinceIso) => {
      const { data, error } = await sb
        .from("minds_notable_events")
        .select("id,mind,title,happened_at")
        .eq("owner_id", owner)
        .eq("kind", kind)
        .is("push_note", null)
        .gte("happened_at", sinceIso)
        .order("happened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("notable read");
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return { id: String(row.id), mind: String(row.mind), title: String(row.title ?? ""), happenedAt: String(row.happened_at) };
    },
    setPushNote: async (id, status) => {
      const { error } = await sb.from("minds_notable_events").update({ push_note: status }).eq("id", id).eq("owner_id", owner);
      if (error) throw new Error("note");
    },
    logSkip: async (entry) => {
      const { error } = await sb.from("minds_daily_log").insert({
        owner_id: owner,
        day: entry.day,
        mind: entry.mind,
        action: "Owner phone push",
        outcome: "skipped",
        detail: entry.detail,
        order_id: null,
      });
      if (error) throw new Error("log");
    },
    notify: ownerPushDeps(sb, owner, send),
  };
}
