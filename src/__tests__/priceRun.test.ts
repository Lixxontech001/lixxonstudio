import { describe, expect, it, vi } from 'vitest';
import { PRICE_LEFT_ALONE, type PriceProduct } from '../../supabase/functions/_shared/priceChanges';
import { NO_KEY_DETAIL, runPriceChange, type PriceRunLogEntry, type PriceRunPorts } from '../../supabase/functions/_shared/priceRun';
import { KILL_BLOCK_DETAIL, TAKEOVER_OFF_DETAIL } from '../../supabase/functions/_shared/runDay';
import type { MindThinkResult } from '../../supabase/functions/_shared/mindThink';

// The day's own price step: one US dollar change at most, the Auditor's check before anything is written, and a
// telling every time. Fake ports only: no model, no database, no shop.

const SHEET: PriceProduct = { id: 'p1', name: 'Linen Bath Sheet', priceUsd: 34, currency: 'USD' };
const DAY_INPUT = { localDay: '2026-10-10', takeover: true, killScope: 'none' as const };

function thinkWith(text: string) {
  return vi.fn(async (): Promise<MindThinkResult> => ({ ok: true, text }));
}

function runPorts(overrides: Partial<PriceRunPorts> = {}): PriceRunPorts {
  return {
    readShop: async () => [SHEET],
    readFacts: async () => 'This week: 2 paid orders, 40 views.',
    think: thinkWith(JSON.stringify({ product_id: 'p1', price: 29.5, why: 'It sells well and the price is high.' })),
    apply: async () => ({ ok: true, fromUsd: 34, newUsd: 29.5 }),
    log: async () => {},
    ...overrides,
  };
}

describe('the day run changes one price, with the Auditor first', () => {
  it('Takeover off, or a Kill switch: nothing is read, nothing is applied, nothing is logged', async () => {
    const readShop = vi.fn(async () => [SHEET]);
    const apply = vi.fn(async () => ({ ok: true as const, fromUsd: 34, newUsd: 29.5 }));
    const log = vi.fn(async () => {});
    const first = await runPriceChange({ ...DAY_INPUT, takeover: false }, runPorts({ readShop, apply, log }));
    const second = await runPriceChange({ ...DAY_INPUT, killScope: 'auditor' }, runPorts({ readShop, apply, log }));
    expect(first).toEqual({ status: 'held', detail: TAKEOVER_OFF_DETAIL, act: null });
    expect(second).toEqual({ status: 'held', detail: KILL_BLOCK_DETAIL, act: null });
    expect(readShop).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('a shop with no US dollar product is said plainly and logged, and no brain is asked', async () => {
    const log = vi.fn(async () => {});
    const think = vi.fn(async (): Promise<MindThinkResult> => ({ ok: true, text: '{}' }));
    const result = await runPriceChange(DAY_INPUT, runPorts({ readShop: async () => [], log, think }));
    expect(result).toMatchObject({ status: 'nothing_to_do', act: null });
    expect(result.detail).toContain('no live product priced in US dollars');
    expect(think).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0]![0] as unknown as PriceRunLogEntry;
    expect(entry).toMatchObject({ outcome: 'skipped' });
  });

  it('an allowed change is applied once, and the words are the dollars the shop recorded', async () => {
    const apply = vi.fn(async () => ({ ok: true as const, fromUsd: 34, newUsd: 29.5 }));
    const log = vi.fn(async () => {});
    const result = await runPriceChange(DAY_INPUT, runPorts({ apply, log }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.act.kind).toBe('price_changed');
    expect(result.act.title).toBe('Price changed: "Linen Bath Sheet" is now $29.50');
    expect(result.act.detail).toContain('It was $34.00 and it is now $29.50.');
    expect(result.act.key).toBe('price_changed:Linen Bath Sheet:2026-10-10');
    // The act carries the telling: the step writes no second log row of its own.
    expect(log).not.toHaveBeenCalled();
  });

  it('a change the Auditor blocks twice is stopped, told as a block, and never applied', async () => {
    const apply = vi.fn(async () => ({ ok: true as const, fromUsd: 34, newUsd: 29.5 }));
    const log = vi.fn(async () => {});
    const think = vi.fn(async (): Promise<MindThinkResult> => ({ ok: true, text: JSON.stringify({ product_id: 'p1', price: 0, why: '' }) }));
    const result = await runPriceChange(DAY_INPUT, runPorts({ think, apply, log }));
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.act.kind).toBe('auditor_blocked');
    expect(result.act.detail).toContain('The Auditor blocked the price twice, so the change was stopped.');
    expect(apply).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('one allowed fix that passes is applied, and the telling names the new price', async () => {
    const replies = [
      JSON.stringify({ product_id: 'p1', price: 5, why: 'Drop it hard.' }),
      JSON.stringify({ product_id: 'p1', price: 29.5, why: 'Lower it in one small step.' }),
    ];
    let call = 0;
    const think = vi.fn(async (): Promise<MindThinkResult> => ({ ok: true, text: replies[Math.min(call++, replies.length - 1)]! }));
    const result = await runPriceChange(DAY_INPUT, runPorts({ think }));
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.act.title).toContain('$29.50');
  });

  it('a shop that refuses the change is a plain failure with its own reason, and nothing is claimed', async () => {
    const log = vi.fn(async () => {});
    const result = await runPriceChange(DAY_INPUT, runPorts({ apply: async () => ({ ok: false, reason: "This product's price already changed today. One change a day, so nothing else was written." }), log }));
    expect(result).toMatchObject({ status: 'failed', act: null });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('no brain key is a skipped line in the log, never a change', async () => {
    const log = vi.fn(async () => {});
    const result = await runPriceChange(DAY_INPUT, runPorts({ think: async (): Promise<MindThinkResult> => ({ ok: false, reason: 'no_key' }), log }));
    expect(result).toMatchObject({ status: 'cannot_think', detail: NO_KEY_DETAIL, act: null });
    expect(log).toHaveBeenCalledTimes(1);
    expect((log.mock.calls[0]![0] as unknown as PriceRunLogEntry).detail).toBe(NO_KEY_DETAIL);
  });

  it('a day with no change is one honest log line, and no buzz', async () => {
    const log = vi.fn(async () => {});
    const result = await runPriceChange(DAY_INPUT, runPorts({ think: thinkWith('{"product_id":"","price":0,"why":""}'), log }));
    expect(result).toMatchObject({ status: 'nothing_to_do', detail: PRICE_LEFT_ALONE, act: null });
    expect(log).toHaveBeenCalledTimes(1);
  });
});
