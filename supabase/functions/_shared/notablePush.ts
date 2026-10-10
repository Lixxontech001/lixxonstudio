// Notable events that buzz the owner's phone. Pure: the day run passes in the loaders and the sender.
// It reuses the Web Push sender and the VAPID keys already on the Keys page. No second push vendor.
// Heartbeat is not a buzz kind, so it never buzzes. Nothing here logs or returns a key, an endpoint or a device detail.
// A push problem never fails the day run: every failure becomes a status, and the caller keeps going.

import { BRIEFING_NOTABLE_KINDS } from "./buddyBriefing.ts";
import { sendPushNotification, type PushSendResult, type PushTarget, type VapidCredentials } from "./webPush.ts";

/**
 * The events that buzz the owner's phone: every briefing kind (what the owner reads in the morning), plus
 * finished jobs, which the placement job writes and the owner has always been told about. Anything else is still
 * written to the notable list, but it does not buzz.
 */
export const BUZZ_KINDS: readonly string[] = Object.freeze([...new Set([...BRIEFING_NOTABLE_KINDS, "job_finished"])]);

export function shouldBuzz(kind: string): boolean {
  return BUZZ_KINDS.includes(kind);
}

/** The owner's words for turning push on. The same wording as the Keys page. */
export const PUSH_HELP_COPY = "To turn push on: enter your VAPID values, then open /admin/settings on your phone and tap Register this device.";
export const NO_DEVICE_COPY = "no device";
const NOTIFICATION_TITLE = "Buddy";
/** Where a tap on the notification opens: Buddy, the owner's voice. */
const NOTIFICATION_URL = "/buddy";

export type PushStatus = "sent" | "no_device" | "not_configured" | "failed" | "not_buzzing";

export interface PushNotifyOutcome {
  status: PushStatus;
  sent: number;
  gone: number;
  failed: number;
}

export interface PushNotifyDeps {
  /** The three VAPID values, or null when any of them is missing. */
  loadCredentials: () => Promise<VapidCredentials | null>;
  /** The owner's confirmed devices. Empty when none is registered. */
  loadTargets: () => Promise<PushTarget[]>;
  /** Sends one notification. Defaults to the Web Push sender. */
  send?: (target: PushTarget, payload: string, credentials: VapidCredentials) => Promise<PushSendResult>;
  /** Called for a device the push service says is gone, so it is not tried again. */
  markGone?: (target: PushTarget) => Promise<void>;
  /** Called for a device the push service accepted, so the owner's Settings page shows the last delivery. */
  markSent?: (target: PushTarget) => Promise<void>;
  /**
   * Called once keys and at least one device are present, right before the first send. Returning false means another
   * attempt holds this notable, so nothing is sent. Phase E: the claim that makes one send per notable.
   */
  beforeSend?: () => Promise<boolean>;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** The notification body: a title, a short line, a tag and where a tap goes. Never a device, key or address. */
export function pushPayload(kind: string, title: string): string {
  return JSON.stringify({
    title: NOTIFICATION_TITLE,
    body: clip(title.trim() || "Something needs a look.", 120),
    tag: `lixxon-${kind}`,
    renotify: true,
    data: { url: NOTIFICATION_URL },
  });
}

/**
 * Sends one notification to each confirmed device. Never throws.
 * Not configured: the three keys are missing. No device: nothing is registered, or every device is gone.
 */
export async function notifyOwnerDevices(kind: string, title: string, deps: PushNotifyDeps): Promise<PushNotifyOutcome> {
  const none = { sent: 0, gone: 0, failed: 0 };
  if (!shouldBuzz(kind)) return { status: "not_buzzing", ...none };

  let credentials: VapidCredentials | null;
  try {
    credentials = await deps.loadCredentials();
  } catch {
    return { status: "failed", ...none, failed: 1 };
  }
  if (!credentials) return { status: "not_configured", ...none };

  let targets: PushTarget[];
  try {
    targets = await deps.loadTargets();
  } catch {
    return { status: "failed", ...none, failed: 1 };
  }
  if (targets.length === 0) return { status: "no_device", ...none };
  if (deps.beforeSend && !(await deps.beforeSend())) return { status: "failed", ...none, failed: 1 };

  const payload = pushPayload(kind, title);
  const send = deps.send ?? ((target: PushTarget, body: string, creds: VapidCredentials) => sendPushNotification(target, body, creds));
  let sent = 0;
  let gone = 0;
  let failed = 0;
  for (const target of targets) {
    let result: PushSendResult;
    try {
      result = await send(target, payload, credentials);
    } catch {
      failed += 1;
      continue;
    }
    if (result.status === "sent") {
      sent += 1;
      try {
        await deps.markSent?.(target);
      } catch {
        // The delivery itself happened. Only the status note is lost.
      }
    } else if (result.status === "expired") {
      gone += 1;
      try {
        await deps.markGone?.(target);
      } catch {
        // The device is tried again next time. Nothing else depends on this.
      }
    } else {
      failed += 1;
    }
  }
  if (sent > 0) return { status: "sent", sent, gone, failed };
  if (gone > 0 && failed === 0) return { status: "no_device", sent, gone, failed };
  return { status: "failed", sent, gone, failed };
}
