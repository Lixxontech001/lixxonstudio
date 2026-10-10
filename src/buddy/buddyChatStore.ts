import { supabase } from '../lib/supabaseClient';
import {
  parseBriefingResult,
  parseRunAnswer,
  parseThinkReply,
  type BuddyBriefingResult,
  type BuddyThinkReply,
  type DayRunAnswer,
} from './buddyThinkResult';

/** Browser side of Buddy's chats. Row-level security on the database limits every read and write to this owner. */

export interface BuddyChatSummary {
  id: string;
  title: string | null;
  kind: 'chat' | 'briefing';
  briefingDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One titled part of a morning briefing. Lines are plain sentences already checked on the server. */
export interface BriefingSection {
  id: string;
  title: string;
  lines: string[];
}

export interface BuddyChatMessage {
  id: string;
  role: 'owner' | 'buddy';
  kind: 'reply' | 'notice' | 'briefing';
  content: string;
  /** Present on a briefing with sections. Null for a quiet briefing or any other message. */
  sections: BriefingSection[] | null;
  createdAt: string;
}

export interface BuddyReport {
  id: string;
  reportDate: string;
  title: string;
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

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseChatRow(row: unknown): BuddyChatSummary | null {
  if (!isRecord(row) || typeof row.id !== 'string' || !isTime(row.created_at) || !isTime(row.updated_at)) return null;
  const isBriefing = row.kind === 'briefing';
  const briefingDate = typeof row.briefing_date === 'string' && DATE_ONLY_RE.test(row.briefing_date) ? row.briefing_date : null;
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title.slice(0, 80) : null,
    kind: isBriefing ? 'briefing' : 'chat',
    briefingDate: isBriefing ? briefingDate : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Reads the sections of a briefing message. Anything malformed becomes null, never a guessed structure. */
export function parseBriefingSections(payload: unknown): BriefingSection[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.sections)) return null;
  const sections: BriefingSection[] = [];
  for (const raw of payload.sections) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string' || !Array.isArray(raw.lines)) return null;
    const lines = raw.lines.filter((line): line is string => typeof line === 'string').map((line) => line.slice(0, 400));
    sections.push({ id: raw.id.slice(0, 40), title: raw.title.slice(0, 80), lines });
  }
  return sections.length > 0 ? sections : null;
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
    if (row.kind !== 'reply' && row.kind !== 'notice' && row.kind !== 'briefing') return null;
    const sections = row.kind === 'briefing' ? parseBriefingSections(row.payload) : null;
    messages.push({ id: row.id, role: row.role, kind: row.kind, content: row.content, sections, createdAt: row.created_at });
  }
  return messages;
}

/** The title shown in the history list. A chat with no title yet is called "New chat". A briefing is named by its day. */
export function chatLabel(chat: Pick<BuddyChatSummary, 'title'> & Partial<Pick<BuddyChatSummary, 'kind' | 'briefingDate'>>): string {
  if (chat.kind === 'briefing') {
    return chat.briefingDate ? `Daily briefing, ${formatDayLabel(chat.briefingDate)}` : 'Daily briefing';
  }
  const title = chat.title?.trim();
  return title ? title : 'New chat';
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "9 Oct 2026" for a plain YYYY-MM-DD day. Written out by hand so every browser shows the same words. */
export function formatDayLabel(day: string): string {
  if (!DATE_ONLY_RE.test(day)) return day;
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  if (month < 1 || month > 12) return day;
  return `${dayOfMonth} ${MONTHS_SHORT[month - 1]} ${year}`;
}

export function parseReportRows(value: unknown): BuddyReport[] | null {
  if (!Array.isArray(value)) return null;
  const reports: BuddyReport[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.report_date !== 'string') return null;
    if (!DATE_ONLY_RE.test(row.report_date) || !isTime(row.created_at)) return null;
    reports.push({ id: row.id, reportDate: row.report_date, title: row.title.slice(0, 160), createdAt: row.created_at });
  }
  return reports;
}

export async function listChats(): Promise<BuddyChatSummary[] | null> {
  try {
    const { data, error } = await supabase
      .from('buddy_chats')
      .select('id,title,kind,briefing_date,created_at,updated_at')
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
      .select('id,title,kind,briefing_date,created_at,updated_at')
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
      .select('id,role,kind,content,payload,created_at')
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
async function callThink(body: Record<string, unknown>): Promise<unknown | null> {
  try {
    const { data, error } = await supabase.functions.invoke('buddy-think', { body });
    if (!error) return data;
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) return await context.json().catch(() => null);
    return null;
  } catch {
    return null;
  }
}

export async function askBuddy(chatId: string, message: string): Promise<BuddyThinkReply | null> {
  const data = await callThink({ action: 'ask', chat_id: chatId, message });
  return data === null ? null : parseThinkReply(data);
}

/**
 * Starts today's run through the owner-only run function. Called only after Buddy filed the run and Takeover is on.
 * Returns null when the function could not be reached or answered without a plain detail.
 */
export async function startDayRun(localDay: string): Promise<DayRunAnswer | null> {
  try {
    const { data, error } = await supabase.functions.invoke('minds-run-placement', { body: { local_day: localDay } });
    if (!error) return parseRunAnswer(data);
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) return parseRunAnswer(await context.json().catch(() => null));
    return null;
  } catch {
    return null;
  }
}

/** Opens today's briefing for this device's date. Each open of Continue adds to the same day's thread. */
export async function askBriefing(localDate: string): Promise<BuddyBriefingResult | null> {
  const data = await callThink({ action: 'briefing', local_date: localDate });
  return data === null ? null : parseBriefingResult(data);
}

/** The night reports list. Empty until a night report is written. The night clock writes one each night once its schedule is applied. The morning briefing never reads these. */
export async function listReports(): Promise<BuddyReport[] | null> {
  try {
    const { data, error } = await supabase
      .from('buddy_reports')
      .select('id,title,report_date,created_at')
      .order('report_date', { ascending: false })
      .limit(50);
    if (error) return null;
    return parseReportRows(data);
  } catch {
    return null;
  }
}
