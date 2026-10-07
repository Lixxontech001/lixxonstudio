// @vitest-environment jsdom
/**
 * V8 UI: the owner sees exactly what the CEO wants to re-date, in dates rather
 * than raw JSON, and only the owner can apply it — a re-dating proposal never
 * offers the generic "Apply now" or "Dispatch" controls.
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

const reschedule = (overrides: Record<string, unknown> = {}) => ({
  id: 'q1', agent_key: 'ceo', action_type: 'queue_reschedule',
  title: 'CEO: proposed re-dating for your Lagos queue',
  detail: '2 move(s) proposed across the next 14 Lagos days.', risk: 'low',
  autonomy_level: 'suggest', status: 'queued',
  proposed: {
    moves: [
      {
        kind: 'post', id: 'p2', title: 'Re-dating fixture two',
        from_at: '2026-10-11T08:00:00.000Z', to_at: '2026-10-13T08:00:00.000Z',
        reason: 'The 11 Oct Lagos day holds two articles while 13 Oct is empty.',
      },
    ],
    limits: { max_moves: 3, capacity_per_day: 2, published_untouched: true },
    basis: 'Deterministic spread rule: move the least-visited item into the earliest empty Lagos day.',
  },
  created_at: '2026-10-06T09:00:00.000Z', ...overrides,
});

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

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.rpc.mockReset();
  mocks.permissions = ['admin.ai.run', 'admin.ai.approve', 'admin.ai.reports', 'admin.ai.policy'];
  queueFixture = [];
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'admin_ai_control_tower') return { data: controlTower(queueFixture), error: null };
    if (name === 'admin_ai_agent_status') return { data: { agents: [] }, error: null };
    if (name === 'admin_ai_apply_reschedule') return { data: { ok: true, status: 'applied', moves: [{ id: 'p2' }] }, error: null };
    return { data: null, error: null };
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('CEO queue re-dating controls', () => {
  it('shows the proposed moves as dates with their reason, not raw JSON', async () => {
    const page = await renderQueue([reschedule()]);
    const text = page.textContent || '';
    expect(text).toContain('Re-dating fixture two');
    expect(text).toContain('2026-10-11 08:00');
    expect(text).toContain('2026-10-13 08:00');
    expect(text).toContain('holds two articles');
    expect(page.querySelector('pre')).toBeNull();
  });

  it('offers Apply schedule to the owner and calls the apply RPC', async () => {
    const page = await renderQueue([reschedule()]);
    const apply = button(page, 'Apply schedule');
    expect(apply).not.toBeNull();
    await act(async () => { apply?.click(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_ai_apply_reschedule', { p_action_id: 'q1' });
    expect(page.textContent).toContain('1 article date(s) moved');
  });

  it('never offers the generic Apply now or Dispatch controls for a re-dating', async () => {
    const page = await renderQueue([reschedule({ status: 'approved' })]);
    expect(button(page, 'Apply now')).toBeUndefined();
    expect(button(page, 'Dispatch')).toBeUndefined();
  });

  it('withholds Apply schedule from a reviewer without approval permission', async () => {
    mocks.permissions = ['admin.ai.run', 'admin.ai.reports'];
    const page = await renderQueue([reschedule()]);
    expect(button(page, 'Apply schedule')).toBeUndefined();
    expect(page.textContent).toContain('Re-dating fixture two');
  });
});
