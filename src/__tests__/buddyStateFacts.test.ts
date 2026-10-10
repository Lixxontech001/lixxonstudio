import { describe, expect, it } from 'vitest';
import { stateFactsBlock, type BuddyStateFacts } from '../../supabase/functions/_shared/buddyStateFacts';

function state(overrides: Partial<BuddyStateFacts> = {}): BuddyStateFacts {
  return {
    takeover: false,
    killScope: 'none',
    orders: { ok: true, total: 0, items: [] },
    log: { ok: true, rows: [] },
    notable: { ok: true, rows: [] },
    doors: { ok: true, rows: [] },
    ...overrides,
  };
}

describe('Buddy state facts: Takeover and the kill switch', () => {
  it('says Takeover is off, and that orders wait', () => {
    const block = stateFactsBlock(state({ takeover: false }));
    expect(block).toContain('Takeover: off. No mind runs, and orders wait for the owner.');
  });

  it('says Takeover is on, and only when the read says so', () => {
    expect(stateFactsBlock(state({ takeover: true }))).toContain('Takeover: on. The minds may run their daily work.');
  });

  it('says plainly when Takeover could not be read, and does not guess it', () => {
    const block = stateFactsBlock(state({ takeover: null }));
    expect(block).toContain('Takeover: could not be read just now. Do not say whether it is on or off.');
    expect(block).not.toMatch(/Takeover: (on|off)\./);
  });

  it('names the kill switch: nothing stopped, all stopped, or one mind stopped', () => {
    expect(stateFactsBlock(state({ killScope: 'none' }))).toContain('Kill switch: none. Nothing is stopped.');
    expect(stateFactsBlock(state({ killScope: 'all' }))).toContain('Kill switch: all minds are stopped.');
    expect(stateFactsBlock(state({ killScope: 'analyst' }))).toContain('Kill switch: the Analyst is stopped.');
  });

  it('says the kill switch could not be read when it is unknown, and never guesses', () => {
    expect(stateFactsBlock(state({ killScope: null }))).toContain('Kill switch: could not be read just now.');
  });
});

describe('Buddy state facts: orders waiting', () => {
  it('says none when there are none', () => {
    expect(stateFactsBlock(state())).toContain('Orders waiting: none.');
  });

  it('lists the waiting orders with the mind each one is for, and says how many more there are', () => {
    const block = stateFactsBlock(state({
      orders: {
        ok: true,
        total: 7,
        items: [
          { instruction: 'Check the article', mind: 'analyst' },
          { instruction: 'Plan the kit', mind: null },
        ],
      },
    }));
    expect(block).toContain('Orders waiting: 7. Oldest first:');
    expect(block).toContain('- "Check the article" (for the Analyst)');
    expect(block).toContain('- "Plan the kit" (no mind chosen yet)');
    expect(block).toContain('(and 5 more not listed here)');
  });

  it('says the waiting orders could not be read, and does not give a count', () => {
    const block = stateFactsBlock(state({ orders: { ok: false, total: 0, items: [] } }));
    expect(block).toContain('Orders waiting: could not be read just now. Do not say how many are waiting.');
  });
});

describe('Buddy state facts: recent mind steps and notable events', () => {
  it('lists the newest mind steps on the owner clock, and never a country', () => {
    const block = stateFactsBlock(state({
      log: {
        ok: true,
        rows: [
          {
            happened_at: '2026-10-09T10:00:00Z',
            day: '2026-10-09',
            mind: 'analyst',
            action: 'checked the article',
            outcome: 'done',
            detail: 'Two sentences checked.',
          },
        ],
      },
    }));
    expect(block).toContain('Newest mind steps (up to 8), newest first:');
    expect(block).toMatch(/- 2026-10-09 \d{2}:\d{2}: analyst, checked the article\. done\. Two sentences checked\./);
    expect(block).not.toMatch(/nigeria|lagos|naira|\bWAT\b/i);
  });

  it('says the mind log could not be read, and does not describe any step', () => {
    const block = stateFactsBlock(state({ log: { ok: false, rows: [] } }));
    expect(block).toContain('Mind steps: could not be read just now. Do not describe what the minds did.');
  });

  it('says so plainly when nothing has been logged, and when there are no notable events', () => {
    const block = stateFactsBlock(state());
    expect(block).toContain('Mind steps: none logged yet.');
    expect(block).toContain('Notable events: none.');
  });

  it('lists notable events with their time, and says when they cannot be read', () => {
    const block = stateFactsBlock(state({
      notable: { ok: true, rows: [{ happenedAt: '2026-10-09T10:00:00Z', title: 'Takeover turned on' }] },
    }));
    expect(block).toMatch(/- \d{2}:\d{2}: Takeover turned on/);
    expect(stateFactsBlock(state({ notable: { ok: false, rows: [] } }))).toContain('Notable events: could not be read just now.');
  });
});

describe('Buddy state facts: the block is plain text and never names a secret', () => {
  it('starts with a heading that says it is read only, and keeps each fact on its own line', () => {
    const block = stateFactsBlock(state());
    expect(block.split('\n')[0]).toBe('THE OPERATIONS RIGHT NOW (read only, from the live database; use only this):');
    expect(block).not.toContain('—');
  });
});

describe('Buddy state facts: door sends', () => {
  it('lists the newest door sends with their status, and says so when there are none', () => {
    const block = stateFactsBlock(state({
      doors: { ok: true, rows: [{ happenedAt: '2026-10-09T10:00:00Z', door: 'telegram', status: 'sent' }] },
    }));
    expect(block).toContain('Newest door sends (up to 8), newest first:');
    expect(block).toMatch(/- \d{2}:\d{2}: telegram, sent\./);
    expect(stateFactsBlock(state())).toContain('Door sends: none logged yet.');
  });

  it('says plainly when door sends cannot be read', () => {
    expect(stateFactsBlock(state({ doors: { ok: false, rows: [] } }))).toContain('Door sends: could not be read just now.');
  });
});
