// Phase I slice 4: what a mind remembers, and the one rule that stops a repeat.
//
// A mind remembers three things, and nothing else:
//   1. the facts (the site numbers, already read for this run),
//   2. the last thing the owner was told (the newest telling, with the day it was told),
//   3. this chat (the owner's own words and Buddy's answers, newest last).
//
// The rule that comes with memory: the same telling is never made twice. A spike, a drop, a dead product that the
// owner has already been told about is not retold. When nothing is left to tell, the day stays Quiet instead.
//
// Pure logic: no database, no Deno globals, so it runs under Vitest. The caller does the reads and passes the rows in.

import { QUIET_LINE } from "./buddyBriefing.ts";

/** How much of the site facts a mind is given. The caller clips its own reads to the same size. */
export const MEMORY_FACT_LIMIT = 1200;
/** How much of the last telling a mind is given. */
export const LAST_TELLING_LIMIT = 400;
/** How many turns of the owner's own chat a mind is given. */
export const MEMORY_CHAT_TURNS = 6;
/** How much of one chat turn a mind is given. */
export const CHAT_LINE_LIMIT = 300;
/** How many recent tellings are read back when the run decides what is new. */
export const TOLD_LIMIT = 80;

/** One thing the owner was already told, with the day it was told. */
export interface ToldTelling {
  day: string;
  text: string;
}

/** One turn of the owner's chat with Buddy. */
export interface MemoryTurn {
  speaker: "owner" | "buddy";
  text: string;
}

export interface MindMemory {
  /** The site facts for this run, already read. */
  facts: string;
  /** The newest telling, or null when the owner has never been told anything. */
  lastTelling: ToldTelling | null;
  /** The owner's own chat, oldest first. */
  chat: MemoryTurn[];
}

export const NO_TELLING_LINE = "Buddy has not told the owner anything yet.";
export const NO_CHAT_LINE = "The owner has not said anything in the chat yet.";
export const NO_FACTS_LINE = "The site numbers could not be read this run.";

function clip(value: string, limit: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/**
 * The words of a telling, lower case, letters and digits only. Two tellings with the same key are the same telling.
 * The Auditor uses the same idea for the four pack texts, so "same" means the same in both places.
 */
export function sayKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when two tellings say the same thing, however they are punctuated or spaced. */
export function sameTelling(a: string, b: string): boolean {
  const key = sayKey(a);
  return key.length > 0 && key === sayKey(b);
}

/** True when this telling is one the owner has already been told. */
export function wasTold(text: string, told: readonly ToldTelling[]): boolean {
  return told.some((item) => sameTelling(item.text, text));
}

/**
 * The tellings that are new, and the count of the ones that are not. A plan is the same telling when its whole words
 * (its title and its own detail together), or its title alone, were told before: memory is what stops a spike, a drop
 * or a dead product from being reported all over again.
 *
 * Only the title is matched on its own. A detail is never matched alone, because some details are the same sentence
 * every time (a sale says the same thing about a different amount), and matching those would silence real news.
 */
export function freshTellings<T extends { title: string; detail?: string }>(
  plans: readonly T[],
  told: readonly ToldTelling[],
): { fresh: T[]; retold: number } {
  const fresh: T[] = [];
  let retold = 0;
  for (const plan of plans) {
    const whole = [plan.title, typeof plan.detail === "string" ? plan.detail : ""].filter(Boolean).join(" ");
    const already = wasTold(whole, told) || wasTold(plan.title, told);
    if (already) retold += 1;
    else fresh.push(plan);
  }
  return { fresh, retold };
}

/**
 * The line for a run that had tellings to make and made none of them, because the owner had already heard them.
 * That is the Quiet case: memory stops the repeat, and the owner is not told the same thing twice.
 */
export function quietWhenNothingNew(fresh: number, retold: number): string | null {
  return fresh === 0 && retold > 0 ? QUIET_LINE : null;
}

/** One plain block of memory for a mind's prompt. Honest when a part was never read or never said. */
export function memoryBlock(memory: MindMemory): string {
  const lines: string[] = ["What you remember (from earlier runs and from the owner's own chat):"];
  lines.push(`Site facts for this run: ${clip(memory.facts, MEMORY_FACT_LIMIT) || NO_FACTS_LINE}`);
  lines.push(
    memory.lastTelling
      ? `What the owner was last told, on ${memory.lastTelling.day}: ${clip(memory.lastTelling.text, LAST_TELLING_LIMIT)}`
      : NO_TELLING_LINE,
  );
  lines.push("Never tell the owner the same thing twice. If it is already in this memory, it is not news.");
  const chat = memory.chat.slice(-MEMORY_CHAT_TURNS).filter((turn) => turn.text.trim().length > 0);
  if (chat.length === 0) {
    lines.push(NO_CHAT_LINE);
  } else {
    lines.push("The owner's own chat (oldest first):");
    for (const turn of chat) {
      lines.push(`- ${turn.speaker === "owner" ? "Owner" : "Buddy"}: ${clip(turn.text, CHAT_LINE_LIMIT)}`);
    }
  }
  return lines.join("\n");
}

/** The facts and the memory as one prompt block, the way a mind receives it. */
export function factsWithMemory(facts: string, memory: string | null | undefined): string {
  const base = facts.trim() || NO_FACTS_LINE;
  const remembered = (memory ?? "").trim();
  return remembered ? `${base}\n\n${remembered}` : base;
}

/**
 * Reads the rows into the memory shape. A telling with no words, or a turn with no words, is dropped rather than
 * guessed at. The newest telling wins; the chat is kept oldest first, so a mind reads it in order.
 */
export function memoryFromReads(input: {
  facts: string;
  lastTelling?: { day?: unknown; text?: unknown } | null;
  chat?: ReadonlyArray<{ speaker?: unknown; text?: unknown }>;
}): MindMemory {
  const text = typeof input.lastTelling?.text === "string" ? input.lastTelling.text.trim() : "";
  const day = typeof input.lastTelling?.day === "string" && input.lastTelling.day.trim() ? input.lastTelling.day.trim() : null;
  const chat: MemoryTurn[] = [];
  for (const turn of input.chat ?? []) {
    const words = typeof turn.text === "string" ? turn.text.trim() : "";
    if (!words) continue;
    chat.push({ speaker: turn.speaker === "owner" ? "owner" : "buddy", text: words.slice(0, CHAT_LINE_LIMIT * 4) });
  }
  return {
    facts: typeof input.facts === "string" ? input.facts : "",
    lastTelling: text ? { day: day ?? "", text } : null,
    chat,
  };
}
