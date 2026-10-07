// @vitest-environment jsdom
/**
 * Phase 4 gap 2 UI: the owner must be able to see an Auditor block, dispatch an
 * approved allow-listed action, and override a block with a written reason —
 * while a reviewer without approval permission can do none of it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), permissions: [] as string[] }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { rpc: mocks.rpc, functions: { invoke: vi.fn() } },
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ can: (permission: string) => mocks.permissions.includes(permission) }),
}));

import AdminAI from '../admin/pages/AdminAI';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function action(overrides: Record<string, unknown>) {
  return {
    id: 'a1', agent_key: 'ceo', action_type: 'experiment_start', title: 'Start the grounded pilot',
    detail: 'Waiting for your decision.', risk: 'medium', autonomy_level: 'suggest', status: 'approved',
    proposed: { basis: 'grounded in measured search demand', metric_keys: ['article_views.total'] },
    created_at: '2026-10-06T09:00:00.000Z', ...overrides,
  };
}

function controlTower(queue: unknown[]) {
  return {
    settings: { enabled: false, kill_switch: false, default_autonomy: 'suggest', daily_budget_cents: 0, provider: 'rules' },
    agents: [], workflows: [], jobs: [], missions: [], queue, legacy_suggestions: [], incidents: [],
    experiments: [], memory: [], notifications: [], metrics: [], costs: { today: 0, total: 0 },
    goals: [], plans: [], commands: [], knowledge: [], campaigns: [], evaluations: [], routes: [],
    guardrails: [], segments: [], event_rules: [], events: [], twin: { measures: {} }, forecasts: [],
    anomalies: [], agent_reviews: [], trust_scores: [], knowledge_edges: [], maintenance_tasks: [],
    lifecycle: [], security_findings: [], learning_signals: [],
  };
}

let host: HTMLDivElement;
let root: Root | null = null;
/** What the tower RPC returns for the current test; renderQueue replaces it. */
let queueFixture: unknown[] = [];

async function settle() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
}

async function renderQueue(queue: unknown[]) {
  queueFixture = queue;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(<AdminAI />); });
  await settle();
  const tab = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Action queue');
  if (!tab) throw new Error('Action queue tab was not rendered');
  act(() => tab.click());
  await settle();
  return host;
}

function button(page: HTMLElement, label: string) {
  return Array.from(page.querySelectorAll('button')).find(b => b.textContent?.trim() === label);
}

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setValue?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.rpc.mockReset();
  mocks.permissions = ['admin.ai.run', 'admin.ai.approve', 'admin.ai.reports', 'admin.ai.policy'];
  queueFixture = [];
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'admin_ai_control_tower') return { data: controlTower(queueFixture), error: null };
    if (name === 'admin_ai_agent_status') return { data: { agents: [] }, error: null };
    if (name === 'admin_ai_dispatch_approved') return { data: { ok: true, message: 'Experiment started (internal state only; nothing was published)' }, error: null };
    if (name === 'admin_ai_override_block') return { data: { overridden: true }, error: null };
    return { data: null, error: null };
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('action queue governance controls', () => {
  it('offers Dispatch only for an approved allow-listed action type', async () => {
    const page = await renderQueue([action({})]);
    const dispatch = button(page, 'Dispatch');
    expect(dispatch).not.toBeNull();
    await act(async () => { dispatch?.click(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_ai_dispatch_approved', { p_action_id: 'a1' });
    expect(page.textContent).toContain('nothing was published');
  });

  it('does not offer Dispatch for a non-allow-listed type or an unapproved action', async () => {
    const publish = await renderQueue([action({ action_type: 'publish_now' })]);
    expect(button(publish, 'Dispatch')).toBeUndefined();
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    const queued = await renderQueue([action({ status: 'queued' })]);
    expect(button(queued, 'Dispatch')).toBeUndefined();
  });

  it('shows the Auditor block reason and only offers Override for that state', async () => {
    const blocked = await renderQueue([action({
      status: 'paused',
      decision_note: 'Blocked by the independent Auditor: No measured basis, evidence or metric keys are attached',
    })]);
    expect(blocked.textContent).toContain('Blocked by the independent Auditor');
    expect(button(blocked, 'Override block')).not.toBeNull();
    // An ordinary paused action must not offer an override.
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    const paused = await renderQueue([action({ status: 'paused', decision_note: 'Paused by the owner' })]);
    expect(button(paused, 'Override block')).toBeUndefined();
  });

  it('sends the typed reason when overriding a block', async () => {
    const page = await renderQueue([action({
      status: 'paused',
      decision_note: 'Blocked by the independent Auditor: No measured basis attached',
    })]);
    const input = page.querySelector<HTMLInputElement>('input[aria-label="Decision note or override reason"]');
    expect(input).not.toBeNull();
    expect(input?.className).toContain('min-h-11');
    await act(async () => { if (input) typeInto(input, 'Owner accepts the missing basis for this pilot'); });
    await settle();
    await act(async () => { button(page, 'Override block')?.click(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_ai_override_block', {
      p_action_id: 'a1', p_reason: 'Owner accepts the missing basis for this pilot',
    });
    expect(page.textContent).toContain('Block overridden and recorded.');
  });

  it('surfaces a refused override instead of pretending it worked', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'admin_ai_control_tower') {
        return { data: controlTower([action({ status: 'paused', decision_note: 'Blocked by the independent Auditor: external publishing' })]), error: null };
      }
      if (name === 'admin_ai_override_block') return { data: null, error: { message: 'This block cannot be overridden: External publishing' } };
      return { data: null, error: null };
    });
    const page = await renderQueue([action({ status: 'paused', decision_note: 'Blocked by the independent Auditor: external publishing' })]);
    await act(async () => { button(page, 'Override block')?.click(); });
    await settle();
    expect(page.textContent).toContain('cannot be overridden');
    expect(page.textContent).not.toContain('Block overridden and recorded.');
  });

  it('hides both controls from a reviewer without approval permission', async () => {
    mocks.permissions = ['admin.ai.run', 'admin.ai.reports'];
    const page = await renderQueue([action({})]);
    expect(button(page, 'Dispatch')).toBeUndefined();
    expect(page.querySelector('input[aria-label="Decision note or override reason"]')).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_ai_dispatch_approved', expect.anything());
  });
});
