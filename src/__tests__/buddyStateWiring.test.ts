import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edge = readFileSync('supabase/functions/buddy-think/index.ts', 'utf8');
const think = readFileSync('supabase/functions/_shared/buddyThink.ts', 'utf8');

function stateReader(): string {
  const start = edge.indexOf('readStateFacts: async');
  expect(start).toBeGreaterThan(-1);
  return edge.slice(start, edge.indexOf('readMindLog:', start));
}

describe('Buddy state wiring: the edge function reads the live minds state, read only', () => {
  it('reads Takeover and the kill switch from the owner session', () => {
    const reader = stateReader();
    expect(reader).toContain('from("minds_controls").select("takeover,kill_scope")');
    expect(reader).toContain('userClient');
    expect(reader).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it('reads only waiting orders, the newest log rows and the newest notable events', () => {
    const reader = stateReader();
    expect(reader).toContain('from("buddy_orders")');
    expect(reader).toContain('.eq("status", "waiting")');
    expect(reader).toContain('from("minds_daily_log")');
    expect(reader).toContain('from("minds_notable_events")');
    expect(reader).toContain('.select("happened_at,title")');
    expect(reader).toContain('.select("happened_at,day,mind,action,outcome,detail")');
  });

  it('never selects a column that could hold an article body or a secret', () => {
    const reader = stateReader();
    expect(reader).not.toMatch(/content|secret|token|api_key|password/i);
  });

  it('the answer path reads the state fresh for each question and gives it to the model', () => {
    expect(think).toContain('deps.readStateFacts()');
    expect(think).toContain('stateFactsBlock(state)');
    expect(think).toContain('json: true');
  });

  it('the site read adds the summary column and no body column', () => {
    expect(edge).toContain('.select("title,slug,published_at,excerpt", { count: "exact" })');
    const siteRead = edge.slice(edge.indexOf('readSiteFacts: async'), edge.indexOf('findOrCreateBriefing'));
    expect(siteRead).not.toMatch(/\bcontent\b/);
  });

  it('the Gemini call asks for JSON only when the answer path needs it', () => {
    expect(think).toContain('responseMimeType: "application/json"');
    expect(think).toContain('generationConfig: input.json');
  });
});
