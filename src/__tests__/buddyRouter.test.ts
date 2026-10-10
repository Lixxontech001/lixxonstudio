import { describe, expect, it } from 'vitest';
import {
  ASK_WHICH_MIND_LINE,
  answerFromLog,
  NEVER_LIST_LINES,
  neverListLine,
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

describe('ordinary action words become orders, with no magic phrase', () => {
  it('"Do the new article" is an order, not a question: Buddy asks which mind', () => {
    expect(routeMessage('Do the new article', null)).toEqual({ kind: 'ask_which_mind', instruction: 'Do the new article' });
  });

  it('a polite opener does not hide the action word', () => {
    expect(routeMessage('Please do the new article', null)).toEqual({ kind: 'ask_which_mind', instruction: 'Please do the new article' });
    expect(routeMessage('Could you tell the Analyst to check the spring guide', null)).toEqual({
      kind: 'order',
      mind: 'analyst',
      instruction: 'Could you tell the Analyst to check the spring guide',
      resolvesPending: false,
    });
  });

  it('"Have the Strategist plan the summer list" is an order for the Strategist', () => {
    expect(routeMessage('Have the Strategist plan the summer list', null)).toMatchObject({ kind: 'order', mind: 'strategist' });
  });

  it('"Do you know what the Analyst did?" is still a question about the Analyst', () => {
    expect(routeMessage('Do you know what the Analyst did?', null)).toEqual({ kind: 'mind_log', mind: 'analyst' });
  });

  it('"Tell me what the Analyst did" is a question, not an order', () => {
    expect(routeMessage('Tell me what the Analyst did', null)).toEqual({ kind: 'mind_log', mind: 'analyst' });
  });

  it('"Check what the Auditor did?" is a question, even with an action word', () => {
    expect(routeMessage('Check what the Auditor did?', null)).toEqual({ kind: 'mind_log', mind: 'auditor' });
  });

  it('a question with no mind is ordinary chat, even with an action word inside it', () => {
    expect(routeMessage('Can you check the article for me?', null)).toEqual({ kind: 'chat' });
    expect(routeMessage('Do you know the weather?', null)).toEqual({ kind: 'chat' });
    expect(routeMessage('How do I add a product?', null)).toEqual({ kind: 'chat' });
  });

  it('"Do the new article" completes a pending order when the owner names a mind', () => {
    expect(routeMessage('the ceo', { instruction: 'Do the new article' })).toEqual({
      kind: 'order',
      mind: 'ceo',
      instruction: 'Do the new article',
      resolvesPending: true,
    });
  });

  it('a named mind still files a waiting order', () => {
    expect(routeMessage('Tell the Executioner to add the kit to the spring guide', null)).toMatchObject({
      kind: 'order',
      mind: 'executioner',
      resolvesPending: false,
    });
  });
});

describe('requests a mind never does are refused before any model call', () => {
  it('a reply to a reader, as the owner, is refused', () => {
    expect(neverListLine('Reply to the customer who asked about the bag')).toBe(NEVER_LIST_LINES.reader);
    expect(neverListLine('Can you DM the reader who commented?')).toBe(NEVER_LIST_LINES.reader);
  });

  it('spending money or buying ads is refused', () => {
    expect(neverListLine('Spend 50 dollars on ads for the summer post')).toBe(NEVER_LIST_LINES.spend);
    expect(neverListLine('Buy an ad for the new article')).toBe(NEVER_LIST_LINES.spend);
  });

  it('creating a shop product is refused, but placing an existing one is not', () => {
    expect(neverListLine('Create a new product for the linen bag')).toBe(NEVER_LIST_LINES.product);
    expect(neverListLine('Add the Oat Bath Soak product to the article')).toBeNull();
  });

  it('rewriting a whole article is refused, but a sentence change is not', () => {
    expect(neverListLine('Rewrite the whole article in a warmer voice')).toBe(NEVER_LIST_LINES.rewrite);
    expect(neverListLine('Change one sentence in the second paragraph')).toBeNull();
  });

  it('ordinary messages are not refused', () => {
    expect(neverListLine('What did the Analyst do?')).toBeNull();
    expect(neverListLine('Thanks, that helps')).toBeNull();
  });
});
