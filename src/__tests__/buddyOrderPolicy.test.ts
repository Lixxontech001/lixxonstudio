import { describe, expect, it } from 'vitest';
import { ALLOWED_ORDERS, REFUSAL_LINE, refusedRequest } from '../../supabase/functions/_shared/buddyOrderPolicy';
import { feedbackLine } from '../../supabase/functions/_shared/buddyFeedback';
import { routeMessage } from '../../supabase/functions/_shared/buddyRouter';

describe('Buddy order policy: the closed list', () => {
  it('has exactly the five allowed kinds, in order', () => {
    expect([...ALLOWED_ORDERS]).toEqual([
      'run_today',
      'pause_resume_free_door',
      'kill_or_start_mind',
      'product_line_apply',
      'mind_work',
    ]);
  });

  it('refuses the owner-listed requests: refunds, deletes, email to the list, reader replies, price changes, posting', () => {
    const refused = [
      'Refund order 1042 to Jane',
      'Can you refund this customer?',
      'Delete this article',
      'Remove the old product page',
      'Email my list about the sale',
      'Blast the subscribers with the new kit',
      'Reply to that comment for me',
      'Answer the reader who asked about sizes',
      'Change the price of the linen sheet to $20',
      'Lower prices on all the kits',
      'Publish this article now',
      'Post it to Facebook right away',
      'Send this to the Pinterest board now',
    ];
    for (const message of refused) expect(refusedRequest(message), message).toBe(true);
  });

  it('does not refuse questions, run requests, or ordinary mind work', () => {
    const allowed = [
      'What was the refund total last week?',
      'Did we refund anyone this month?',
      'How many subscribers do we have?',
      'Tell me the price of the linen sheet',
      'Strategist, plan the spring push for the kit',
      'Executioner, put the linen sheet on the kit article',
      'Analyst, look at last week and check the numbers',
    ];
    for (const message of allowed) expect(refusedRequest(message), message).toBe(false);
  });

  it('the refusal line says what stays with the owner and that nothing was filed or changed', () => {
    expect(REFUSAL_LINE).toContain('Nothing was filed or changed.');
    expect(REFUSAL_LINE).toContain('Refunds');
    expect(REFUSAL_LINE).not.toMatch(/—/);
  });
});

describe('Buddy router: a refused request becomes one refusal route', () => {
  it('routes a refund request to the refused route, with the one line', () => {
    expect(routeMessage('Refund order 1042 to Jane', null)).toEqual({ kind: 'refused', line: REFUSAL_LINE });
  });

  it('does not refuse a named-mind planning order (it is filed as waiting, nothing changes)', () => {
    expect(routeMessage('Plan the spring push for the kit with the Strategist.', null)).toMatchObject({
      kind: 'order',
      mind: 'strategist',
    });
  });

  it('still runs today, and still answers a question about a refund as a question', () => {
    expect(routeMessage("Run today's packs", null)).toMatchObject({ kind: 'run_day' });
    expect(routeMessage('Did we refund anyone this month?', null).kind).not.toBe('refused');
  });

  it('keeps the control and how-to routes that already worked', () => {
    expect(routeMessage('Pause the telegram door', null)).toMatchObject({ kind: 'control' });
    expect(routeMessage('How do I connect YouTube?', null)).toMatchObject({ kind: 'how_to' });
  });
});

describe('Buddy feedback: waiting, done, blocked', () => {
  it('waiting with Takeover off says nothing has changed', () => {
    expect(feedbackLine({ state: 'waiting', takeover: false, mind: 'Strategist' })).toBe(
      'Saved for the Strategist. It is waiting. Takeover is off, so nothing has changed.',
    );
  });

  it('waiting with Takeover on says it runs on the next run', () => {
    expect(feedbackLine({ state: 'waiting', takeover: true, mind: 'Analyst' })).toBe(
      'Saved for the Analyst. It is waiting. Takeover is on, so it runs on the next run.',
    );
  });

  it('waiting with Takeover unreadable says so, and that nothing has changed', () => {
    expect(feedbackLine({ state: 'waiting', takeover: null })).toBe(
      'Saved. It is waiting. I could not read Takeover just now, so nothing has changed.',
    );
  });

  it('done says what changed, with one full stop', () => {
    expect(feedbackLine({ state: 'done', what: 'The pause is on for the telegram door' })).toBe(
      'Done. The pause is on for the telegram door.',
    );
    expect(feedbackLine({ state: 'done', what: 'Kill is on.' })).toBe('Done. Kill is on.');
  });

  it('blocked gives the reason and says nothing on the site changed', () => {
    expect(feedbackLine({ state: 'blocked', reason: 'The Auditor stopped the change' })).toBe(
      'Blocked. The Auditor stopped the change. Nothing on the site changed.',
    );
  });

  it('never uses the owner-banned words in these lines', () => {
    const lines = [
      feedbackLine({ state: 'waiting', takeover: true, mind: 'Analyst' }),
      feedbackLine({ state: 'done', what: 'Done' }),
      feedbackLine({ state: 'blocked', reason: 'x' }),
      REFUSAL_LINE,
    ].join(' ');
    expect(lines).not.toMatch(/\b(autonomy|control tower|orchestration|RPC|payload|dispatch|daily kit|adapter|failover|router)\b/i);
  });
});

describe('Buddy order policy: a statement is not a request', () => {
  it('a plain statement that mentions a refund is not refused', () => {
    expect(refusedRequest('The Jane order needs sorting out, and the refund is the hard part.')).toBe(false);
    expect(refusedRequest('Refunds were fine last month.')).toBe(false);
  });

  it('a request with a name in front, or a polite opener, is still refused', () => {
    expect(refusedRequest('Buddy, refund Jane today')).toBe(true);
    expect(refusedRequest('Can you refund Jane today?')).toBe(true);
    expect(refusedRequest('Please delete the old article')).toBe(true);
  });
});

describe('Buddy order policy: the owner example', () => {
  it('"refund this" alone is refused, and the router refuses it as one line', () => {
    expect(refusedRequest('refund this')).toBe(true);
    expect(routeMessage('refund this', null)).toEqual({ kind: 'refused', line: REFUSAL_LINE });
  });
});
