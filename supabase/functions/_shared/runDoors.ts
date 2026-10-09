// The day run's door step: post the newest fresh article to each open free door that is fully connected.
// Order per door: check connected, check today's cap, pick the article, reserve the post (the database refuses when
// Takeover is off or Kill stops the run), send, then record the result. Pure logic. Doors come in through `ports`.
// Secret values are read only to send. They are never put in a detail, a log line, or a reply.

import { DOORS, doorStatus, type DoorId } from "./doorRegistry.ts";
import { DOOR_DAILY_LIMIT, OPEN_DOORS, pickDoorArticle, type DoorArticle } from "./doorPosts.ts";
import type { DoorSendResult } from "./doorAdapters.ts";
import { blockedDetail, KILL_BLOCK_DETAIL, TAKEOVER_OFF_DETAIL } from "./runDay.ts";
import type { KillScope } from "./placementRun.ts";

export const DOORS_NOTHING_CONNECTED_DETAIL = "No free door is connected yet. Connect one on Connections.";

export interface DoorRunInput {
  localDay: string;
  takeover: boolean;
  killScope: KillScope;
  nowMs: number;
  siteOrigin: string | null;
}

export type ReserveResult = { ok: true; id: string } | { ok: false; reason: string };

export interface DoorRunPorts {
  readArticles: () => Promise<DoorArticle[]>;
  readPostedIds: (door: DoorId) => Promise<Set<string>>;
  countToday: (door: DoorId, localDay: string) => Promise<number>;
  readSecret: (name: string) => Promise<string | null>;
  reserve: (door: DoorId, articleId: string, localDay: string, articleUrl: string) => Promise<ReserveResult>;
  send: (door: DoorId, values: Record<string, string>, text: string) => Promise<DoorSendResult>;
  finish: (id: string, status: "posted" | "failed", externalRef: string | null, errorNote: string | null) => Promise<void>;
  log: (entry: { door: DoorId; outcome: "done" | "failed"; detail: string }) => Promise<void>;
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

export async function runDoors(input: DoorRunInput, ports: DoorRunPorts): Promise<DoorRunResult> {
  const gate = blockedDetail(input.takeover, input.killScope);
  if (gate) return { status: "held", detail: gate, posted: 0, outcomes: [] };

  const outcomes: DoorOutcome[] = [];
  let articles: DoorArticle[] | null = null;

  for (const door of OPEN_DOORS) {
    const label = DOORS[door].label;
    const values: Record<string, string> = {};
    for (const field of DOORS[door].fields) {
      const value = await ports.readSecret(field.secretName);
      if (value) values[field.secretName] = value;
    }
    const status = doorStatus(door, new Set(Object.keys(values)));
    if (status.state !== "connected") {
      outcomes.push({ door, outcome: "not_connected", detail: `${label} is not connected yet.` });
      continue;
    }

    if ((await ports.countToday(door, input.localDay)) >= DOOR_DAILY_LIMIT) {
      outcomes.push({ door, outcome: "skipped", detail: `${label}: already posted today.` });
      continue;
    }

    articles ??= await ports.readArticles();
    const pick = pickDoorArticle({ articles, postedIds: await ports.readPostedIds(door), nowMs: input.nowMs, siteOrigin: input.siteOrigin });
    if (!pick.ok) {
      const detail = pick.reason === "copy_not_clean"
        ? `${label}: the newest article title has text that cannot be posted.`
        : `${label}: no new article to post yet.`;
      outcomes.push({ door, outcome: "skipped", detail });
      continue;
    }

    const reserved = await ports.reserve(door, pick.article.id, input.localDay, pick.articleUrl);
    if (!reserved.ok) {
      if (HELD_REASONS[reserved.reason]) {
        return { status: "held", detail: HELD_REASONS[reserved.reason], posted: outcomes.filter((item) => item.outcome === "posted").length, outcomes };
      }
      const detail = reserved.reason === "already_posted" || reserved.reason === "door_day_cap"
        ? `${label}: nothing new was posted.`
        : `${label}: could not start the post. Nothing was posted.`;
      outcomes.push({ door, outcome: "skipped", detail });
      continue;
    }

    const sent = await ports.send(door, values, pick.text);
    if (sent.ok) {
      await ports.finish(reserved.id, "posted", sent.externalRef, null);
      const detail = `Posted to ${label}: "${pick.article.title}".`;
      outcomes.push({ door, outcome: "posted", detail });
      await ports.log({ door, outcome: "done", detail });
    } else {
      await ports.finish(reserved.id, "failed", null, sent.reason);
      const detail = `${label} did not take it: ${sent.reason}`;
      outcomes.push({ door, outcome: "failed", detail });
      await ports.log({ door, outcome: "failed", detail });
    }
  }

  const posted = outcomes.filter((item) => item.outcome === "posted").length;
  if (outcomes.every((item) => item.outcome === "not_connected")) {
    return { status: "nothing_to_do", detail: DOORS_NOTHING_CONNECTED_DETAIL, posted, outcomes };
  }
  return { status: "done", detail: clip(outcomes.map((item) => item.detail).join(" ")), posted, outcomes };
}
