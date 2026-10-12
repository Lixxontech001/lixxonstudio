// Phase I slice 4: the one server read that builds a mind's memory (the last telling and the owner's own chat).
// Used by the 08:00 clock and by the owner's own day run, so both give the minds the same memory. Read-only: this
// file never writes anything, and a read that fails leaves the memory out rather than guessing at it.

import { MEMORY_CHAT_TURNS, TOLD_LIMIT, memoryBlock, memoryFromReads } from "./mindMemory.ts";
import { ownerDayOf } from "./mindsNightReport.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemoryClient = any;

/**
 * The memory block for one owner: the newest telling (so the same thing is not retold) and the last few turns of the
 * owner's own chat. `facts` is the site block the caller already read, folded in so a mind receives one block.
 * A read that fails is left out, so the minds get the facts alone and never words nobody said.
 */
export async function readMemoryBlock(sb: MemoryClient, owner: string, facts: string): Promise<string> {
  let lastTelling: { day: string; text: string } | null = null;
  try {
    const { data, error } = await sb
      .from("minds_notable_events")
      .select("title,detail,happened_at")
      .eq("owner_id", owner)
      .order("happened_at", { ascending: false })
      .limit(TOLD_LIMIT);
    const newest = Array.isArray(data) && data.length > 0 ? (data[0] as Record<string, unknown>) : null;
    const title = typeof newest?.title === "string" ? newest.title : "";
    const detail = typeof newest?.detail === "string" ? newest.detail : "";
    if (!error && title) {
      lastTelling = {
        day: typeof newest?.happened_at === "string" ? ownerDayOf(newest.happened_at) : "",
        text: [title, detail].filter(Boolean).join(" "),
      };
    }
  } catch {
    lastTelling = null;
  }

  let chat: Array<{ speaker: string; text: string }> = [];
  try {
    const { data: chats, error: chatError } = await sb
      .from("buddy_chats")
      .select("id")
      .eq("owner_id", owner)
      .order("updated_at", { ascending: false })
      .limit(1);
    const chatId = Array.isArray(chats) && chats.length > 0 ? String((chats[0] as { id?: unknown }).id ?? "") : "";
    if (!chatError && chatId) {
      const { data, error } = await sb
        .from("buddy_messages")
        .select("role,content,created_at")
        .eq("chat_id", chatId)
        .in("kind", ["reply", "briefing"])
        .order("created_at", { ascending: false })
        .limit(MEMORY_CHAT_TURNS);
      if (!error && Array.isArray(data)) {
        chat = (data as Array<Record<string, unknown>>)
          .slice()
          .reverse()
          .map((row) => ({ speaker: row.role === "owner" ? "owner" : "buddy", text: typeof row.content === "string" ? row.content : "" }));
      }
    }
  } catch {
    chat = [];
  }

  return memoryBlock(memoryFromReads({ facts, lastTelling, chat }));
}
