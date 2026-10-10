import { isKilled, type MindKey } from './mindRoster';
import {
  NO_KEY_ACTION,
  NO_KEY_DETAIL,
  STOPPED_ACTION,
  STOPPED_DETAIL,
  isProposalKind,
  refusedDetail,
} from './mindGuards';
import type { MindContext, MindLogEntry, MindPorts, MindRun, Proposal, ThinkFailure, ThinkResult } from './mindTypes';

export const SUMMARY_LIMIT = 500;
export const DETAIL_LIMIT = 300;
export const PROPOSAL_LIMIT = 300;

/** The rules every mind is given. The reply shape is fixed so the proposals can be checked. */
export const MIND_RULES = [
  "You are one of Buddy's background minds for an owner-run site. You are not talking to the owner.",
  'Never publish, write or edit article text, change prices, create products, send email or messages,',
  'spend money, switch off another mind, or speak to a customer as the owner.',
  'Reply with JSON only, in this shape: {"summary": "one or two plain sentences", "proposals": [{"kind": "note|suggest|sort|prepare", "text": "plain English"}]}.',
  'Use an empty proposals list when you have nothing to add. Plain English, no jargon.',
].join(' ');

export function clip(value: string, limit: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Reads a reply. Anything that is not the agreed shape becomes a plain summary and no proposals. */
export function parseMindReply(text: string): { summary: string; proposals: Array<{ kind: unknown; text: unknown }> } {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      const summary = typeof parsed.summary === 'string' ? clip(parsed.summary, SUMMARY_LIMIT) : '';
      const proposals = Array.isArray(parsed.proposals)
        ? parsed.proposals
            .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
            .map((item) => ({ kind: item.kind, text: item.text }))
        : [];
      return { summary, proposals };
    } catch {
      // Fall through to a plain summary.
    }
  }
  return { summary: clip(cleaned, SUMMARY_LIMIT), proposals: [] };
}

export function failureDetail(reason: ThinkFailure): string {
  switch (reason) {
    case 'no_key':
      return NO_KEY_DETAIL;
    case 'rejected':
      return 'A brain refused its key. Check it on the Brains page.';
    case 'rate_limited':
      return 'The brains are busy. Try again later.';
    case 'unavailable':
      return 'No brain could be reached. Try again later.';
    case 'empty':
      return 'No brain sent back anything usable.';
  }
}

export async function finish(ports: MindPorts, entry: MindLogEntry, proposals: Proposal[] = [], refused = 0): Promise<MindRun> {
  await ports.log(entry);
  return { entry, proposals, refused };
}

/** Kill first: a stopped mind does not think at all. */
export function stoppedRun(ports: MindPorts, mind: MindKey, context: MindContext): Promise<MindRun> | null {
  if (!isKilled(context.killScope, mind)) return null;
  return finish(ports, { mind, action: STOPPED_ACTION, outcome: 'skipped', detail: STOPPED_DETAIL });
}

/** One call through the think port (the brain chain). A thrown error becomes an honest "could not think". */
export async function thinkOnce(ports: MindPorts, mind: MindKey, system: string, prompt: string): Promise<ThinkResult> {
  try {
    return await ports.think({ mind, system, prompt });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export function factsPrompt(context: MindContext): string {
  const orders = context.orders.length ? context.orders.map((order) => `- ${order}`).join('\n') : '- none';
  return `Site facts (read-only):\n${context.facts || 'none read'}\n\nWaiting orders from the owner:\n${orders}`;
}

/**
 * The shared path for a thinking mind: stop if killed, think once, check the reply, log one row.
 * Without a saved key the log row reads "Cannot think: no brain key saved".
 */
export async function runThinkingMind(
  ports: MindPorts,
  mind: MindKey,
  context: MindContext,
  spec: { action: string; system: string; prompt: string },
): Promise<MindRun> {
  const stopped = stoppedRun(ports, mind, context);
  if (stopped) return stopped;

  const result = await thinkOnce(ports, mind, spec.system, spec.prompt);
  if (!result.ok) {
    if (result.reason === 'no_key') {
      return finish(ports, { mind, action: NO_KEY_ACTION, outcome: 'skipped', detail: '' });
    }
    return finish(ports, { mind, action: 'Could not think', outcome: 'failed', detail: failureDetail(result.reason) });
  }

  const reply = parseMindReply(result.text);
  const proposals: Proposal[] = [];
  let refused = 0;
  for (const item of reply.proposals) {
    if (isProposalKind(item.kind) && typeof item.text === 'string' && item.text.trim()) {
      proposals.push({ kind: item.kind, text: clip(item.text, PROPOSAL_LIMIT) });
    } else {
      refused += 1;
    }
  }
  const detail = [reply.summary, refused ? refusedDetail(refused) : ''].filter(Boolean).join(' ');
  return finish(ports, { mind, action: spec.action, outcome: 'done', detail: clip(detail, DETAIL_LIMIT) }, proposals, refused);
}
