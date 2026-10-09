import { supabase } from '../lib/supabaseClient';
import { parseThinkReply, type BuddyThinkReply } from './buddyThinkResult';

/** Browser side of Buddy's chats. Row-level security on the database limits every read and write to this owner. */

export interface BuddyChatSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuddyChatMessage {
  id: string;
  role: 'owner' | 'buddy';
  kind: 'reply' | 'notice';
  content: string;
  createdAt: string;
}

export const CHAT_LIST_LIMIT = 50;
export const CHAT_MESSAGE_LIMIT = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function parseChatRow(row: unknown): BuddyChatSummary | null {
  if (!isRecord(row) || typeof row.id !== 'string' || !isTime(row.created_at) || !isTime(row.updated_at)) return null;
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title.slice(0, 80) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseChatRows(value: unknown): BuddyChatSummary[] | null {
  if (!Array.isArray(value)) return null;
  const chats: BuddyChatSummary[] = [];
  for (const row of value) {
    const chat = parseChatRow(row);
    if (!chat) return null;
    chats.push(chat);
  }
  return chats;
}

export function parseMessageRows(value: unknown): BuddyChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: BuddyChatMessage[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== 'string' || !isTime(row.created_at) || typeof row.content !== 'string') return null;
    if (row.role !== 'owner' && row.role !== 'buddy') return null;
    if (row.kind !== 'reply' && row.kind !== 'notice') return null;
    messages.push({ id: row.id, role: row.role, kind: row.kind, content: row.content, createdAt: row.created_at });
  }
  return messages;
}

/** The title shown in the history list. A chat with no title yet is called "New chat". */
export function chatLabel(chat: Pick<BuddyChatSummary, 'title'>): string {
  const title = chat.title?.trim();
  return title ? title : 'New chat';
}

export async function listChats(): Promise<BuddyChatSummary[] | null> {
  try {
    const { data, error } = await supabase
      .from('buddy_chats')
      .select('id,title,created_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(CHAT_LIST_LIMIT);
    if (error) return null;
    return parseChatRows(data);
  } catch {
    return null;
  }
}

export async function createChat(): Promise<BuddyChatSummary | null> {
  try {
    const { data, error } = await supabase
      .from('buddy_chats')
      .insert({})
      .select('id,title,created_at,updated_at')
      .single();
    if (error) return null;
    return parseChatRow(data);
  } catch {
    return null;
  }
}

export async function loadMessages(chatId: string): Promise<BuddyChatMessage[] | null> {
  try {
    const { data, error } = await supabase
      .from('buddy_messages')
      .select('id,role,kind,content,created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .limit(CHAT_MESSAGE_LIMIT);
    if (error) return null;
    return parseMessageRows(data);
  } catch {
    return null;
  }
}

/**
 * Sends one owner message to Buddy. Server-side failures that still carry a plain message
 * (for example a chat that cannot be read) come back as ok:false, so the screen can say why.
 */
export async function askBuddy(chatId: string, message: string): Promise<BuddyThinkReply | null> {
  try {
    const { data, error } = await supabase.functions.invoke('buddy-think', {
      body: { action: 'ask', chat_id: chatId, message },
    });
    if (!error) return parseThinkReply(data);
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const body: unknown = await context.json().catch(() => null);
      return parseThinkReply(body);
    }
    return null;
  } catch {
    return null;
  }
}
