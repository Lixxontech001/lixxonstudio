export const BUDDY_QUEUE_STORAGE_KEY = 'lixxon.buddy.safe-queue.v1';
export const BUDDY_QUEUE_LIMIT = 20;

export type SafeBuddyCommand = 'status' | 'daily-kit' | 'help';

export interface BuddyQueueItem {
  id: string;
  command: SafeBuddyCommand;
  createdAt: string;
}

export type BuddyCommandParseResult =
  | { kind: 'safe'; command: SafeBuddyCommand }
  | { kind: 'blocked'; category: 'external' | 'commerce' }
  | { kind: 'unsupported' };

export interface BuddyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const storageOrNull = (): BuddyStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Only fixed, non-privileged commands are queueable; free-form text is never persisted. */
export function parseBuddyCommand(input: string): BuddyCommandParseResult {
  const command = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/\b(price|pricing|product|refund|charge|payment|order)\b/.test(command)) {
    return { kind: 'blocked', category: 'commerce' };
  }
  if (/\b(publish|post|send|email|campaign|approve|schedule|delete|rewrite|edit article)\b/.test(command)) {
    return { kind: 'blocked', category: 'external' };
  }
  if (command === 'status' || command === 'check status') return { kind: 'safe', command: 'status' };
  if (command === 'daily kit' || command === 'open daily kit') return { kind: 'safe', command: 'daily-kit' };
  if (command === 'help' || command === '?') return { kind: 'safe', command: 'help' };
  return { kind: 'unsupported' };
}

function validCommand(value: unknown): value is SafeBuddyCommand {
  return value === 'status' || value === 'daily-kit' || value === 'help';
}

function validItem(value: unknown): value is BuddyQueueItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 80
    && validCommand(item.command)
    && typeof item.createdAt === 'string'
    && Number.isFinite(Date.parse(item.createdAt));
}

export function loadBuddyQueue(storage: BuddyStorage | null = storageOrNull()): BuddyQueueItem[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(BUDDY_QUEUE_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validItem).slice(-BUDDY_QUEUE_LIMIT);
  } catch {
    return [];
  }
}

function createId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* use a local non-secret identifier fallback */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueueBuddyCommand(
  command: SafeBuddyCommand,
  options: { storage?: BuddyStorage | null; now?: () => Date; id?: () => string } = {},
): { items: BuddyQueueItem[]; item: BuddyQueueItem; persisted: boolean } {
  const storage = options.storage === undefined ? storageOrNull() : options.storage;
  const item: BuddyQueueItem = {
    id: (options.id || createId)(),
    command,
    createdAt: (options.now || (() => new Date()))().toISOString(),
  };
  const items = [...loadBuddyQueue(storage), item].slice(-BUDDY_QUEUE_LIMIT);
  let persisted = false;
  if (storage) {
    try {
      // This allow-listed DTO contains no command text, credentials, session, or action payload.
      storage.setItem(BUDDY_QUEUE_STORAGE_KEY, JSON.stringify(items));
      persisted = true;
    } catch { /* the visible queue still works in memory for this tab */ }
  }
  return { items, item, persisted };
}

export function removeBuddyQueueItem(id: string, storage: BuddyStorage | null = storageOrNull()): BuddyQueueItem[] {
  const items = loadBuddyQueue(storage).filter((item) => item.id !== id);
  if (storage) {
    try { storage.setItem(BUDDY_QUEUE_STORAGE_KEY, JSON.stringify(items)); } catch { /* keep the UI usable */ }
  }
  return items;
}

/** Clear only Buddy's allow-listed queue; never clears reader/site data or service-worker caches. */
export function clearBuddyQueue(storage: BuddyStorage | null = storageOrNull()): void {
  try { storage?.removeItem(BUDDY_QUEUE_STORAGE_KEY); } catch { /* storage can be unavailable */ }
}
