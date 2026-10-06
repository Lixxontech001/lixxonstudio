// @vitest-environment jsdom
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
const roles = [
  ['analyst', 'Analyst'],
  ['strategist', 'Strategist'],
  ['ceo', 'CEO'],
  ['auditor', 'Auditor'],
  ['executioner', 'Executioner'],
  ['chief_of_staff', 'Chief of Staff'],
] as const;

function controlTower(executionerEnabled = false) {
  return {
    settings: { enabled: false, kill_switch: false, default_autonomy: 'suggest', daily_budget_cents: 0, provider: 'rules' },
    agents: roles.map(([agent_key, label]) => ({
      agent_key, label, description: `${label} aggregate-only test fixture`, enabled: agent_key === 'executioner' && executionerEnabled,
      autonomy_level: 'suggest', cadence_minutes: 1440, max_actions: 10,
      config: { suggestion_only: true },
    })),
    workflows: [], jobs: [], missions: [], queue: [], legacy_suggestions: [], incidents: [],
    experiments: [], memory: [], notifications: [], metrics: [], costs: { today: 0, total: 0 },
    goals: [], plans: [], commands: [], knowledge: [], campaigns: [], evaluations: [], routes: [],
    guardrails: [], segments: [], event_rules: [], events: [], twin: { measures: {} }, forecasts: [],
    anomalies: [], agent_reviews: [], trust_scores: [], knowledge_edges: [], maintenance_tasks: [],
    lifecycle: [], security_findings: [], learning_signals: [],
  };
}

let host: HTMLDivElement;
let root: Root | null = null;

async function settle() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
}

async function renderAgents(fixture = controlTower()) {
  mocks.rpc.mockImplementation(async () => ({ data: fixture, error: null }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root?.render(<AdminAI />); });
  await settle();
  const agentsTab = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Agents');
  if (!agentsTab) throw new Error('Agent fleet tab was not rendered');
  act(() => agentsTab.click());
  await settle();
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.rpc.mockReset();
  mocks.permissions = ['admin.ai.run', 'admin.ai.policy', 'admin.ai.approve'];
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('Admin AI boardroom agent controls', () => {
  it('labels each pause control and keeps all six new roles paused, suggestion-only, and unrunnable by default', async () => {
    const page = await renderAgents();

    for (const [, label] of roles) {
      const pause = page.querySelector<HTMLInputElement>(`input[aria-label="Enable ${label} agent"]`);
      const autonomy = page.querySelector<HTMLSelectElement>(`select[aria-label="${label} autonomy level"]`);
      const run = page.querySelector<HTMLButtonElement>(`button[aria-label="Run ${label}"]`);
      expect(pause).not.toBeNull();
      expect(pause?.checked).toBe(false);
      expect(pause?.disabled).toBe(false);
      expect(pause?.parentElement?.className).toContain('min-h-11');
      expect(autonomy).not.toBeNull();
      expect(Array.from(autonomy?.options || []).map(option => option.value)).toEqual(['suggest', 'disabled']);
      expect(run).not.toBeNull();
      expect(run?.disabled).toBe(true);
      expect(run?.className).toContain('min-h-11');
      expect(page.textContent).toContain('Suggestion only');
    }
  });

  it('keeps Executioner unavailable without approval permission and exposes policy controls read-only without owner policy permission', async () => {
    mocks.permissions = ['admin.ai.run'];
    const page = await renderAgents(controlTower(true));

    const pause = page.querySelector<HTMLInputElement>('input[aria-label="Enable Executioner agent"]');
    const autonomy = page.querySelector<HTMLSelectElement>('select[aria-label="Executioner autonomy level"]');
    const run = page.querySelector<HTMLButtonElement>('button[aria-label="Run Executioner"]');
    const save = page.querySelector<HTMLButtonElement>('button[aria-label="Save Executioner policy"]');
    expect(pause?.disabled).toBe(true);
    expect(autonomy?.disabled).toBe(true);
    expect(save?.disabled).toBe(true);
    expect(run?.disabled).toBe(true);
    expect(run?.title).toBe('Requires admin.ai.approve');
  });
});
