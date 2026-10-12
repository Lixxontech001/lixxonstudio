import { describe, expect, it } from 'vitest';
import { laneFor, HELD_NOT_FROM_CHAT, HELD_MONEY, HELD_PRICE } from '../../supabase/functions/_shared/buddyOrders';
import { isRunDayRequest, routeFilingGate, routeMessage } from '../../supabase/functions/_shared/buddyRouter';

describe('router: asking for today\'s run is an order with no mind to name', () => {
  it.each(['Run the products', 'run today', "Make today's posts", 'make the posts', 'Daily run', 'Please run the products', 'Can you run the products'])(
    '"%s" is a run_day route',
    (message) => {
      expect(routeMessage(message, null)).toEqual({ kind: 'run_day', instruction: message });
    },
  );

  it('it is answered as a run request, with no mind and no question', () => {
    expect(routeMessage('Run the products', null).kind).toBe('run_day');
    expect(routeFilingGate({ kind: 'run_day', instruction: 'Run the products' })).toEqual({ ok: true, kind: 'run_today' });
  });

  it('a question about the run is chat, not an order', () => {
    expect(routeMessage('Can you run the products?', null)).toEqual({ kind: 'chat' });
    expect(routeMessage('Did the run finish today?', null)).toEqual({ kind: 'chat' });
  });

  it('a run request that names a mind goes to that mind', () => {
    expect(routeMessage('Tell the Executioner to run the products', null)).toMatchObject({ kind: 'order', mind: 'executioner' });
  });

  it('"post it to instagram" is not a run request', () => {
    expect(isRunDayRequest('post it to instagram')).toBe(false);
    expect(routeMessage('post it to instagram', null).kind).not.toBe('run_day');
  });

  it('ordinary "do" and "can" messages are still orders, not dropped', () => {
    expect(routeMessage('Do the new article', null)).toEqual({
      kind: 'order',
      mind: 'executioner',
      instruction: 'Do the new article',
      resolvesPending: false,
      routed: true,
    });
    expect(routeMessage('Can you check the article for me?', null)).toEqual({ kind: 'chat' });
    expect(routeMessage('Can you check the article', null)).toEqual({
      kind: 'order',
      mind: 'auditor',
      instruction: 'Can you check the article',
      resolvesPending: false,
      routed: true,
    });
  });

  it('a run request is not a run when it is a make-a-new-article request', () => {
    expect(isRunDayRequest('Make a new article for today')).toBe(false);
    expect(isRunDayRequest('Do the new article for today')).toBe(false);
  });
});

describe('lane: the day\'s run has its own lane', () => {
  it.each(['Run the products', 'run today', "Make today's posts", 'Daily run for 2026-10-10: today\'s products and posts.'])(
    '"%s" is the daily_run lane',
    (instruction) => {
      expect(laneFor(instruction)).toEqual({ lane: 'daily_run' });
    },
  );

  it('a run that names a channel stays held', () => {
    expect(laneFor("Run today's posts and post them to Instagram")).toEqual({ lane: 'held', reason: HELD_NOT_FROM_CHAT });
  });

  it('a run that mentions a price is still the day\'s run', () => {
    // Phase I slice 5: the day's run is where a US dollar price changes, so a run word keeps the run. The Auditor is
    // checked before the price is written, and the owner is told every time.
    expect(laneFor('Run the products at a lower price')).toEqual({ lane: 'daily_run' });
    expect(laneFor('Run the products and change the price of the kit')).toEqual({ lane: 'daily_run' });
  });

  it('a run that names money stays held', () => {
    expect(laneFor('Run the products and spend on ads')).toEqual({ lane: 'held', reason: HELD_MONEY });
    expect(laneFor('Run the products and refund Jane')).toEqual({ lane: 'held', reason: HELD_MONEY });
  });

  it('a price ask with no run words is held with the price rule', () => {
    expect(laneFor('Change the price of the kit to 20 dollars')).toEqual({ lane: 'held', reason: HELD_PRICE });
  });

  it('post it to instagram is still held', () => {
    expect(laneFor('post it to instagram')).toEqual({ lane: 'held', reason: HELD_NOT_FROM_CHAT });
  });

  it('product lines are unchanged', () => {
    expect(laneFor('Add a product to the spring guide')).toEqual({ lane: 'product_line' });
  });
});
