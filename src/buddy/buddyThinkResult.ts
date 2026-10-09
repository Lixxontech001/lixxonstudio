/** Reads the buddy-think answers. Anything unexpected becomes null, so the screen never shows a made-up reply. */

export type BuddyThinkReply =
  | { ok: true; reply: string; model: string; canThink: boolean }
  | { ok: false; reason: string; message: string; canThink: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The status action answers whether a Google key is saved. It never contains the key. */
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
    };
  }
  if (typeof value.reason !== 'string' || typeof value.message !== 'string') return null;
  return { ok: false, reason: value.reason.slice(0, 40), message: value.message.slice(0, 300), canThink };
}
