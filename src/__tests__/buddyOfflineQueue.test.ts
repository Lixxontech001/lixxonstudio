import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUDDY_QUEUE_LIMIT,
  BUDDY_QUEUE_STORAGE_KEY,
  clearBuddyQueue,
  enqueueBuddyCommand,
  loadBuddyQueue,
  parseBuddyCommand,
  removeBuddyQueueItem,
  type BuddyStorage,
} from '../buddy/offlineBuddyQueue';

class MemoryStorage implements BuddyStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('Buddy offline-safe command queue', () => {
  let storage: MemoryStorage;
  beforeEach(() => { storage = new MemoryStorage(); });

  it('allows only explicit read-only/local commands', () => {
    expect(parseBuddyCommand('status')).toEqual({ kind: 'safe', command: 'status' });
    expect(parseBuddyCommand('  open   daily kit ')).toEqual({ kind: 'safe', command: 'daily-kit' });
    expect(parseBuddyCommand('help')).toEqual({ kind: 'safe', command: 'help' });
    expect(parseBuddyCommand('run all agents')).toEqual({ kind: 'unsupported' });
  });

  it('blocks external, editorial, product, price, payment and refund requests without queuing them', () => {
    for (const text of ['publish the post', 'send the campaign', 'approve this', 'rewrite article', 'change product price', 'issue refund', 'charge the card']) {
      expect(parseBuddyCommand(text).kind).toBe('blocked');
    }
    const serialized = storage.getItem(BUDDY_QUEUE_STORAGE_KEY);
    expect(serialized).toBeNull();
  });

  it('persists only an allow-listed command enum and never stores raw user text or auth material', () => {
    const input = 'open daily kit -- bearer secret-like text';
    const parsed = parseBuddyCommand('open daily kit');
    expect(parsed.kind).toBe('safe');
    if (parsed.kind !== 'safe') return;
    const result = enqueueBuddyCommand(parsed.command, {
      storage,
      id: () => 'item-1',
      now: () => new Date('2026-10-06T10:00:00.000Z'),
    });
    expect(result.persisted).toBe(true);
    expect(result.items[0]).toEqual({ id: 'item-1', command: 'daily-kit', createdAt: '2026-10-06T10:00:00.000Z' });
    expect(storage.getItem(BUDDY_QUEUE_STORAGE_KEY)).not.toContain(input);
    expect(storage.getItem(BUDDY_QUEUE_STORAGE_KEY)).not.toContain('secret-like');
    expect(storage.getItem(BUDDY_QUEUE_STORAGE_KEY)).not.toContain('token');
  });

  it('does not auto-execute when loading/reconnecting; queued items require explicit removal/review', () => {
    const first = enqueueBuddyCommand('status', { storage, id: () => 'a' });
    const second = enqueueBuddyCommand('daily-kit', { storage, id: () => 'b' });
    expect(first.items).toHaveLength(1);
    expect(second.items.map((item) => item.command)).toEqual(['status', 'daily-kit']);
    expect(loadBuddyQueue(storage).map((item) => item.id)).toEqual(['a', 'b']);
    expect(removeBuddyQueueItem('a', storage).map((item) => item.id)).toEqual(['b']);
  });

  it('rejects malformed persisted entries, caps storage, and clears only its own queue key', () => {
    const tooMany = Array.from({ length: BUDDY_QUEUE_LIMIT + 3 }, (_, index) => ({
      id: String(index), command: 'help', createdAt: '2026-10-06T10:00:00.000Z',
    }));
    tooMany.push({ id: 'unsafe', command: 'publish', createdAt: '2026-10-06T10:00:00.000Z' } as never);
    storage.setItem(BUDDY_QUEUE_STORAGE_KEY, JSON.stringify(tooMany));
    expect(loadBuddyQueue(storage)).toHaveLength(BUDDY_QUEUE_LIMIT);
    storage.setItem('reader.bookmarks', 'preserve-me');
    clearBuddyQueue(storage);
    expect(storage.getItem(BUDDY_QUEUE_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('reader.bookmarks')).toBe('preserve-me');
  });
});
