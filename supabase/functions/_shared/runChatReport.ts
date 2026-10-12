// Save an owner-triggered run's plain result in the same private Buddy chat that started it.
// Storage is passed in so the result path can be tested without Supabase, live doors or push.

export const RUN_CHAT_REPORT_LIMIT = 1800;

export interface RunChatReportInput {
  ownerId: string;
  chatId: string;
  detail: string;
}

export interface RunChatReportPorts {
  saveBuddyReply(input: { ownerId: string; chatId: string; content: string }): Promise<boolean>;
  touchChat(input: { ownerId: string; chatId: string }): Promise<void>;
}

/** Stores only a non-empty run result. A failed chat timestamp update cannot hide a message already saved. */
export async function saveRunChatReport(input: RunChatReportInput, ports: RunChatReportPorts): Promise<boolean> {
  const content = input.detail.trim().slice(0, RUN_CHAT_REPORT_LIMIT);
  if (!content) return false;

  try {
    const saved = await ports.saveBuddyReply({ ownerId: input.ownerId, chatId: input.chatId, content });
    if (!saved) return false;
    try {
      await ports.touchChat({ ownerId: input.ownerId, chatId: input.chatId });
    } catch {
      // The saved reply is still available in the conversation; a failed timestamp update changes no run result.
    }
    return true;
  } catch {
    return false;
  }
}
