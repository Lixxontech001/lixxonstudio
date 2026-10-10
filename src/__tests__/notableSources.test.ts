// @vitest-environment node
// Notable events from the shop's own records: sales, a day's clicks, a new traffic source, a finished job.
// Pure rules with fake reads and a fake writer. No database, no push, no network.
import { describe, expect, it, vi } from 'vitest';
import {
  cleanSource,
  planClickNotable,
  planJobNotable,
  planSaleNotables,
  planTrafficNotables,
  scanNotableSources,
  type NotablePlan,
  type NotablePorts,
  type ScanWindow,
} from '../../supabase/functions/_shared/notableSources';
import { BUZZ_KINDS, shouldBuzz } from '../../supabase/functions/_shared/notablePush';

const WINDOW: ScanWindow = {
  now: new Date('2026-10-10T12:00:00Z'),
  localDay: '2026-10-10',
  dayStartIso: '2026-10-09T23:00:00.000Z',
  dayEndIso: '2026-10-10T23:00:00.000Z',
};

/** A writer that behaves like the database: the second row with the same key is refused. */
function fakePorts(overrides: Partial<NotablePorts> = {}) {
  const keys = new Set<string>();
  const written: NotablePlan[] = [];
  const record = vi.fn(async (plan: NotablePlan) => {
    if (keys.has(plan.key)) return false;
    keys.add(plan.key);
    written.push(plan);
    return true;
  });
  const logLine = vi.fn(async (plan: NotablePlan) => { void plan; });
  const ports: NotablePorts = {
    readPaidOrders: async () => [],
    readClicks: async () => [],
    readEarlierSources: async () => [],
    record,
    logLine,
    ...overrides,
  };
  return { ports, record, written, logLine };
}

describe('sales: one per paid order, money in USD only', () => {
  it('makes one sale per paid order, with USD shown', () => {
    const plans = planSaleNotables([{ id: 'ord-1', amount: 29, currency: 'USD' }]);
    expect(plans).toEqual([
      {
        key: 'sale:ord-1',
        kind: 'sale',
        mind: 'analyst',
        title: 'Paid order: USD 29.00.',
        detail: 'A paid order came in on the shop. Buddy changed nothing.',
      },
    ]);
  });

  it('shows no amount for a currency other than USD, and no amount when it is missing', () => {
    const [eur] = planSaleNotables([{ id: 'ord-2', amount: 40, currency: 'EUR' }]);
    expect(eur.title).toBe('Paid order.');
    expect(eur.title).not.toMatch(/EUR|€/);
    const [none] = planSaleNotables([{ id: 'ord-3', amount: null, currency: 'USD' }]);
    expect(none.title).toBe('Paid order.');
  });

  it('skips a row with no id, so no key is ever blank', () => {
    expect(planSaleNotables([{ id: '  ', amount: 5, currency: 'USD' }])).toEqual([]);
  });
});

describe('product clicks: one summary per local day', () => {
  it('writes nothing when there were no clicks', () => {
    expect(planClickNotable([], '2026-10-10')).toEqual([]);
  });

  it('counts the day in one row, with the singular and plural spelled out', () => {
    expect(planClickNotable([{ source: 'shop' }], '2026-10-10')[0]).toMatchObject({
      key: 'clicks:2026-10-10',
      kind: 'product_click',
      title: '1 product click today',
    });
    expect(planClickNotable([{ source: 'shop' }, { source: null }], '2026-10-10')[0].title).toBe('2 product clicks today');
  });
});

describe('traffic: a source is announced once, when it first appears', () => {
  it('announces a source that appears today and never before', () => {
    const plans = planTrafficNotables(['newsletter'], ['shop']);
    expect(plans).toEqual([
      {
        key: 'traffic:newsletter',
        kind: 'traffic_new_kind',
        mind: 'analyst',
        title: 'New traffic source: newsletter',
        detail: 'This source sent shop clicks today, and none before today.',
      },
    ]);
  });

  it('does not announce a source seen before, or the same source twice', () => {
    expect(planTrafficNotables(['shop', 'shop'], ['shop'])).toEqual([]);
    expect(planTrafficNotables(['pinterest', 'pinterest'], [])).toHaveLength(1);
  });

  it('cleans control characters and caps the length of the source name', () => {
    expect(cleanSource('bad\u0007 name')).toBe('bad name');
    expect(cleanSource('x'.repeat(200))).toHaveLength(60);
    expect(cleanSource('   ')).toBeNull();
    expect(cleanSource(null)).toBeNull();
  });
});

describe('finished jobs: only a real article change counts', () => {
  it('counts an applied placement job, once per order', () => {
    expect(planJobNotable('applied', 'order-9')).toMatchObject({
      key: 'job:order-9',
      kind: 'job_finished',
      mind: 'strategist',
      title: 'An article change went live',
    });
  });

  it('counts nothing for any other status, or for a missing order', () => {
    for (const status of ['held', 'blocked', 'failed', 'gap', 'cannot_think', 'nothing_to_do', 'done']) {
      expect(planJobNotable(status, 'order-9')).toBeNull();
    }
    expect(planJobNotable('applied', null)).toBeNull();
  });

  it('its copy has no em dash and no country', () => {
    const plan = planJobNotable('applied', 'order-9')!;
    expect(`${plan.title} ${plan.detail}`).not.toMatch(/[\u2014\u2013]/);
    expect(`${plan.title} ${plan.detail}`).not.toMatch(/nigeria|naira|lagos/i);
  });
});

describe('the scan writes each new event once, and buzzes only buzz kinds', () => {
  it('writes the sale, the clicks and the new source, and a second scan writes nothing new', async () => {
    const { ports, record, written } = fakePorts({
      readPaidOrders: async () => [{ id: 'ord-1', amount: 29, currency: 'USD' }],
      readClicks: async () => [{ source: 'newsletter' }, { source: 'shop' }],
      readEarlierSources: async () => ['shop'],
    });
    const first = await scanNotableSources(ports, WINDOW);
    expect(first).toEqual({ written: 3, skipped: 0, unreadable: [] });
    expect(written.map((plan) => plan.kind).sort()).toEqual(['product_click', 'sale', 'traffic_new_kind']);

    const second = await scanNotableSources(ports, WINDOW);
    expect(second).toEqual({ written: 0, skipped: 3, unreadable: [] });
    expect(record).toHaveBeenCalledTimes(6);
  });

  it('every kind it writes is a kind that buzzes', () => {
    for (const kind of ['sale', 'product_click', 'traffic_new_kind', 'job_finished']) {
      expect(BUZZ_KINDS).toContain(kind);
      expect(shouldBuzz(kind)).toBe(true);
    }
  });

  it('a failed read leaves out only its own events, names the read, and writes the rest', async () => {
    const { ports, written } = fakePorts({
      readPaidOrders: async () => null,
      readClicks: async () => [{ source: 'shop' }],
      readEarlierSources: async () => [],
    });
    const result = await scanNotableSources(ports, WINDOW);
    expect(result.unreadable).toEqual(['orders']);
    expect(written.map((plan) => plan.kind)).toEqual(['product_click', 'traffic_new_kind']);
  });

  it('a thrown read or a thrown write never escapes, and is counted as not written', async () => {
    const { ports } = fakePorts({
      readPaidOrders: async () => { throw new Error('network down'); },
      readClicks: async () => [{ source: 'shop' }],
      readEarlierSources: async () => { throw new Error('boom'); },
      record: async () => { throw new Error('write failed'); },
    });
    const result = await scanNotableSources(ports, WINDOW);
    expect(result.unreadable).toEqual(['orders', 'traffic']);
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('with no sales and no clicks, nothing is written and the run is not called a failure', async () => {
    const { ports, record } = fakePorts();
    const result = await scanNotableSources(ports, WINDOW);
    expect(result).toEqual({ written: 0, skipped: 0, unreadable: [] });
    expect(record).not.toHaveBeenCalled();
  });
});

describe('the Analyst writes a daily-log line a person can read later', () => {
  it('a paid order writes one Analyst log line with the title, and a second scan writes no second line', async () => {
    const { ports, logLine } = fakePorts({
      readPaidOrders: async () => [{ id: 'ord-9', amount: 34, currency: 'USD' }],
    });
    await scanNotableSources(ports, WINDOW);
    expect(logLine).toHaveBeenCalledTimes(1);
    expect(logLine.mock.calls[0][0]).toMatchObject({ kind: 'sale', mind: 'analyst', title: 'Paid order: USD 34.00.' });
    await scanNotableSources(ports, WINDOW);
    expect(logLine).toHaveBeenCalledTimes(1);
  });

  it('a day with no sales writes no sale and no log line', async () => {
    const { ports, logLine, written } = fakePorts();
    const result = await scanNotableSources(ports, WINDOW);
    expect(result.written).toBe(0);
    expect(written).toHaveLength(0);
    expect(logLine).not.toHaveBeenCalled();
  });

  it('a log line that fails does not undo the event, which is still counted as written', async () => {
    const { ports, written } = fakePorts({
      readPaidOrders: async () => [{ id: 'ord-10', amount: 12, currency: 'USD' }],
      logLine: async () => {
        throw new Error('log refused');
      },
    });
    const result = await scanNotableSources(ports, WINDOW);
    expect(result).toEqual({ written: 1, skipped: 0, unreadable: [] });
    expect(written.map((plan) => plan.key)).toEqual(['sale:ord-10']);
  });

  it('the plain copy has no em dash and names no country', () => {
    const plans = [
      ...planSaleNotables([{ id: 'ord-1', amount: 9, currency: 'USD' }]),
      ...planClickNotable([{ source: 'shop' }], '2026-10-10'),
      ...planTrafficNotables(['newsletter'], []),
    ];
    for (const plan of plans) {
      expect(`${plan.title} ${plan.detail}`).not.toMatch(/—|nigeria|lagos|naira/i);
    }
  });
});
