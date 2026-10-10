import { describe, expect, it } from 'vitest';
import {
  HELD_CREATE,
  HELD_NOT_FROM_CHAT,
  HELD_MONEY,
  HELD_UNKNOWN,
  laneFor,
  parseWaitingRow,
  readWaitingOrders,
} from '../../supabase/functions/_shared/buddyOrders';

describe('which orders a mind can run in this phase', () => {
  it.each([
    'Put the spring kit on the summer guide',
    'Add a product to the spring guide',
    'Swap the kit on the guide for the new bundle',
    'Give the sleep article a shop product that fits',
  ])('"%s" is a product line', (instruction) => {
    expect(laneFor(instruction)).toEqual({ lane: 'product_line' });
  });

  it('channels, video and email are held, not run from chat', () => {
    expect(laneFor('Post the spring guide to Instagram')).toEqual({ lane: 'held', reason: HELD_NOT_FROM_CHAT });
    expect(laneFor('Make a video about the kit')).toEqual({ lane: 'held', reason: HELD_NOT_FROM_CHAT });
    expect(laneFor('Email the list to readers')).toEqual({ lane: 'held', reason: HELD_NOT_FROM_CHAT });
  });

  it('prices, spending and refunds never run by a mind', () => {
    expect(laneFor('Lower the kit price to 9 dollars')).toEqual({ lane: 'held', reason: HELD_MONEY });
    expect(laneFor('Refund the buyer')).toEqual({ lane: 'held', reason: HELD_MONEY });
  });

  it('creating a product is the owner’s job, so it waits with a plain reason', () => {
    expect(laneFor('Make a new product for the sleep kit')).toEqual({ lane: 'held', reason: HELD_CREATE });
  });

  it('a clear money or channel word is held even inside a product sentence', () => {
    expect(laneFor('Post the sale price for the kit to Instagram')).toEqual({ lane: 'held', reason: HELD_MONEY });
  });

  it('anything Buddy does not know how to run waits, with an honest reason', () => {
    expect(laneFor('Do something useful this week')).toEqual({ lane: 'held', reason: HELD_UNKNOWN });
  });
});

describe('reading the waiting orders', () => {
  const row = (id: string, created: string, instruction = 'Put the kit on the guide', mind: unknown = 'executioner') => ({
    id,
    instruction,
    mind,
    status: 'waiting',
    created_at: created,
  });

  it('a failed read is reported as not ok, never as an empty list', async () => {
    expect(await readWaitingOrders(async () => null)).toEqual({ ok: false });
  });

  it('an empty read is ok with no orders', async () => {
    expect(await readWaitingOrders(async () => [])).toEqual({ ok: true, orders: [] });
  });

  it('returns oldest first, each with its lane', async () => {
    const result = await readWaitingOrders(async () => [
      row('b', '2026-10-09T10:00:00Z', 'Post the guide to Instagram'),
      row('a', '2026-10-08T09:00:00Z', 'Put the kit on the guide'),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orders.map((order) => order.id)).toEqual(['a', 'b']);
    expect(result.orders[0].lane).toEqual({ lane: 'product_line' });
    expect(result.orders[1].lane).toEqual({ lane: 'held', reason: HELD_NOT_FROM_CHAT });
  });

  it('drops a malformed row rather than guessing at it', async () => {
    const result = await readWaitingOrders(async () => [
      row('ok', '2026-10-09T10:00:00Z'),
      { id: 'no-text', created_at: '2026-10-09T10:00:00Z' },
      { ...row('blank', '2026-10-09T10:00:00Z'), instruction: '   ' },
      'not a row',
    ]);
    expect(result.ok && result.orders.map((order) => order.id)).toEqual(['ok']);
  });

  it('an unknown mind is read as no mind, not as a made-up one', () => {
    expect(parseWaitingRow(row('x', '2026-10-09T10:00:00Z', 'Put the kit on the guide', 'bossman'))?.mind).toBeNull();
    expect(parseWaitingRow(row('x', '2026-10-09T10:00:00Z', 'Put the kit on the guide', 'ceo'))?.mind).toBe('ceo');
  });
});
