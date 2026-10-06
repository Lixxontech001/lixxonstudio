/**
 * Buddy's offline-safe draft queue.
 *
 * A queued entry is a *draft*: a fixed operation id plus typed arguments. It is
 * never executed by this module — not on load, not on reconnect, not on any
 * timer. Executing a draft requires a fresh online preview and an explicit
 * confirmation in the UI (see buddyOperations.ts).
 *
 * Storage contains no typed text, no token, no article or customer data.
 */
import {
  BUDDY_OPERATIONS,
  getBuddyOperation,
  validateBuddyArguments,
  type BuddyArguments,
  type BuddyOperationId,
} from './buddyOperations';

export const BUDDY_QUEUE_STORAGE_KEY = 'lixxon.buddy.safe-queue.v1';
export const BUDDY_QUEUE_LIMIT = 20;

export type SafeBuddyCommand = BuddyOperationId;

export type BuddyQueueState = 'draft';

export interface BuddyQueueItem {
  id: string;
  command: SafeBuddyCommand;
  args: BuddyArguments;
  state: BuddyQueueState;
  createdAt: string;
}

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

/** Only operations in the typed registry can be queued. Publishing is not one of them. */
export function isAllowListedCommand(value: unknown): value is SafeBuddyCommand {
  return typeof value === 'string' && BUDDY_OPERATIONS.some((operation) => operation.id === value);
}

function validItem(value: unknown): value is BuddyQueueItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 80) return false;
  if (!isAllowListedCommand(item.command)) return false;
  if (item.state !== 'draft') return false;
  if (typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) return false;
  const operation = getBuddyOperation(item.command);
  if (!operation) return false;
  return validateBuddyArguments(operation.id, item.args).ok;
}

/** Loads drafts only. It performs no I/O other than reading storage and runs nothing. */
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
  } catch { /* fall back to a local, non-secret identifier */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueueBuddyCommand(
  command: SafeBuddyCommand,
  options: { storage?: BuddyStorage | null; now?: () => Date; id?: () => string; args?: BuddyArguments } = {},
): { items: BuddyQueueItem[]; item: BuddyQueueItem | null; persisted: boolean } {
  const storage = options.storage === undefined ? storageOrNull() : options.storage;
  const validation = validateBuddyArguments(command, options.args ?? {});
  if (!validation.ok) {
    // An unknown or mistyped operation is never stored, not even as a draft.
    return { items: loadBuddyQueue(storage), item: null, persisted: false };
  }
  const item: BuddyQueueItem = {
    id: (options.id || createId)(),
    command,
    args: validation.args,
    state: 'draft',
    createdAt: (options.now || (() => new Date()))().toISOString(),
  };
  const items = [...loadBuddyQueue(storage), item].slice(-BUDDY_QUEUE_LIMIT);
  let persisted = false;
  if (storage) {
    try {
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

/** Clear only Buddy's allow-listed draft queue; never touches reader/site data or caches. */
export function clearBuddyQueue(storage: BuddyStorage | null = storageOrNull()): void {
  try { storage?.removeItem(BUDDY_QUEUE_STORAGE_KEY); } catch { /* storage can be unavailable */ }
}
