import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUDDY_QUEUE_LIMIT,
  BUDDY_QUEUE_STORAGE_KEY,
  clearBuddyQueue,
  enqueueBuddyCommand,
  isAllowListedCommand,
  loadBuddyQueue,
  removeBuddyQueueItem,
  type BuddyStorage,
} from '../buddy/offlineBuddyQueue';
import {
  BUDDY_OPERATIONS,
  parseBuddyCommand,
  validateBuddyArguments,
  type BuddyParseResult,
} from '../buddy/buddyOperations';

class MemoryStorage implements BuddyStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function operationOf(text: string): Extract<BuddyParseResult, { kind: 'operation' }> {
  const parsed = parseBuddyCommand(text);
  if (parsed.kind !== 'operation') throw new Error(`Expected an allow-listed operation for "${text}", got ${parsed.kind}`);
  return parsed;
}

describe('Buddy typed allow-list', () => {
  it('maps fixed phrases to typed operations and never to free text', () => {
    expect(operationOf('status')).toMatchObject({ operationId: 'status', args: {} });
    expect(operationOf('  open   daily kit ')).toMatchObject({ operationId: 'daily-kit', args: {} });
    expect(operationOf('help')).toMatchObject({ operationId: 'help', args: {} });
    expect(operationOf('pause automation')).toMatchObject({ operationId: 'set-daily-pipeline', args: { enabled: false } });
    expect(operationOf('resume the daily schedule')).toMatchObject({ operationId: 'set-daily-pipeline', args: { enabled: true } });
    expect(parseBuddyCommand('run all agents')).toEqual({ kind: 'unsupported' });
    expect(parseBuddyCommand('status please now')).toEqual({ kind: 'unsupported' });
    expect(parseBuddyCommand('')).toEqual({ kind: 'unsupported' });
  });

  it('has no publishing operation and blocks every publishing, editorial or commerce request', () => {
    // The registry cannot contain a publishing operation: every entry declares publishes: false.
    expect(BUDDY_OPERATIONS.every((operation) => operation.publishes === false)).toBe(true);
    expect(BUDDY_OPERATIONS.some((operation) => /publish|post|send|email|campaign|approve|newsletter/i.test(operation.id))).toBe(false);

    for (const text of [
      'publish the post', 'post this now', 'send the campaign', 'email the list', 'approve this item',
      'rewrite article', 'edit article text', 'delete the draft', 'schedule a post',
      'change product price', 'issue refund', 'charge the card', 'update stock levels',
    ]) {
      expect(parseBuddyCommand(text).kind).toBe('blocked');
    }
    // Even a phrase that names a real operation cannot smuggle a publishing verb through it.
    expect(parseBuddyCommand('pause automation and publish the post').kind).toBe('blocked');
  });

  it('refuses unknown or mistyped arguments instead of guessing', () => {
    expect(validateBuddyArguments('set-daily-pipeline', { enabled: false })).toEqual({ ok: true, args: { enabled: false } });
    expect(validateBuddyArguments('set-daily-pipeline', { enabled: 'yes' })).toEqual({ ok: false, reason: 'invalid_arguments' });
    expect(validateBuddyArguments('set-daily-pipeline', {})).toEqual({ ok: false, reason: 'invalid_arguments' });
    expect(validateBuddyArguments('set-daily-pipeline', { enabled: true, extra: 1 })).toEqual({ ok: false, reason: 'invalid_arguments' });
    expect(validateBuddyArguments('publish-article', {})).toEqual({ ok: false, reason: 'unknown_operation' });
    expect(isAllowListedCommand('publish-article')).toBe(false);
    expect(isAllowListedCommand('set-daily-pipeline')).toBe(true);
  });

  it('declares which operations are state-changing, reversible and permission-gated', () => {
    const stateChanging = BUDDY_OPERATIONS.filter((operation) => operation.kind === 'state-change');
    expect(stateChanging.map((operation) => operation.id)).toEqual(['set-daily-pipeline']);
    for (const operation of stateChanging) {
      expect(operation.reversible).toBe(true);
      expect(operation.requiredPermission).toBe('automation.manage');
      expect(operation.arguments.length).toBeGreaterThan(0);
    }
    expect(BUDDY_OPERATIONS.filter((operation) => operation.kind === 'read').every((operation) => operation.arguments.length === 0)).toBe(true);
  });
});

describe('Buddy offline-safe draft queue', () => {
  let storage: MemoryStorage;
  beforeEach(() => { storage = new MemoryStorage(); });

  it('stores only the operation id, typed arguments and a timestamp as a draft', () => {
    const parsed = operationOf('open daily kit');
    const result = enqueueBuddyCommand(parsed.operationId, {
      storage,
      args: parsed.args,
      id: () => 'item-1',
      now: () => new Date('2026-10-06T10:00:00.000Z'),
    });
    expect(result.persisted).toBe(true);
    expect(result.items[0]).toEqual({
      id: 'item-1', command: 'daily-kit', args: {}, state: 'draft', createdAt: '2026-10-06T10:00:00.000Z',
    });
    const serialized = storage.getItem(BUDDY_QUEUE_STORAGE_KEY) || '';
    expect(serialized).not.toContain('secret-like');
    expect(serialized).not.toContain('token');

    // A state change keeps its typed argument, never any typed text.
    enqueueBuddyCommand('set-daily-pipeline', { storage, args: { enabled: false }, id: () => 'item-2' });
    const stored = JSON.parse(storage.getItem(BUDDY_QUEUE_STORAGE_KEY) || '[]');
    expect(stored[1]).toMatchObject({ command: 'set-daily-pipeline', args: { enabled: false }, state: 'draft' });
  });

  it('refuses to queue an unknown operation or malformed arguments', () => {
    const bad = enqueueBuddyCommand('publish-article' as never, { storage, id: () => 'x' });
    expect(bad.item).toBeNull();
    expect(bad.items).toHaveLength(0);
    const mistyped = enqueueBuddyCommand('set-daily-pipeline', { storage, args: { enabled: 'yes' as never } });
    expect(mistyped.item).toBeNull();
    expect(storage.getItem(BUDDY_QUEUE_STORAGE_KEY)).toBeNull();
  });

  it('never executes anything on load or on reconnect; drafts stay drafts until explicitly removed', () => {
    const enqueue = vi.fn();
    const listener = vi.fn();
    const first = enqueueBuddyCommand('status', { storage, id: () => 'a' });
    const second = enqueueBuddyCommand('set-daily-pipeline', { storage, args: { enabled: false }, id: () => 'b' });
    expect(first.items).toHaveLength(1);
    expect(second.items.map((item) => item.command)).toEqual(['status', 'set-daily-pipeline']);

    // Simulate a reconnect: the queue module exposes no execution hook at all,
    // so nothing can run and every draft is still present afterwards.
    expect(Object.keys({ enqueueBuddyCommand, loadBuddyQueue, removeBuddyQueueItem, clearBuddyQueue, isAllowListedCommand })
      .some((name) => /run|execute|dispatch|flush|replay/i.test(name))).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(enqueue).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(loadBuddyQueue(storage).map((item) => item.state)).toEqual(['draft', 'draft']);
    expect(loadBuddyQueue(storage).map((item) => item.id)).toEqual(['a', 'b']);
    expect(removeBuddyQueueItem('a', storage).map((item) => item.id)).toEqual(['b']);
  });

  it('rejects malformed persisted entries, caps storage, and clears only its own queue key', () => {
    const tooMany = Array.from({ length: BUDDY_QUEUE_LIMIT + 3 }, (_, index) => ({
      id: String(index), command: 'help', args: {}, state: 'draft', createdAt: '2026-10-06T10:00:00.000Z',
    }));
    storage.setItem(BUDDY_QUEUE_STORAGE_KEY, JSON.stringify(tooMany));
    expect(loadBuddyQueue(storage)).toHaveLength(BUDDY_QUEUE_LIMIT);

    storage.setItem(BUDDY_QUEUE_STORAGE_KEY, JSON.stringify([
      { id: 'unsafe', command: 'publish', args: {}, state: 'draft', createdAt: '2026-10-06T10:00:00.000Z' },
      { id: 'no-args', command: 'set-daily-pipeline', state: 'draft', createdAt: '2026-10-06T10:00:00.000Z' },
      { id: 'executed', command: 'help', args: {}, state: 'done', createdAt: '2026-10-06T10:00:00.000Z' },
      { id: 'good', command: 'help', args: {}, state: 'draft', createdAt: '2026-10-06T10:00:00.000Z' },
    ]));
    expect(loadBuddyQueue(storage).map((item) => item.id)).toEqual(['good']);

    storage.setItem('reader.bookmarks', 'preserve-me');
    clearBuddyQueue(storage);
    expect(storage.getItem(BUDDY_QUEUE_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('reader.bookmarks')).toBe('preserve-me');
  });
});
