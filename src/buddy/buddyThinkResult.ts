/** Reads the buddy-think answers. Anything unexpected becomes null, so the screen never shows a made-up reply. */

export type BuddyThinkReply =
  | { ok: true; reply: string; model: string; canThink: boolean; runStart: boolean }
  | { ok: false; reason: string; message: string; canThink: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The status action answers whether any tryable brain has its key saved. It never contains a key. */
export function parseKeyStatus(value: unknown): boolean | null {
  if (!isRecord(value) || value.ok !== true || typeof value.configured !== 'boolean') return null;
  return value.configured;
}

export function parseThinkReply(value: unknown): BuddyThinkReply | null {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return null;
  const canThink = value.can_think === true;
  if (value.ok) {
    if (typeof value.reply !== 'string' || !value.reply.trim()) return null;
    return {
      ok: true,
      reply: value.reply.slice(0, 4000),
      model: typeof value.model === 'string' ? value.model.slice(0, 80) : '',
      canThink,
      runStart: value.run_start === true,
    };
  }
  if (typeof value.reason !== 'string' || typeof value.message !== 'string') return null;
  return { ok: false, reason: value.reason.slice(0, 40), message: value.message.slice(0, 300), canThink };
}

export type BuddyBriefingResult =
  | { ok: true; chatId: string; created: boolean; firstVisit: boolean; quiet: boolean; text: string }
  | { ok: false; reason: string; message: string };

/** Reads the briefing answer. The briefing itself is read back from the saved messages, so only the summary is kept here. */
export function parseBriefingResult(value: unknown): BuddyBriefingResult | null {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    if (typeof value.chat_id !== 'string' || typeof value.text !== 'string') return null;
    return {
      ok: true,
      chatId: value.chat_id,
      created: value.created === true,
      firstVisit: value.first_visit === true,
      quiet: value.quiet === true,
      text: value.text.slice(0, 4000),
    };
  }
  if (typeof value.reason !== 'string' || typeof value.message !== 'string') return null;
  return { ok: false, reason: value.reason.slice(0, 40), message: value.message.slice(0, 300) };
}

export interface DayRunAnswer {
  status: string;
  detail: string;
}

/** Reads the answer of the owner-only run function. Anything without a plain detail becomes null. */
export function parseRunAnswer(value: unknown): DayRunAnswer | null {
  if (!isRecord(value)) return null;
  if (typeof value.status !== 'string' || typeof value.detail !== 'string' || !value.detail.trim()) return null;
  return { status: value.status.slice(0, 40), detail: value.detail.slice(0, 300) };
}
