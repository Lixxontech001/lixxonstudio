import { describe, expect, it } from 'vitest';
import {
  ASK_WHICH_MIND_LINE,
  answerFromLog,
  isRestricted,
  namedMind,
  routeMessage,
  type MindLogLine,
} from '../../supabase/functions/_shared/buddyRouter';

const PENDING = { instruction: 'Check the new article' };

function row(overrides: Partial<MindLogLine> = {}): MindLogLine {
  return {
    happened_at: '2026-10-09T08:05:00.000Z',
    day: '2026-10-09',
    mind: 'analyst',
    action: 'Read the site numbers',
    outcome: 'done',
    detail: '',
    ...overrides,
  };
}

describe('routing: questions about a mind are answered from the log', () => {
  it.each([
    'What did the Analyst do?',
    'what has the ceo done today',
    'Which mind is the Auditor doing right now?',
    'How is the Strategist doing?',
  ])('"%s" is a log question', (message) => {
    expect(routeMessage(message, null).kind).toBe('mind_log');
  });

  it('names the right mind, including the CEO in capitals', () => {
    expect(routeMessage('What did the Analyst do?', null)).toEqual({ kind: 'mind_log', mind: 'analyst' });
    expect(routeMessage('what has the CEO done today?', null)).toEqual({ kind: 'mind_log', mind: 'ceo' });
  });
});

describe('routing: orders', () => {
  it('an order that names a mind is filed for that mind', () => {
    expect(routeMessage('Tell the Analyst to check the spring guide', null)).toEqual({
      kind: 'order',
      mind: 'analyst',
      instruction: 'Tell the Analyst to check the spring guide',
      resolvesPending: false,
    });
  });

  it('an order with no mind asks which mind, once', () => {
    expect(routeMessage('Check the new article', null)).toEqual({
      kind: 'ask_which_mind',
      instruction: 'Check the new article',
    });
  });

  it('a short reply naming a mind completes the order that was waiting', () => {
    expect(routeMessage('the analyst', PENDING)).toEqual({
      kind: 'order',
      mind: 'analyst',
      instruction: 'Check the new article',
      resolvesPending: true,
    });
  });

  it('a question wins over a pending order: the log answer is given and the order is set aside', () => {
    expect(routeMessage('What did the Auditor do?', PENDING).kind).toBe('mind_log');
  });

  it('naming two minds is unclear, so Buddy asks which one', () => {
    expect(namedMind('Tell the analyst and the ceo to plan it')).toBeNull();
    expect(routeMessage('Tell the analyst and the ceo to plan it', null).kind).toBe('ask_which_mind');
  });
});

describe('routing: ordinary chat is not an order', () => {
  it.each([
    'Can you check the article for me?',
    'How do I add a product?',
    'Good morning',
    'Thanks, that helps',
  ])('"%s" goes to the normal chat', (message) => {
    expect(routeMessage(message, null).kind).toBe('chat');
  });

  it('thanks after a pending order goes to chat (the pending order is filed as waiting by the handler)', () => {
    expect(routeMessage('Thanks, that helps', PENDING).kind).toBe('chat');
  });
});

describe('restricted words', () => {
  it('flags an order that touches what minds may not do', () => {
    expect(isRestricted('Publish the guide')).toBe(true);
    expect(isRestricted('Send the newsletter')).toBe(true);
    expect(isRestricted('Change the price of the kit')).toBe(true);
    expect(isRestricted('Check the spring guide')).toBe(false);
  });

  it('the question to ask stays one plain line', () => {
    expect(ASK_WHICH_MIND_LINE).toBe('Which mind should take this: Analyst, Strategist, CEO, Executioner or Auditor? Reply with one name.');
  });
});

describe('answers come from real log rows', () => {
  it('says so plainly when the log could not be read, and changes nothing', () => {
    expect(answerFromLog('analyst', null)).toBe('I could not read the log just now, so I cannot say what the Analyst did. Nothing was changed. Try again shortly.');
  });

  it('says the mind has logged nothing when there are no rows, and never invents work', () => {
    expect(answerFromLog('analyst', [])).toBe('The Analyst has not logged any action yet.');
    expect(answerFromLog('analyst', [row({ mind: 'ceo' })])).toBe('The Analyst has not logged any action yet.');
  });

  it('lists only that mind, newest first, on the owner clock', () => {
    const text = answerFromLog('analyst', [
      row({ happened_at: '2026-10-09T08:05:00.000Z', action: 'Read the site numbers', outcome: 'done' }),
      row({ happened_at: '2026-10-09T07:00:00.000Z', action: 'Cannot think: no Google key', outcome: 'skipped' }),
      row({ mind: 'ceo', action: 'Put the orders in order' }),
    ]);
    expect(text).toBe([
      'What the Analyst did, newest first:',
      '2026-10-09 09:05: Read the site numbers. Done.',
      '2026-10-09 08:00: Cannot think: no Google key. Skipped.',
    ].join('\n'));
    expect(text).not.toContain('Put the orders');
  });

  it('shows the detail the mind logged, and never a country', () => {
    const text = answerFromLog('analyst', [row({ outcome: 'blocked', detail: 'Needs a fix first.' })]);
    expect(text).toContain('Blocked. Needs a fix first.');
    expect(text).not.toMatch(/nigeria|naira|lagos/i);
  });
});
