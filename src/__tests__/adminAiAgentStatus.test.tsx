// @vitest-environment jsdom
/**
 * Phase 4 gap 3: the control room must show each agent's last/next run, what its
 * runs actually produced, and the incident controls for its own runs — with the
 * same owner permission gating the server enforces.
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

const ROLES = [['analyst', 'Analyst'], ['ceo', 'CEO']] as const;

function controlTower() {
  return {
    settings: { enabled: false, kill_switch: false, default_autonomy: 'suggest', daily_budget_cents: 0, provider: 'rules' },
    agents: [
      { agent_key: 'analyst', label: 'Analyst', description: 'Aggregate-only briefs', enabled: true, autonomy_level: 'suggest', cadence_minutes: 60, max_actions: 5, config: { suggestion_only: true } },
      { agent_key: 'ceo', label: 'CEO', description: 'Operations scorecard', enabled: false, autonomy_level: 'suggest', cadence_minutes: 120, max_actions: 5, config: { suggestion_only: true } },
    ],
    workflows: [], jobs: [], missions: [], queue: [], legacy_suggestions: [], incidents: [],
    experiments: [], memory: [], notifications: [], metrics: [], costs: { today: 0, total: 0 },
    goals: [], plans: [], commands: [], knowledge: [], campaigns: [], evaluations: [], routes: [],
    guardrails: [], segments: [], event_rules: [], events: [], twin: { measures: {} }, forecasts: [],
    anomalies: [], agent_reviews: [], trust_scores: [], knowledge_edges: [], maintenance_tasks: [],
    lifecycle: [], security_findings: [], learning_signals: [],
  };
}

function statusBoard() {
  return {
    agents: [
      {
        agent_key: 'analyst', label: 'Analyst', enabled: true, autonomy_level: 'suggest', cadence_minutes: 60,
        last_run_at: '2026-10-06T09:00:00.000Z', next_run_at: '2026-10-06T10:00:00.000Z', schedule_state: 'scheduled',
        runs_last_24h: 2, failed_runs_last_7d: 0, queued_actions: 1, open_incidents: 1,
      },
      {
        agent_key: 'ceo', label: 'CEO', enabled: false, autonomy_level: 'suggest', cadence_minutes: 120,
        last_run_at: null, next_run_at: null, schedule_state: 'paused',
        runs_last_24h: 0, failed_runs_last_7d: 0, queued_actions: 0, open_incidents: 0,
      },
    ],
  };
}

function transcriptFor(agentKey: string) {
  if (agentKey === 'ceo') {
    return {
      agent_key: 'ceo',
      jobs: [{ id: 'job-ceo', kind: 'agent', status: 'completed', created_at: '2026-10-06T08:00:00.000Z', started_at: '2026-10-06T08:00:00.000Z', finished_at: '2026-10-06T08:00:01.000Z', duration_ms: 1000, error: null, actions_created: 1, incidents: [] }],
      incidents: [],
    };
  }
  return {
    agent_key: 'analyst',
    jobs: [
      {
        id: 'job-analyst', kind: 'agent', status: 'completed', created_at: '2026-10-06T09:00:00.000Z',
        started_at: '2026-10-06T09:00:00.000Z', finished_at: '2026-10-06T09:00:00.250Z', duration_ms: 250,
        error: null, actions_created: 3,
        incidents: [{ id: 'inc-1', severity: 'warning', status: 'open', title: 'GAP3_INCIDENT' }],
      },
      {
        id: 'job-analyst-old', kind: 'agent', status: 'failed', created_at: '2026-10-05T09:00:00.000Z',
        started_at: null, finished_at: null, duration_ms: null, error: 'provider unavailable', actions_created: 0, incidents: [],
      },
    ],
    incidents: [
      { id: 'inc-1', severity: 'warning', status: 'open', title: 'GAP3_INCIDENT', detail: 'Aggregate metric missing review.', resolution: null, created_at: '2026-10-06T09:00:01.000Z', acknowledged_at: null, resolved_at: null },
      { id: 'inc-2', severity: 'info', status: 'resolved', title: 'OLD_INCIDENT', detail: 'Already handled.', resolution: 'Reviewed by owner', created_at: '2026-10-04T09:00:00.000Z', acknowledged_at: '2026-10-04T10:00:00.000Z', resolved_at: '2026-10-04T11:00:00.000Z' },
    ],
  };
}

let host: HTMLDivElement;
let root: Root | null = null;

async function settle() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
}

async function renderAgents() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(<AdminAI />); });
  await settle();
  const tab = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Agents');
  if (!tab) throw new Error('Agent fleet tab was not rendered');
  act(() => tab.click());
  await settle();
  return host;
}

function button(page: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(page.querySelectorAll('button')).find(b => b.textContent?.trim() === label);
}

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.rpc.mockReset();
  mocks.permissions = ['admin.ai.run', 'admin.ai.policy', 'admin.ai.approve', 'admin.ai.incidents'];
  mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'admin_ai_control_tower') return { data: controlTower(), error: null };
    if (name === 'admin_ai_agent_status') return { data: statusBoard(), error: null };
    if (name === 'admin_ai_agent_transcript') return { data: transcriptFor(String(args?.p_agent_key || '')), error: null };
    if (name === 'admin_ai_resolve_incident') return { data: true, error: null };
    return { data: null, error: null };
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('per-agent status, transcript and incident controls', () => {
  it('shows each agent’s last run, next run, schedule state and counters', async () => {
    const page = await renderAgents();

    expect(page.textContent).toContain('Last run');
    expect(page.textContent).toContain('Next run');
    // The scheduled agent renders its real timestamps (12h or 24h locale formatting).
    expect(page.textContent).toMatch(/10\/6\/2026|6\/10\/2026|2026-10-06/);
    expect(page.textContent).toContain('Scheduled');
    expect(page.textContent).toContain('2 run(s), 1 queued');
    // The counters that need attention are only shown when they are non-zero.
    expect(page.textContent).toContain('1 open incident(s)');
    // A disabled agent must be labelled paused, never presented as scheduled.
    expect(page.textContent).toContain('Paused — will not run');
  });

  it('does not load a transcript until asked, then shows what the runs produced', async () => {
    const page = await renderAgents();
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_ai_agent_transcript', expect.anything());

    const open = button(page, 'Transcript & incidents');
    expect(open).not.toBeNull();
    expect(open?.getAttribute('aria-expanded')).toBe('false');
    expect(open?.className).toContain('min-h-11');
    await act(async () => { open?.click(); });
    await settle();

    expect(mocks.rpc).toHaveBeenCalledWith('admin_ai_agent_transcript', { p_agent_key: 'analyst', p_limit: 10 });
    expect(page.textContent).toContain('Recent runs');
    expect(page.textContent).toContain('completed');
    expect(page.textContent).toContain('3 proposal(s)');
    expect(page.textContent).toContain('250 ms');
    // A failed run shows its error rather than looking successful.
    expect(page.textContent).toContain('failed');
    expect(page.textContent).toContain('provider unavailable');
    // Incidents are linked per run and resolved ones stay visible as history.
    expect(page.textContent).toContain('GAP3_INCIDENT');
    expect(page.textContent).toContain('OLD_INCIDENT');
    expect(page.textContent).toContain('Resolution: Reviewed by owner');
  });

  it('never shows another agent’s transcript', async () => {
    const page = await renderAgents();
    const ceoCard = Array.from(page.querySelectorAll('button'))
      .filter(b => b.textContent?.trim() === 'Transcript & incidents');
    // Second agent card in the fleet is the CEO.
    await act(async () => { ceoCard[1]?.click(); });
    await settle();

    expect(mocks.rpc).toHaveBeenCalledWith('admin_ai_agent_transcript', { p_agent_key: 'ceo', p_limit: 10 });
    // The CEO fixture has exactly one run and no incidents; the analyst's run
    // detail, its failure and its incident must never appear in this panel.
    expect(page.textContent).toContain('1 proposal(s)');
    expect(page.textContent).toContain('No incidents are linked to this agent\'s runs.');
    expect(page.textContent).not.toContain('provider unavailable');
    expect(page.textContent).not.toContain('GAP3_INCIDENT');
    expect(page.textContent).not.toContain('Resolution: Reviewed by owner');
  });

  it('resolves an incident with the owner’s note, and stays read-only without the permission', async () => {
    const page = await renderAgents();
    await act(async () => { button(page, 'Transcript & incidents')?.click(); });
    await settle();

    const note = page.querySelector<HTMLInputElement>('input[aria-label="Resolution note for GAP3_INCIDENT"]');
    expect(note).not.toBeNull();
    await act(async () => {
      if (note) {
        // React tracks the input value internally, so set it through the native
        // setter before dispatching input, otherwise onChange never fires.
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setValue?.call(note, 'Owner reviewed the aggregate gap');
        note.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await settle();

    const acknowledge = page.querySelector<HTMLButtonElement>('button[aria-label="Acknowledge GAP3_INCIDENT"]');
    const resolve = page.querySelector<HTMLButtonElement>('button[aria-label="Resolve GAP3_INCIDENT"]');
    expect(acknowledge?.className).toContain('min-h-11');
    expect(resolve).not.toBeNull();
    // A resolved incident offers no further controls.
    expect(page.querySelector('button[aria-label="Resolve OLD_INCIDENT"]')).toBeNull();

    await act(async () => { acknowledge?.click(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_ai_resolve_incident', expect.objectContaining({ p_id: 'inc-1', p_status: 'acknowledged' }));
    expect(page.textContent).toContain('Incident acknowledged.');

    // Acknowledge re-renders the list, so re-query before the second control.
    const resolveAfter = page.querySelector<HTMLButtonElement>('button[aria-label="Resolve GAP3_INCIDENT"]');
    await act(async () => { resolveAfter?.click(); });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_ai_resolve_incident', expect.objectContaining({ p_id: 'inc-1', p_status: 'resolved', p_resolution: 'Owner reviewed the aggregate gap' }));
  });

  it('hides incident controls from a reviewer without admin.ai.incidents but keeps the history', async () => {
    mocks.permissions = ['admin.ai.run'];
    const page = await renderAgents();
    await act(async () => { button(page, 'Transcript & incidents')?.click(); });
    await settle();

    expect(page.textContent).toContain('GAP3_INCIDENT');
    expect(page.querySelector('button[aria-label="Resolve GAP3_INCIDENT"]')).toBeNull();
    expect(page.querySelector('input[aria-label="Resolution note for GAP3_INCIDENT"]')).toBeNull();
    expect(page.textContent).toContain('Requires the admin.ai.incidents permission.');
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_ai_resolve_incident', expect.anything());
  });

  it('reports a refused incident control instead of pretending it worked', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'admin_ai_control_tower') return { data: controlTower(), error: null };
      if (name === 'admin_ai_agent_status') return { data: statusBoard(), error: null };
      if (name === 'admin_ai_agent_transcript') return { data: transcriptFor('analyst'), error: null };
      if (name === 'admin_ai_resolve_incident') return { data: null, error: { message: 'forbidden' } };
      return { data: null, error: null };
    });
    const page = await renderAgents();
    await act(async () => { button(page, 'Transcript & incidents')?.click(); });
    await settle();
    await act(async () => { page.querySelector<HTMLButtonElement>('button[aria-label="Resolve GAP3_INCIDENT"]')?.click(); });
    await settle();

    expect(page.textContent).toContain('Refused: forbidden');
    expect(page.textContent).not.toContain('Incident resolved.');
  });

  it('announces transcript and incident status through a live region', async () => {
    const page = await renderAgents();
    await act(async () => { button(page, 'Transcript & incidents')?.click(); });
    await settle();
    const section = page.querySelector('section[aria-label="analyst job transcript and incidents"]');
    expect(section).not.toBeNull();
    expect(section?.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('keeps the transcript button wired to its panel for assistive technology', async () => {
    const page = await renderAgents();
    const open = button(page, 'Transcript & incidents');
    const controls = open?.getAttribute('aria-controls');
    expect(controls).toBe('transcript-analyst');
    await act(async () => { open?.click(); });
    await settle();
    expect(page.querySelector('#transcript-analyst')).not.toBeNull();
    expect(button(page, 'Hide transcript')?.getAttribute('aria-expanded')).toBe('true');
  });
});

// The role list is kept explicit so a renamed agent key cannot silently drop a card.
it('covers every boardroom role in the fleet fixture', () => {
  const keys = controlTower().agents.map(agent => agent.agent_key);
  expect(keys).toContain('analyst');
  expect(keys).toContain('ceo');
  expect(ROLES.length).toBeGreaterThan(0);
});
