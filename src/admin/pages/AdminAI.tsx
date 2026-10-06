import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Check, XCircle as CircleSlash, FileText, MessageCircle, Play, RefreshCw, ShieldCheck, Sparkles, Wrench, Pause, Compass as Target, Lightbulb as Brain, Beaker as FlaskConical, Bell, AlertTriangle, Activity, TrendingUp, GitBranch, Network, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { Btn, Empty, Loading, Notice, Panel, Severity, useAdminAction, useAdminRpc } from '../components/ui';

type Autonomy = 'observe' | 'suggest' | 'draft' | 'auto_apply' | 'approval_required' | 'disabled';
type Agent = { agent_key: string; label: string; description: string; enabled: boolean; autonomy_level: Autonomy; cadence_minutes: number; max_actions: number; config?: Record<string, unknown>; last_run_at?: string; next_run_at?: string };
type Action = { id: string; agent_key?: string; action_type: string; title: string; detail: string; risk: string; autonomy_level: Autonomy; required_permission?: string; target_type?: string; target_id?: string; proposed: Record<string, unknown>; status: string; created_at: string; decision_note?: string; source?: 'legacy' };
type Mission = { id: string; title: string; objective: string; metric_key: string; target_value?: number; deadline?: string; status: string; priority: number; agent_keys: string[]; created_at: string };
type Workflow = { id: string; name: string; description: string; trigger_type: string; enabled: boolean; autonomy_level: Autonomy; run_count: number; last_run_at?: string };
type Tower = {
  settings: { enabled: boolean; kill_switch: boolean; default_autonomy: Autonomy; daily_budget_cents: number; provider: string };
  agents: Agent[]; workflows: Workflow[]; jobs: { id: string; kind: string; status: string; created_at: string }[];
  missions: Mission[]; queue: Action[]; legacy_suggestions: Action[]; incidents: { id: string; severity: string; title: string; detail: string; status: string; created_at: string }[];
  experiments: { id: string; name: string; hypothesis: string; metric_key: string; status: string; winner?: string }[];
  memory: { id: string; memory_key: string; category: string; content: string; confidence: number; enabled: boolean }[];
  notifications: { id: string; title: string; body: string; severity: string; created_at: string }[];
  metrics: { metric_key: string; value: number; recorded_at: string }[];
  costs: { today?: number; total?: number };
  goals: { id: string; title: string; objective: string; metric_key: string; status: string; priority: number; deadline?: string }[];
  plans: { id: string; goal_id: string; title: string; status: string; risk: string; owner_approved: boolean }[];
  commands: { id: string; command: string; interpreted_intent: string; status: string; created_at: string }[];
  knowledge: { id: string; source_type: string; title: string; updated_at: string }[];
  campaigns: { id: string; name: string; topic: string; audience: string; status: string }[];
  evaluations: { id: string; score: number; decision: string; notes: string; created_at: string }[];
  routes: { task_type: string; provider: string; model?: string; max_cost_cents: number; requires_approval: boolean }[];
  guardrails: { rule_key: string; description: string; value: unknown; dangerous: boolean }[];
  segments: { id: string; name: string; description: string; member_count: number; status: string }[];
  event_rules: { event_type: string; label: string; description: string; severity: string; action_type: string; enabled: boolean }[];
  events: { id: string; event_type: string; entity_type?: string; payload: Record<string, unknown>; status: string; created_at: string }[];
  twin: { measures?: Record<string, number>; dimensions?: Record<string, unknown>; captured_at?: string };
  forecasts: { id: string; metric_key: string; horizon_days: number; baseline_value: number; forecast_value: number; confidence: number; method: string; status: string; created_at: string }[];
  anomalies: { id: string; metric_key: string; severity: string; observed_value?: number; expected_value?: number; explanation: string; status: string; created_at: string }[];
  agent_reviews: { id: string; action_id: string; reviewer_agent: string; verdict: string; confidence: number; concerns: unknown[]; created_at: string }[];
  trust_scores: { target_type: string; target_id: string; confidence: number; evidence_count: number; risk: string; rationale: string }[];
  knowledge_edges: { source_id: string; related_source_id: string; relation: string; strength: number }[];
  maintenance_tasks: { id: string; task_type: string; title: string; detail: string; risk: string; status: string; created_at: string }[];
  lifecycle: { stage_key: string; member_count: number; dimensions: Record<string, unknown>; recorded_at: string }[];
  security_findings: { id: string; severity: string; title: string; detail: string; status: string; created_at: string }[];
  learning_signals: { id: string; signal_type: string; agent_key?: string; outcome: string; recommendation: string; status: string; created_at: string }[];
};

const tabs = [
  ['overview', 'Overview'], ['strategy', 'Strategy'], ['command', 'Command'], ['agents', 'Agents'], ['missions', 'Missions'], ['queue', 'Action queue'],
  ['workflows', 'Workflows'], ['campaigns', 'Campaigns'], ['knowledge', 'Knowledge'], ['predictive', 'Predictive'], ['events', 'Events'], ['twin', 'Digital twin'], ['reviews', 'Debate & trust'], ['maintenance', 'Maintenance'], ['lifecycle', 'Lifecycle'], ['security', 'AI security'], ['learning', 'Learning'], ['experiments', 'Experiments'], ['memory', 'AI memory'], ['quality', 'Quality'], ['incidents', 'Incidents'], ['settings', 'Settings'],
] as const;
type Tab = typeof tabs[number][0];

export default function AdminAI() {
  const { can } = useAuth();
  const allowed = can('admin.ai.run');
  const canApprove = can('admin.ai.approve');
  const canManageAgents = can('admin.ai.policy');
  const canResolveIncidents = can('admin.ai.incidents');
  const tower = useAdminRpc<Tower>('admin_ai_control_tower', undefined, allowed);
  const agentStatus = useAdminRpc<{ agents: AgentStatusRow[] }>('admin_ai_agent_status', undefined, allowed);
  const action = useAdminAction();
  const [tab, setTab] = useState<Tab>('overview');
  const [postId, setPostId] = useState('');
  const [commentId, setCommentId] = useState('');
  const [workflow, setWorkflow] = useState('publish');
  const [workflowNote, setWorkflowNote] = useState('');
  const [autonomy, setAutonomy] = useState<Autonomy>('suggest');
  const [killSwitch, setKillSwitch] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [budget, setBudget] = useState(0);
  const [agentDrafts, setAgentDrafts] = useState<Record<string, { enabled: boolean; autonomy: Autonomy; cadence: number; max: number }>>({});
  const reload = tower.reload;

  useEffect(() => {
    if (!tower.data) return;
    setAutonomy(tower.data.settings.default_autonomy); setKillSwitch(tower.data.settings.kill_switch); setEnabled(tower.data.settings.enabled); setBudget(tower.data.settings.daily_budget_cents);
    setAgentDrafts(Object.fromEntries(tower.data.agents.map(a => [a.agent_key, { enabled: a.enabled, autonomy: a.autonomy_level, cadence: a.cadence_minutes, max: a.max_actions }])));
  }, [tower.data]);

  const run = (key: string, fn: () => Promise<{ error: string | null; text: string }>) => action.run(key, async () => { const result = await fn(); reload(); return result; });
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.rpc(name, args);
    return { data, error };
  };
  const scan = () => run('scan', async () => { const { data, error } = await rpc('admin_ai_scan'); return { error: error?.message || null, text: error ? '' : `Scan complete — ${String((data as { suggestions?: number } | null)?.suggestions || 0)} signals checked.` }; });
  const autopilot = () => run('autopilot', async () => { const { data, error } = await rpc('admin_ai_run_autopilot'); return { error: error?.message || null, text: error ? '' : `Autopilot completed ${JSON.stringify(data).slice(0, 140)}` }; });
  const autoFix = () => run('auto-fix', async () => { const { data, error } = await rpc('admin_ai_auto_run'); return { error: error?.message || null, text: error ? '' : `Safe automation applied ${String((data as { applied?: number } | null)?.applied || 0)} repair(s).` }; });
  const decide = (id: string, decision: 'approve' | 'reject' | 'pause' | 'apply') => run(`${decision}-${id}`, async () => { const { error } = await rpc('admin_ai_decide_action', { p_action_id: id, p_decision: decision, p_note: decision }); return { error: error?.message || null, text: error ? '' : `Action ${decision}d.` }; });
  const applyLegacy = (id: string) => run(`legacy-apply-${id}`, async () => { const { error } = await rpc('admin_ai_apply', { p_suggestion_id: id }); return { error: error?.message || null, text: error ? '' : 'Suggestion applied.' }; });
  const dismissLegacy = (id: string) => run(`legacy-dismiss-${id}`, async () => { const { error } = await rpc('admin_ai_dismiss', { p_suggestion_id: id }); return { error: error?.message || null, text: error ? '' : 'Suggestion dismissed.' }; });
  const queueWorkflow = () => run('queue-workflow', async () => { const { error } = await rpc('admin_ai_queue_workflow', { p_post_id: postId.trim(), p_action: workflow, p_note: workflowNote.trim() || null }); return { error: error?.message || null, text: error ? '' : 'Workflow proposal queued for approval.' }; });
  const draftReply = () => run('draft-reply', async () => { const { error } = await rpc('admin_ai_draft_reply', { p_comment_id: commentId.trim() }); return { error: error?.message || null, text: error ? '' : 'Reply draft queued for approval.' }; });
  const saveSettings = () => run('settings', async () => { const { error } = await rpc('admin_ai_set_autopilot', { p_enabled: enabled, p_kill_switch: killSwitch, p_default_autonomy: autonomy, p_budget: budget, p_provider: 'rules' }); return { error: error?.message || null, text: error ? '' : 'Autopilot policy saved.' }; });
  const runAgent = (key: string) => run(`agent-${key}`, async () => { const { data, error } = await rpc('admin_ai_run_agent', { p_agent_key: key }); return { error: error?.message || null, text: error ? '' : `${key} agent queued ${String((data as { queued?: number } | null)?.queued || 0)} action(s).` }; });
  const saveAgent = (agent: Agent) => { const d = agentDrafts[agent.agent_key]; if (!d) return; return run(`save-agent-${agent.agent_key}`, async () => { const { error } = await rpc('admin_ai_set_agent', { p_agent_key: agent.agent_key, p_enabled: d.enabled, p_autonomy: d.autonomy, p_cadence: d.cadence, p_max_actions: d.max, p_config: agent.config || {} }); return { error: error?.message || null, text: error ? '' : `${agent.label} policy saved.` }; }); };

  if (!allowed) return <Notice tone="warn">You need the <code>admin.ai.run</code> permission to open the Admin AI control tower.</Notice>;
  if (tower.loading && !tower.data) return <Loading />;
  if (tower.error) return <Notice tone="error">{tower.error}</Notice>;
  const data = tower.data;
  if (!data) return null;

  return <div>
    <header className="flex flex-wrap items-start justify-between gap-4 mb-5">
      <div><h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><Sparkles size={21} className="text-bronze" /> Admin AI Autopilot OS</h1><p className="text-sm text-charcoal-muted mt-1 max-w-3xl">Autonomous growth, editorial, commerce, community, reliability and security operations — grounded in live database facts and controlled by owner policy.</p></div>
      <div className="flex flex-wrap gap-2"><Btn variant="ghost" icon={<RefreshCw size={13} />} onClick={reload} busy={tower.loading}>Reload</Btn><Btn icon={<Sparkles size={13} />} onClick={scan} busy={action.busy === 'scan'}>Scan</Btn><Btn icon={<Play size={13} />} onClick={autopilot} busy={action.busy === 'autopilot'} disabled={!canApprove}>Run autopilot</Btn>{canApprove && <Btn variant="ghost" icon={<Wrench size={13} />} onClick={autoFix} busy={action.busy === 'auto-fix'}>Safe repairs</Btn>}</div>
    </header>
    {action.message && <div className="mb-4"><Notice tone={action.message.tone}>{action.message.text}</Notice></div>}
    <div className="flex flex-wrap gap-1 border-b border-taupe/40 mb-5">{tabs.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`px-3 py-2 text-xs ${tab === id ? 'text-bronze border-b-2 border-bronze' : 'text-charcoal-muted'}`}>{label}</button>)}</div>
    {tab === 'overview' && <Overview data={data} onTab={setTab} />}
    {tab === 'strategy' && <Strategy data={data} run={run} busy={action.busy} />}
    {tab === 'command' && <CommandCenter data={data} run={run} busy={action.busy} />}
    {tab === 'agents' && <Agents data={data} drafts={agentDrafts} setDrafts={setAgentDrafts} onRun={runAgent} onSave={saveAgent} busy={action.busy} canManage={canManageAgents} canApprove={canApprove} canResolveIncidents={canResolveIncidents} statusRows={agentStatus.data?.agents || null} onIncidentsChanged={agentStatus.reload} />}
    {tab === 'missions' && <Missions data={data} run={run} />}
    {tab === 'queue' && <Queue data={data} canApprove={canApprove} decide={decide} applyLegacy={applyLegacy} dismissLegacy={dismissLegacy} busy={action.busy} />}
    {tab === 'workflows' && <Workflows data={data} run={run} busy={action.busy} />}
    {tab === 'campaigns' && <Campaigns data={data} run={run} busy={action.busy} />}
    {tab === 'knowledge' && <Knowledge data={data} run={run} busy={action.busy} />}
    {tab === 'predictive' && <Predictive data={data} run={run} busy={action.busy} />}
    {tab === 'events' && <Events data={data} run={run} busy={action.busy} />}
    {tab === 'twin' && <DigitalTwin data={data} run={run} busy={action.busy} />}
    {tab === 'reviews' && <DebateTrust data={data} run={run} busy={action.busy} />}
    {tab === 'maintenance' && <Maintenance data={data} run={run} busy={action.busy} />}
    {tab === 'lifecycle' && <Lifecycle data={data} run={run} busy={action.busy} />}
    {tab === 'security' && <AISecurity data={data} run={run} busy={action.busy} />}
    {tab === 'learning' && <Learning data={data} run={run} busy={action.busy} />}
    {tab === 'experiments' && <Experiments data={data} run={run} />}
    {tab === 'memory' && <Memory data={data} run={run} />}
    {tab === 'quality' && <Quality data={data} run={run} busy={action.busy} />}
    {tab === 'incidents' && <Incidents data={data} run={run} />}
    {tab === 'settings' && <Settings data={data} canApprove={canApprove} enabled={enabled} setEnabled={setEnabled} killSwitch={killSwitch} setKillSwitch={setKillSwitch} autonomy={autonomy} setAutonomy={setAutonomy} budget={budget} setBudget={setBudget} save={saveSettings} busy={action.busy} />}
    {tab === 'overview' && <div className="grid lg:grid-cols-2 gap-5 mt-5"><Panel title="Queue a high-impact proposal" icon={<FileText size={15} className="text-bronze" />}><p className="text-xs text-charcoal-muted mb-3">Propose approve, publish, reject or an SEO edit. Applying is always permission and approval checked.</p><div className="space-y-3"><input value={postId} onChange={e => setPostId(e.target.value)} placeholder="Article UUID" className="w-full border border-taupe/50 px-3 py-2 text-sm rounded-sm" /><div className="flex gap-2"><select value={workflow} onChange={e => setWorkflow(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm"><option value="publish">Publish</option><option value="approve">Approve</option><option value="reject">Reject</option><option value="edit">SEO edit</option></select><input value={workflowNote} onChange={e => setWorkflowNote(e.target.value)} placeholder="Review note" className="flex-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm" /></div><Btn icon={<Play size={13} />} onClick={queueWorkflow} busy={action.busy === 'queue-workflow'} disabled={!postId.trim() || !canApprove}>Queue proposal</Btn></div></Panel><Panel title="Draft a community reply" icon={<MessageCircle size={15} className="text-bronze" />}><p className="text-xs text-charcoal-muted mb-3">Drafts are never posted automatically.</p><div className="flex gap-2"><input value={commentId} onChange={e => setCommentId(e.target.value)} placeholder="Comment UUID" className="flex-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm" /><Btn icon={<MessageCircle size={13} />} onClick={draftReply} busy={action.busy === 'draft-reply'} disabled={!commentId.trim() || !canApprove}>Draft</Btn></div></Panel></div>}
  </div>;
}

function Overview({ data, onTab }: { data: Tower; onTab: (tab: Tab) => void }) {
  const open = data.queue.length; const critical = data.incidents.filter(i => i.severity === 'critical').length; const active = data.missions.filter(m => m.status === 'active').length;
  return <><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5"><Stat label="Autopilot" value={data.settings.kill_switch ? 'STOPPED' : data.settings.enabled ? 'ON' : 'OFF'} tone={data.settings.kill_switch ? 'text-red-700' : data.settings.enabled ? 'text-green-700' : 'text-charcoal'} /><Stat label="Open actions" value={open} onClick={() => onTab('queue')} /><Stat label="Active missions" value={active} onClick={() => onTab('missions')} /><Stat label="Incidents" value={critical ? `${critical} critical` : data.incidents.length} onClick={() => onTab('incidents')} /><Stat label="AI spend today" value={`${((data.costs.today || 0) / 100).toFixed(2)}`} /></div><Panel title="Autonomy contract" icon={<ShieldCheck size={15} className="text-bronze" />}><div className="grid md:grid-cols-3 gap-3 text-xs text-charcoal-muted"><p><strong className="text-charcoal">Safe:</strong> reliability repair actions may run automatically only when the owner enables Autopilot.</p><p><strong className="text-charcoal">Approval:</strong> publishing, editing, replies, commerce, permissions and experiments stay in the queue.</p><p><strong className="text-charcoal">Stop:</strong> the kill switch pauses all autonomous work immediately; every decision is audited.</p></div></Panel><Panel title="Live signals" icon={<Bell size={15} className="text-bronze" />}><div className="space-y-2">{data.notifications.length ? data.notifications.slice(0, 5).map(n => <div key={n.id} className="flex gap-3 text-sm"><Severity level={n.severity} /><span className="text-charcoal">{n.title}</span><span className="text-xs text-charcoal-muted ml-auto">{new Date(n.created_at).toLocaleDateString()}</span></div>) : <Empty>No unread AI notifications.</Empty>}</div></Panel></>;
}
function Stat({ label, value, onClick, tone = 'text-charcoal' }: { label: string; value: string | number; onClick?: () => void; tone?: string }) { return <button type="button" onClick={onClick} className="text-left bg-white border border-taupe/30 rounded-sm p-4"><p className="text-[10px] uppercase tracking-wide text-charcoal-muted">{label}</p><p className={`text-xl font-serif mt-1 ${tone}`}>{value}</p></button>; }

type AgentScheduleState = 'paused' | 'unscheduled' | 'due' | 'scheduled';
type AgentStatusRow = {
  agent_key: string; label: string; enabled: boolean; autonomy_level: Autonomy; cadence_minutes: number;
  last_run_at: string | null; next_run_at: string | null; schedule_state: AgentScheduleState;
  runs_last_24h: number; failed_runs_last_7d: number; queued_actions: number; open_incidents: number;
};
type TranscriptJob = {
  id: string; kind: string; status: string; created_at: string; started_at: string | null; finished_at: string | null;
  duration_ms: number | null; error: string | null; actions_created: number;
  incidents: { id: string; severity: string; status: string; title: string }[];
};
type TranscriptIncident = {
  id: string; severity: string; status: string; title: string; detail: string; resolution: string | null;
  created_at: string; acknowledged_at: string | null; resolved_at: string | null;
};
type AgentTranscriptData = { agent_key: string; jobs: TranscriptJob[]; incidents: TranscriptIncident[] };

const scheduleCopy: Record<AgentScheduleState, string> = {
  paused: 'Paused — will not run',
  unscheduled: 'No next run yet',
  due: 'Due now',
  scheduled: 'Scheduled',
};

function formatStamp(value: string | null): string {
  if (!value) return 'Not recorded';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? 'Not recorded' : at.toLocaleString();
}

/** Last/next run and honest counters for one agent, from the server read model. */
function AgentStatusStrip({ row, loaded }: { row: AgentStatusRow | null; loaded: boolean }) {
  if (!row) return <p className="text-xs text-charcoal-muted mt-3">{loaded ? 'No status row was returned for this agent.' : 'Loading last run, next run and counters...'}</p>;
  return <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-3 text-xs border-t border-taupe/30 pt-3">
    <div><dt className="text-charcoal-muted">Last run</dt><dd className="text-charcoal">{formatStamp(row.last_run_at)}</dd></div>
    <div><dt className="text-charcoal-muted">Next run</dt><dd className="text-charcoal">{formatStamp(row.next_run_at)}</dd></div>
    <div><dt className="text-charcoal-muted">Schedule</dt><dd className="text-charcoal">{scheduleCopy[row.schedule_state]}</dd></div>
    <div><dt className="text-charcoal-muted">Last 24h</dt><dd className="text-charcoal">{row.runs_last_24h} run(s), {row.queued_actions} queued</dd></div>
    {(row.failed_runs_last_7d > 0 || row.open_incidents > 0) && <div className="col-span-2 sm:col-span-4">
      <dt className="sr-only">Needs attention</dt>
      <dd className="text-charcoal">{row.failed_runs_last_7d} failed run(s) in 7 days, {row.open_incidents} open incident(s)</dd>
    </div>}
  </dl>;
}

/** What this agent actually did, plus the incident controls for its own runs. */
function AgentTranscript({ agentKey, canResolve, onChanged }: { agentKey: string; canResolve: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AgentTranscriptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [busyIncident, setBusyIncident] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    const { data: row, error: rpcError } = await supabase.rpc('admin_ai_agent_transcript', { p_agent_key: agentKey, p_limit: 10 });
    if (rpcError) { setError(rpcError.message); setData(null); } else { setData(row as unknown as AgentTranscriptData); }
    setLoading(false);
  };

  const toggle = async () => { const next = !open; setOpen(next); if (next && !data && !loading) await load(); };

  const setIncidentStatus = async (id: string, next: 'acknowledged' | 'resolved') => {
    setBusyIncident(id); setMessage('');
    const { error: rpcError } = await supabase.rpc('admin_ai_resolve_incident', { p_id: id, p_status: next, p_resolution: note.trim() || null });
    if (rpcError) setMessage(`Refused: ${rpcError.message}`);
    else { setMessage(next === 'acknowledged' ? 'Incident acknowledged.' : 'Incident resolved.'); await load(); onChanged(); }
    setBusyIncident(null);
  };

  const openIncidents = data?.incidents.filter(i => i.status === 'open' || i.status === 'acknowledged') || [];

  return <div className="mt-3">
    <Btn variant="ghost" onClick={toggle} ariaExpanded={open} ariaControls={`transcript-${agentKey}`} icon={<FileText size={12} />} className="min-h-11">{open ? 'Hide transcript' : 'Transcript & incidents'}</Btn>
    {open && <section id={`transcript-${agentKey}`} className="mt-3 border border-taupe/30 rounded-sm p-3" aria-label={`${agentKey} job transcript and incidents`}>
      <div aria-live="polite" className="text-xs text-charcoal-muted">{message}</div>
      {loading && <p className="text-xs text-charcoal-muted mt-2">Loading transcript...</p>}
      {error && <p className="text-xs text-charcoal mt-2">Transcript unavailable: {error}</p>}
      {data && !loading && <>
        <h3 className="text-xs font-medium text-charcoal mt-2">Recent runs</h3>
        {data.jobs.length === 0
          ? <p className="text-xs text-charcoal-muted mt-1">This agent has no recorded runs yet.</p>
          : <ul className="space-y-2 mt-2">{data.jobs.map(job => <li key={job.id} className="text-xs border-b border-taupe/20 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <Severity level={job.status === 'failed' ? 'critical' : job.status === 'completed' ? 'ok' : 'info'} />
                <span className="text-charcoal">{job.status}</span>
                <span className="text-charcoal-muted">{formatStamp(job.created_at)}</span>
                <span className="text-charcoal-muted ml-auto">{job.actions_created} proposal(s){job.duration_ms === null ? '' : `, ${job.duration_ms} ms`}</span>
              </div>
              {job.error && <p className="text-charcoal mt-1">Error: {job.error}</p>}
              {job.incidents.length > 0 && <p className="text-charcoal-muted mt-1">{job.incidents.length} incident(s): {job.incidents.map(i => i.title).join('; ')}</p>}
            </li>)}</ul>}
        <h3 className="text-xs font-medium text-charcoal mt-3">Incidents from this agent</h3>
        {data.incidents.length === 0
          ? <p className="text-xs text-charcoal-muted mt-1">No incidents are linked to this agent's runs.</p>
          : <ul className="space-y-2 mt-2">{data.incidents.map(incident => <li key={incident.id} className="text-xs border-b border-taupe/20 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <Severity level={incident.severity === 'critical' ? 'critical' : incident.severity === 'warning' ? 'warning' : 'info'} />
                <span className="text-charcoal">{incident.title}</span>
                <span className="text-charcoal-muted ml-auto">{incident.status} · {formatStamp(incident.created_at)}</span>
              </div>
              <p className="text-charcoal-muted mt-1">{incident.detail}</p>
              {incident.resolution && <p className="text-charcoal-muted mt-1">Resolution: {incident.resolution}</p>}
              {(incident.status === 'open' || incident.status === 'acknowledged') && canResolve && <div className="flex flex-wrap items-center gap-2 mt-2">
                <input
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  aria-label={`Resolution note for ${incident.title}`}
                  placeholder="Resolution note (optional)"
                  className="min-h-11 border border-taupe/50 px-2 py-1 text-xs rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"
                />
                <Btn variant="ghost" busy={busyIncident === incident.id} onClick={() => setIncidentStatus(incident.id, 'acknowledged')} className="min-h-11" ariaLabel={`Acknowledge ${incident.title}`}>Acknowledge</Btn>
                <Btn busy={busyIncident === incident.id} onClick={() => setIncidentStatus(incident.id, 'resolved')} className="min-h-11" ariaLabel={`Resolve ${incident.title}`}>Resolve</Btn>
              </div>}
              {(incident.status === 'open' || incident.status === 'acknowledged') && !canResolve && <p className="text-charcoal-muted mt-1">Requires the admin.ai.incidents permission.</p>}
            </li>)}</ul>}
        {openIncidents.length > 0 && <p className="text-charcoal-muted mt-2">{openIncidents.length} incident(s) still need a decision.</p>}
      </>}
    </section>}
  </div>;
}

function Agents({ data, drafts, setDrafts, onRun, onSave, busy, canManage, canApprove, canResolveIncidents, statusRows, onIncidentsChanged }: {
  data: Tower;
  statusRows: AgentStatusRow[] | null;
  onIncidentsChanged: () => void;
  drafts: Record<string, { enabled: boolean; autonomy: Autonomy; cadence: number; max: number }>;
  setDrafts: Dispatch<SetStateAction<Record<string, { enabled: boolean; autonomy: Autonomy; cadence: number; max: number }>>>;
  onRun: (key: string) => void;
  onSave: (agent: Agent) => void;
  busy: string | null;
  canManage: boolean;
  canApprove: boolean;
  canResolveIncidents: boolean;
}) {
  const statusByKey = new Map((statusRows || []).map(row => [row.agent_key, row]));
  return <Panel title="Agent fleet" icon={<Target size={15} className="text-bronze" />}>
    {!canManage && <Notice tone="info">Agent policies are owner-managed. You can review each agent, but cannot change its pause or autonomy settings.</Notice>}
    <div className="space-y-3">
      {data.agents.map(a => {
        const d = drafts[a.agent_key] || { enabled: a.enabled, autonomy: a.autonomy_level, cadence: a.cadence_minutes, max: a.max_actions };
        const suggestionOnly = boardroomAgentKeys.has(a.agent_key);
        const options = suggestionOnly ? suggestionOnlyAutonomyOptions : autonomyOptions;
        const canRun = a.enabled && d.enabled && a.autonomy_level !== 'disabled' && d.autonomy !== 'disabled' && (a.agent_key !== 'executioner' || canApprove);
        return <div key={a.agent_key} className="border border-taupe/30 rounded-sm p-4">
          <div className="flex flex-wrap gap-3 items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-11 min-w-[44px] items-center gap-2">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    disabled={!canManage}
                    aria-label={`Enable ${a.label} agent`}
                    onChange={e => setDrafts(x => ({ ...x, [a.agent_key]: { ...d, enabled: e.target.checked } }))}
                  />
                  <span className="text-sm text-charcoal">{a.label}</span>
                </label>
                {suggestionOnly
                  ? <span className="text-[10px] uppercase tracking-wide text-blue-700">Suggestion only</span>
                  : <Severity level={d.autonomy === 'auto_apply' ? 'warning' : d.autonomy === 'disabled' ? 'critical' : 'info'} />}
              </div>
              <p className="text-xs text-charcoal-muted mt-1">{a.description}</p>
            </div>
            <select
              aria-label={`${a.label} autonomy level`}
              value={d.autonomy}
              disabled={!canManage}
              onChange={e => setDrafts(x => ({ ...x, [a.agent_key]: { ...d, autonomy: e.target.value as Autonomy } }))}
              className="min-h-11 border border-taupe/50 px-2 py-1 text-xs rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-60"
            >{options.map(x => <option key={x} value={x}>{x}</option>)}</select>
            <input
              type="number"
              min="5"
              value={d.cadence}
              disabled={!canManage}
              aria-label={`${a.label} cadence in minutes`}
              onChange={e => setDrafts(x => ({ ...x, [a.agent_key]: { ...d, cadence: Number(e.target.value) } }))}
              className="min-h-11 w-20 border border-taupe/50 px-2 py-1 text-xs rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-60"
            />
            <Btn
              variant="ghost"
              onClick={() => onRun(a.agent_key)}
              busy={busy === `agent-${a.agent_key}`}
              disabled={!canRun}
              ariaLabel={`Run ${a.label}`}
              title={a.agent_key === 'executioner' && !canApprove ? 'Requires admin.ai.approve' : undefined}
              icon={<Play size={12} />}
              className="min-h-11"
            >Run</Btn>
            <Btn
              onClick={() => onSave(a)}
              busy={busy === `save-agent-${a.agent_key}`}
              disabled={!canManage}
              ariaLabel={`Save ${a.label} policy`}
              className="min-h-11"
            >Save</Btn>
          </div>
          <AgentStatusStrip row={statusByKey.get(a.agent_key) || null} loaded={statusRows !== null} />
          <AgentTranscript agentKey={a.agent_key} canResolve={canResolveIncidents} onChanged={onIncidentsChanged} />
        </div>;
      })}
    </div>
  </Panel>;
}
const boardroomAgentKeys = new Set(['analyst','strategist','ceo','auditor','executioner','chief_of_staff']);
const suggestionOnlyAutonomyOptions: Autonomy[] = ['suggest','disabled'];
const autonomyOptions: Autonomy[] = ['observe','suggest','draft','auto_apply','approval_required','disabled'];

function Missions({ data, run }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void }) { const [title,setTitle]=useState(''); const [objective,setObjective]=useState(''); const [metric,setMetric]=useState('organic_traffic'); const [agents,setAgents]=useState('growth,seo'); const [priority,setPriority]=useState(60); const create=()=>run('mission',async()=>{const {error}=await supabase.rpc('admin_ai_create_mission',{p_title:title,p_objective:objective,p_metric:metric,p_target:null,p_deadline:null,p_agents:agents.split(',').map(x=>x.trim()).filter(Boolean),p_priority:priority});return{error:error?.message||null,text:error?'':'Mission created.'};});return <><Panel title="Create a growth mission" icon={<Target size={15} className="text-bronze" />}><div className="grid md:grid-cols-2 gap-3"><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Increase organic traffic" className="border border-taupe/50 px-3 py-2 text-sm rounded-sm"/><input value={metric} onChange={e=>setMetric(e.target.value)} placeholder="Metric key" className="border border-taupe/50 px-3 py-2 text-sm rounded-sm"/><textarea value={objective} onChange={e=>setObjective(e.target.value)} placeholder="What should the AI accomplish?" className="md:col-span-2 border border-taupe/50 px-3 py-2 text-sm rounded-sm"/><input value={agents} onChange={e=>setAgents(e.target.value)} placeholder="growth,seo" className="border border-taupe/50 px-3 py-2 text-sm rounded-sm"/><input type="number" value={priority} onChange={e=>setPriority(Number(e.target.value))} placeholder="Priority" className="border border-taupe/50 px-3 py-2 text-sm rounded-sm"/></div><Btn className="mt-3" onClick={create} disabled={!title.trim()}>Create mission</Btn></Panel><Panel title="Missions"><div className="space-y-2">{data.missions.length?data.missions.map(m=><div key={m.id} className="flex flex-wrap gap-2 items-center border-b border-taupe/20 py-3"><strong className="text-sm">{m.title}</strong><Severity level={m.status==='active'?'ok':m.status}/><span className="text-xs text-charcoal-muted">{m.objective}</span><span className="ml-auto text-xs">{m.metric_key}</span></div>):<Empty>No missions yet.</Empty>}</div></Panel></>; }

function Queue({ data, canApprove, decide, applyLegacy, dismissLegacy, busy }: { data: Tower; canApprove: boolean; decide: (id: string, decision: 'approve'|'reject'|'pause'|'apply') => void; applyLegacy: (id: string) => void; dismissLegacy: (id: string) => void; busy: string | null }) {
  const actions = [...data.queue, ...data.legacy_suggestions.map(a => ({ ...a, source: 'legacy' as const }))];
  return <Panel title="Approval and automation queue" icon={<FileText size={15} className="text-bronze" />}><div className="space-y-3">{actions.length?actions.map(a=><div key={a.id} className="border border-taupe/30 rounded-sm p-4"><div className="flex flex-wrap gap-2 items-center"><Severity level={a.risk==='critical'?'critical':a.risk==='high'?'warning':a.risk==='low'?'ok':'info'}/><strong className="text-sm">{a.title}</strong><span className="text-[10px] uppercase text-charcoal-muted ml-auto">{a.status} · {a.source ? 'legacy suggestion' : a.autonomy_level}</span></div><p className="text-xs text-charcoal-muted mt-2">{a.detail}</p><p className="text-[11px] text-charcoal-muted mt-2">Agent: {a.agent_key || 'system'} {a.required_permission && `· Requires ${a.required_permission}`}</p>{a.proposed && <pre className="mt-2 bg-gray-50 p-2 rounded text-[10px] overflow-auto max-h-24">{JSON.stringify(a.proposed,null,2)}</pre>}<div className="flex flex-wrap gap-2 mt-3">{canApprove&&a.source?<><Btn onClick={()=>applyLegacy(a.id)} busy={busy===`legacy-apply-${a.id}`} icon={<Check size={12}/>}>Approve &amp; apply</Btn><Btn variant="danger" onClick={()=>dismissLegacy(a.id)} busy={busy===`legacy-dismiss-${a.id}`} icon={<CircleSlash size={12}/>}>Dismiss</Btn></>:canApprove&&<><Btn onClick={()=>decide(a.id,'approve')} busy={busy===`approve-${a.id}`} icon={<Check size={12}/>}>Approve</Btn><Btn onClick={()=>decide(a.id,'apply')} busy={busy===`apply-${a.id}`} icon={<Play size={12}/>}>Apply now</Btn><Btn variant="danger" onClick={()=>decide(a.id,'reject')} busy={busy===`reject-${a.id}`} icon={<CircleSlash size={12}/>}>Reject</Btn><Btn variant="ghost" onClick={()=>decide(a.id,'pause')} busy={busy===`pause-${a.id}`} icon={<Pause size={12}/>}>Pause</Btn></>}</div></div>):<Empty>No pending actions. Run an agent or scan to create proposals.</Empty>}</div></Panel>;
}

function Workflows({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) { const [name,setName]=useState('Daily growth review'); const [description,setDescription]=useState('Run SEO and growth agents and send proposals to the queue.'); const [agent,setAgent]=useState('growth'); const [autonomy,setAutonomy]=useState<Autonomy>('approval_required'); const create=()=>run('workflow-create',async()=>{const {error}=await supabase.rpc('admin_ai_create_workflow',{p_name:name,p_description:description,p_trigger:'manual',p_autonomy:autonomy,p_steps:[{agent_key:agent,action_type:'inspect',requires_approval:true}]});return{error:error?.message||null,text:error?'':'Workflow created.'};});return <><Panel title="Create workflow" icon={<Play size={15} className="text-bronze" />}><div className="grid md:grid-cols-2 gap-3"><input value={name} onChange={e=>setName(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm"/><select value={agent} onChange={e=>setAgent(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm">{data.agents.map(a=><option key={a.agent_key} value={a.agent_key}>{a.label}</option>)}</select><textarea value={description} onChange={e=>setDescription(e.target.value)} className="md:col-span-2 border border-taupe/50 px-3 py-2 text-sm rounded-sm"/><select value={autonomy} onChange={e=>setAutonomy(e.target.value as Autonomy)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm">{autonomyOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></div><Btn className="mt-3" onClick={create} disabled={!name.trim()}>Create workflow</Btn></Panel><Panel title="Workflow registry"><div className="space-y-2">{data.workflows.length?data.workflows.map(w=><div key={w.id} className="flex flex-wrap items-center gap-3 border-b border-taupe/20 py-3"><strong className="text-sm">{w.name}</strong><span className="text-xs text-charcoal-muted">{w.description}</span><Severity level={w.enabled?'ok':'info'}/><span className="text-xs ml-auto">{w.run_count} runs</span><Btn variant="ghost" onClick={()=>run(`workflow-${w.id}`,async()=>{const {error}=await supabase.rpc('admin_ai_set_workflow',{p_id:w.id,p_enabled:!w.enabled});return{error:error?.message||null,text:error?'':'Workflow toggled.'};})} busy={busy===`workflow-${w.id}`}>{w.enabled?'Disable':'Enable'}</Btn><Btn onClick={()=>run(`workflow-run-${w.id}`,async()=>{const {error}=await supabase.rpc('admin_ai_run_workflow',{p_id:w.id});return{error:error?.message||null,text:error?'':'Workflow run started.'};})} busy={busy===`workflow-run-${w.id}`} disabled={!w.enabled}>Run</Btn></div>):<Empty>No workflows yet.</Empty>}</div></Panel></>; }

function Experiments({ data, run }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void }) { const [name,setName]=useState('Headline experiment'); const [metric,setMetric]=useState('click_through_rate'); const create=()=>run('experiment',async()=>{const {error}=await supabase.rpc('admin_ai_create_experiment',{p_name:name,p_hypothesis:'A clearer variant improves the target metric.',p_target_type:'site',p_target_id:null,p_metric:metric,p_variants:[{key:'control',label:'Control'},{key:'variant',label:'AI variant'}]});return{error:error?.message||null,text:error?'':'Experiment created.'};});return <><Panel title="Create controlled experiment" icon={<FlaskConical size={15} className="text-bronze" />}><div className="flex gap-2"><input value={name} onChange={e=>setName(e.target.value)} className="flex-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm"/><input value={metric} onChange={e=>setMetric(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm"/><Btn onClick={create}>Create</Btn></div></Panel><Panel title="Experiments"><div className="space-y-2">{data.experiments.length?data.experiments.map(e=><div key={e.id} className="flex gap-3 items-center border-b border-taupe/20 py-3"><strong className="text-sm">{e.name}</strong><span className="text-xs text-charcoal-muted">{e.metric_key}</span><Severity level={e.status==='running'?'ok':'info'}/><span className="ml-auto text-xs">{e.winner||'No winner yet'}</span></div>):<Empty>No experiments yet.</Empty>}</div></Panel></>; }

function Memory({ data, run }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void }) { const [key,setKey]=useState('brand.voice'); const [content,setContent]=useState('Use a calm, evidence-led editorial tone.'); const save=()=>run('memory',async()=>{const {error}=await supabase.rpc('admin_ai_upsert_memory',{p_key:key,p_category:'brand',p_content:content,p_confidence:1,p_enabled:true});return{error:error?.message||null,text:error?'':'AI memory saved.'};});return <><Panel title="Durable AI memory" icon={<Brain size={15} className="text-bronze" />}><div className="flex gap-2"><input value={key} onChange={e=>setKey(e.target.value)} placeholder="brand.voice" className="w-1/3 border border-taupe/50 px-3 py-2 text-sm rounded-sm"/><input value={content} onChange={e=>setContent(e.target.value)} className="flex-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm"/><Btn onClick={save}>Save memory</Btn></div></Panel><Panel title="Current memory"><div className="space-y-2">{data.memory.length?data.memory.map(m=><div key={m.id} className="border-b border-taupe/20 py-2"><strong className="text-xs">{m.memory_key}</strong><p className="text-sm text-charcoal-muted">{m.content}</p></div>):<Empty>No memory entries yet.</Empty>}</div></Panel></>; }

function Incidents({ data, run }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void }) { return <Panel title="Incidents and safety events" icon={<AlertTriangle size={15} className="text-bronze" />}><div className="space-y-3">{data.incidents.length?data.incidents.map(i=><div key={i.id} className="border border-taupe/30 rounded-sm p-4"><div className="flex gap-2 items-center"><Severity level={i.severity}/><strong className="text-sm">{i.title}</strong><span className="ml-auto text-xs">{i.status}</span></div><p className="text-xs text-charcoal-muted mt-2">{i.detail}</p><div className="mt-3"><Btn variant="ghost" onClick={()=>run(`incident-${i.id}`,async()=>{const {error}=await supabase.rpc('admin_ai_resolve_incident',{p_id:i.id,p_status:'resolved',p_resolution:'Reviewed in Admin AI control tower'});return{error:error?.message||null,text:error?'':'Incident resolved.'};})}>Resolve</Btn></div></div>):<Empty>No open incidents.</Empty>}</div></Panel>; }

function Settings({ data, canApprove, enabled, setEnabled, killSwitch, setKillSwitch, autonomy, setAutonomy, budget, setBudget, save, busy }: { data: Tower; canApprove: boolean; enabled: boolean; setEnabled: (v:boolean)=>void; killSwitch:boolean; setKillSwitch:(v:boolean)=>void; autonomy:Autonomy; setAutonomy:(v:Autonomy)=>void; budget:number; setBudget:(v:number)=>void; save:()=>void; busy:string|null }) { return <Panel title="Autonomy policy and guardrails" icon={<ShieldCheck size={15} className="text-bronze" />}><div className="space-y-4"><div className="flex items-center gap-3"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} disabled={!canApprove}/><span className="text-sm">Enable autonomous operating mode</span></div><div className="flex items-center gap-3"><input type="checkbox" checked={killSwitch} onChange={e=>setKillSwitch(e.target.checked)} disabled={!canApprove}/><span className="text-sm text-red-700">Emergency kill switch — pause all autonomous actions</span></div><label className="block text-xs text-charcoal-muted">Default autonomy<select value={autonomy} onChange={e=>setAutonomy(e.target.value as Autonomy)} disabled={!canApprove} className="block mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm">{autonomyOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label><label className="block text-xs text-charcoal-muted">Daily provider budget, cents<input type="number" value={budget} onChange={e=>setBudget(Number(e.target.value))} disabled={!canApprove} className="block mt-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm"/></label><p className="text-xs text-charcoal-muted">Provider: <strong>{data.settings.provider}</strong>. The current free-tier engine uses deterministic database rules. A future model must run behind an edge function and may only create proposals.</p>{canApprove&&<Btn onClick={save} busy={busy==='settings'}>Save guardrails</Btn>}</div></Panel>; }

function Strategy({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const [title, setTitle] = useState('Grow qualified organic traffic');
  const [objective, setObjective] = useState('Increase useful readership and conversion without paid spend.');
  const [metric, setMetric] = useState('organic_traffic');
  const create = () => run('goal', async () => { const { error } = await supabase.rpc('admin_ai_create_goal', { p_title: title, p_objective: objective, p_metric: metric, p_target: null, p_baseline: null, p_deadline: null, p_priority: 80, p_constraints: { no_paid_spend: true } }); return { error: error?.message || null, text: error ? '' : 'Goal created.' }; });
  return <>
    <Panel title="AI CEO strategy planner" icon={<Target size={15} className="text-bronze" />}>
      <p className="text-xs text-charcoal-muted mb-3">Turn an owner objective into a multi-agent plan: research, SEO, content, commerce, community, experiments, reliability and security review.</p>
      <div className="grid md:grid-cols-2 gap-3"><input value={title} onChange={e => setTitle(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm" placeholder="Goal title" /><input value={metric} onChange={e => setMetric(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm" placeholder="Success metric" /><textarea value={objective} onChange={e => setObjective(e.target.value)} className="md:col-span-2 border border-taupe/50 px-3 py-2 text-sm rounded-sm" /></div>
      <Btn className="mt-3" onClick={create} busy={busy === 'goal'}>Create strategic goal</Btn>
    </Panel>
    <Panel title="Goals and strategy plans"><div className="space-y-3">{data.goals.length ? data.goals.map(g => <div key={g.id} className="border border-taupe/30 rounded-sm p-4"><div className="flex flex-wrap gap-2 items-center"><strong className="text-sm">{g.title}</strong><Severity level={g.status === 'active' ? 'ok' : 'info'} /><span className="text-xs text-charcoal-muted ml-auto">{g.metric_key}</span></div><p className="text-xs text-charcoal-muted mt-1">{g.objective}</p><div className="flex gap-2 mt-3"><Btn variant="ghost" onClick={() => run(`plan-${g.id}`, async () => { const { error } = await supabase.rpc('admin_ai_generate_strategy', { p_goal_id: g.id }); return { error: error?.message || null, text: error ? '' : 'Multi-agent strategy generated.' }; })} busy={busy === `plan-${g.id}`}>Generate plan</Btn>{data.plans.filter(p => p.goal_id === g.id).map(p => <Btn key={p.id} onClick={() => run(`run-plan-${p.id}`, async () => { const { error } = await supabase.rpc('admin_ai_run_strategy', { p_plan_id: p.id }); return { error: error?.message || null, text: error ? '' : 'Strategy execution started.' }; })} busy={busy === `run-plan-${p.id}`} disabled={!p.owner_approved && p.status === 'draft'}>Run {p.title}</Btn>)}</div></div>) : <Empty>Create a goal to begin an AI strategy.</Empty>}</div></Panel>
  </>;
}

function CommandCenter({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const [command, setCommand] = useState('Find the articles losing organic traffic and prepare refresh plans.');
  const ingest = () => run('command', async () => { const { error } = await supabase.rpc('admin_ai_ingest_command', { p_command: command }); return { error: error?.message || null, text: error ? '' : 'Command interpreted and converted into a goal.' }; });
  return <><Panel title="Natural-language command centre" icon={<Sparkles size={15} className="text-bronze" />}><p className="text-xs text-charcoal-muted mb-3">Describe the outcome. The AI converts it into an intent, goal, plan and approval-aware work queue.</p><textarea value={command} onChange={e => setCommand(e.target.value)} className="w-full min-h-24 border border-taupe/50 px-3 py-2 text-sm rounded-sm" /><Btn className="mt-3" onClick={ingest} busy={busy === 'command'}>Interpret command</Btn></Panel><Panel title="Command history"><div className="space-y-2">{data.commands.length ? data.commands.map(c => <div key={c.id} className="flex flex-wrap gap-2 items-center border-b border-taupe/20 py-3"><span className="text-xs uppercase text-bronze">{c.interpreted_intent}</span><span className="text-sm text-charcoal">{c.command}</span><span className="text-xs text-charcoal-muted ml-auto">{c.status}</span><Btn variant="ghost" onClick={() => run(`replay-${c.id}`, async () => { const { error } = await supabase.rpc('admin_ai_replay_command', { p_command_id: c.id }); return { error: error?.message || null, text: error ? '' : 'Command replay created and linked to the original.' }; })} busy={busy === `replay-${c.id}`}>Replay</Btn></div>) : <Empty>No commands yet.</Empty>}</div></Panel></>;
}

function Campaigns({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const [name, setName] = useState('30-day editorial campaign'); const [topic, setTopic] = useState('Evidence-led skincare routines'); const [audience, setAudience] = useState('returning readers');
  const create = () => run('campaign', async () => { const { error } = await supabase.rpc('admin_ai_create_campaign', { p_name: name, p_topic: topic, p_audience: audience }); return { error: error?.message || null, text: error ? '' : 'Campaign created with brief, article, SEO, newsletter, social and measurement assets.' }; });
  return <><Panel title="Content campaign factory" icon={<FileText size={15} className="text-bronze" />}><div className="grid md:grid-cols-3 gap-3"><input value={name} onChange={e => setName(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm" /><input value={topic} onChange={e => setTopic(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm" /><input value={audience} onChange={e => setAudience(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm" /></div><Btn className="mt-3" onClick={create} busy={busy === 'campaign'}>Create content pack</Btn></Panel><Panel title="Campaigns"><div className="space-y-2">{data.campaigns.length ? data.campaigns.map(c => <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-taupe/20 py-3"><strong className="text-sm">{c.name}</strong><span className="text-xs text-charcoal-muted">{c.topic} · {c.audience}</span><Severity level={c.status === 'review' ? 'warning' : 'info'} /><Btn className="ml-auto" variant="ghost" onClick={() => run(`pack-${c.id}`, async () => { const { error } = await supabase.rpc('admin_ai_generate_campaign_pack', { p_campaign_id: c.id }); return { error: error?.message || null, text: error ? '' : 'Campaign assets prepared for review.' }; })} busy={busy === `pack-${c.id}`}>Generate pack</Btn></div>) : <Empty>No campaigns yet.</Empty>}</div></Panel></>;
}

function Knowledge({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<{ title: string; excerpt: string; source_type: string }[]>([]); const [segmentName, setSegmentName] = useState('Returning readers');
  const search = async () => { const { data: result } = await supabase.rpc('admin_ai_search_knowledge', { p_query: query, p_limit: 10 }); setResults((result as typeof results) || []); };
  const createSegment = () => run('segment', async () => { const { error } = await supabase.rpc('admin_ai_create_segment', { p_name: segmentName, p_description: 'Owner-defined audience segment for lifecycle proposals.', p_rule: { type: 'newsletter_subscribers' } }); return { error: error?.message || null, text: error ? '' : 'Audience segment created.' }; });
  return <><Panel title="Grounded knowledge base" icon={<Brain size={15} className="text-bronze" />}><div className="flex gap-2"><Btn onClick={() => run('reindex', async () => { const { error } = await supabase.rpc('admin_ai_reindex_knowledge'); return { error: error?.message || null, text: error ? '' : 'Articles and products reindexed.' }; })} busy={busy === 'reindex'}>Sync site knowledge</Btn><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search articles, products and memory" className="flex-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm" /><Btn onClick={search}>Search</Btn></div><div className="mt-3 space-y-2">{results.map((r, i) => <div key={`${r.title}-${i}`} className="border-b border-taupe/20 py-2"><span className="text-[10px] uppercase text-bronze">{r.source_type}</span><p className="text-sm">{r.title}</p><p className="text-xs text-charcoal-muted">{r.excerpt}</p></div>)}</div><p className="text-xs text-charcoal-muted mt-4">Indexed sources: {data.knowledge.length}. AI proposals can cite database sources instead of inventing facts.</p></Panel><Panel title="Audience and lifecycle segments" icon={<Target size={15} className="text-bronze" />}><div className="flex gap-2"><input value={segmentName} onChange={e => setSegmentName(e.target.value)} className="flex-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm" /><Btn onClick={createSegment} busy={busy === 'segment'}>Create segment</Btn></div><div className="space-y-2 mt-3">{data.segments.map(s => <div key={s.id} className="flex gap-2 text-sm"><strong>{s.name}</strong><span className="text-xs text-charcoal-muted">{s.member_count} members · {s.status}</span></div>)}</div></Panel></>;
}

function Quality({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) { return <><Panel title="AI critic and policy guardrails" icon={<ShieldCheck size={15} className="text-bronze" />}><div className="space-y-2">{data.guardrails.map(g => <div key={g.rule_key} className="flex flex-wrap items-center gap-2 border-b border-taupe/20 py-2"><strong className="text-xs">{g.rule_key}</strong><span className="text-xs text-charcoal-muted">{g.description}</span><span className="ml-auto text-xs">{String(g.value)}</span></div>)}</div></Panel><Panel title="Provider routing"><p className="text-xs text-charcoal-muted mb-3">Rules run locally. External provider routes always require approval and must be implemented through an edge function.</p><div className="space-y-2">{data.routes.map(r => <div key={r.task_type} className="flex flex-wrap items-center gap-3 border-b border-taupe/20 py-2"><strong className="text-xs w-24">{r.task_type}</strong><span className="text-xs">{r.provider}</span><span className="text-xs text-charcoal-muted">{r.model || 'deterministic rules'}</span><Btn variant="ghost" onClick={() => run(`route-${r.task_type}`, async () => { const { error } = await supabase.rpc('admin_ai_set_provider_route', { p_task: r.task_type, p_provider: 'rules', p_model: null, p_cost: 0, p_enabled: true, p_requires_approval: true }); return { error: error?.message || null, text: error ? '' : 'Route kept on safe rules provider.' }; })} busy={busy === `route-${r.task_type}`}>Use rules</Btn></div>)}</div></Panel><Panel title="Recent evaluations"><div className="space-y-2">{data.evaluations.length ? data.evaluations.map(e => <div key={e.id} className="flex gap-3 items-center border-b border-taupe/20 py-2"><Severity level={e.decision === 'pass' ? 'ok' : e.decision === 'block' ? 'critical' : 'warning'} /><span className="text-sm">Score {e.score}</span><span className="text-xs text-charcoal-muted">{e.notes}</span></div>) : <Empty>No evaluations yet. Run an action critic from the queue.</Empty>}</div></Panel></>; }

function Predictive({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const refresh = () => run('predictive-refresh', async () => { const { data: result, error } = await supabase.rpc('admin_ai_refresh_predictive'); return { error: error?.message || null, text: error ? '' : `Digital twin refreshed; ${String((result as { forecasts?: number } | null)?.forecasts || 0)} forecasts generated.` }; });
  return <><Panel title="Predictive growth loop" icon={<TrendingUp size={15} className="text-bronze" />} actions={<Btn icon={<RefreshCw size={13} />} onClick={refresh} busy={busy === 'predictive-refresh'}>Refresh forecast</Btn>}><p className="text-xs text-charcoal-muted mb-4">Deterministic forecasts use recent database observations. They produce reviewable recommendations, never silent actions.</p><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{data.forecasts.slice(0, 8).map(f => <div key={f.id} className="border border-taupe/30 rounded-sm p-3"><p className="text-[10px] uppercase text-charcoal-muted">{f.metric_key} · {f.horizon_days}d</p><p className="text-xl font-serif mt-1">{Number(f.forecast_value).toLocaleString()}</p><p className="text-xs text-charcoal-muted">from {Number(f.baseline_value).toLocaleString()} · {Math.round(f.confidence * 100)}% confidence</p></div>)}</div>{!data.forecasts.length && <Empty>Refresh the predictive loop to create the first forecast.</Empty>}</Panel><Panel title="Detected anomalies" icon={<Activity size={15} className="text-bronze" />}><div className="space-y-2">{data.anomalies.length ? data.anomalies.map(a => <div key={a.id} className="flex flex-wrap items-center gap-3 border-b border-taupe/20 py-3"><Severity level={a.severity} /><strong className="text-sm">{a.metric_key}</strong><span className="text-xs text-charcoal-muted">{a.explanation}</span><span className="ml-auto text-xs">{a.status}</span></div>) : <Empty>No open anomalies. The AI will compare new metric observations as they arrive.</Empty>}</div></Panel></>;
}

function Events({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const [eventType, setEventType] = useState(data.event_rules[0]?.event_type || 'traffic_drop');
  const [payload, setPayload] = useState('{"source":"admin"}');
  const [eventKey, setEventKey] = useState('');
  const record = () => run('event-record', async () => { let parsed: Record<string, unknown>; try { parsed = JSON.parse(payload) as Record<string, unknown>; } catch { return { error: 'Event payload must be valid JSON.', text: '' }; } const { error } = await supabase.rpc('admin_ai_record_event', { p_event_type: eventType, p_entity_type: 'admin', p_entity_id: null, p_payload: parsed, p_event_key: eventKey.trim() || null, p_source: 'admin_panel' }); return { error: error?.message || null, text: error ? '' : 'Event recorded for deterministic processing.' }; });
  const process = () => run('event-process', async () => { const { data: result, error } = await supabase.rpc('admin_ai_process_events', { p_limit: 50 }); return { error: error?.message || null, text: error ? '' : `Processed ${String((result as { processed?: number } | null)?.processed || 0)} event(s).` }; });
  return <><Panel title="Event-driven AI signal stream" icon={<Activity size={15} className="text-bronze" />} actions={<Btn icon={<Play size={13} />} onClick={process} busy={busy === 'event-process'}>Process events</Btn>}><p className="text-xs text-charcoal-muted mb-3">Events are an auditable trigger layer. They can create investigations and proposals, but cannot bypass policy or approvals.</p><div className="grid md:grid-cols-3 gap-3"><select value={eventType} onChange={e => setEventType(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm">{data.event_rules.map(r => <option key={r.event_type} value={r.event_type}>{r.label}</option>)}</select><input value={eventKey} onChange={e => setEventKey(e.target.value)} placeholder="Optional idempotency key" className="border border-taupe/50 px-3 py-2 text-sm rounded-sm" /><input value={payload} onChange={e => setPayload(e.target.value)} placeholder='{"metric":"organic_traffic"}' className="border border-taupe/50 px-3 py-2 text-sm rounded-sm" /></div><Btn className="mt-3" onClick={record} busy={busy === 'event-record'}>Record event</Btn></Panel><Panel title="Recent events"><div className="space-y-2">{data.events.length ? data.events.map(e => <div key={e.id} className="flex flex-wrap gap-2 items-center border-b border-taupe/20 py-2"><Severity level={e.status === 'failed' ? 'critical' : 'info'} /><strong className="text-xs">{e.event_type}</strong><span className="text-xs text-charcoal-muted">{JSON.stringify(e.payload).slice(0, 160)}</span><span className="ml-auto text-[10px] text-charcoal-muted">{e.status}</span></div>) : <Empty>No events recorded.</Empty>}</div></Panel></>;
}

function DigitalTwin({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const refresh = () => run('twin-refresh', async () => { const { error } = await supabase.rpc('admin_ai_refresh_digital_twin'); return { error: error?.message || null, text: error ? '' : 'Website digital twin refreshed from aggregate database facts.' }; });
  const measures = data.twin.measures || {};
  return <><Panel title="Website digital twin" icon={<Network size={15} className="text-bronze" />} actions={<Btn icon={<RefreshCw size={13} />} onClick={refresh} busy={busy === 'twin-refresh'}>Refresh twin</Btn>}><p className="text-xs text-charcoal-muted mb-4">A privacy-safe model of site health, content, commerce, subscribers and AI operations. No individual member records are exposed.</p><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">{Object.entries(measures).map(([key, value]) => <div key={key} className="border border-taupe/30 rounded-sm p-3"><p className="text-[10px] uppercase text-charcoal-muted">{key.replace(/_/g, ' ')}</p><p className="text-xl font-serif mt-1">{typeof value === 'number' ? value.toLocaleString() : String(value)}</p></div>)}</div>{!Object.keys(measures).length && <Empty>Refresh the twin to create the first site snapshot.</Empty>}</Panel><Panel title="Twin contract"><div className="grid md:grid-cols-3 gap-3 text-xs text-charcoal-muted"><p><strong className="text-charcoal">Facts:</strong> Counts and totals come from the database, not invented model context.</p><p><strong className="text-charcoal">Privacy:</strong> Lifecycle and audience data remain aggregate-only.</p><p><strong className="text-charcoal">Action:</strong> The twin informs proposals and experiments; it does not publish or transact.</p></div></Panel></>;
}

function DebateTrust({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const debate = () => run('debate', async () => { const { data: result, error } = await supabase.rpc('admin_ai_debate_queue'); return { error: error?.message || null, text: error ? '' : `Agent debate completed ${String(result || 0)} reviewer pass(es).` }; });
  return <><Panel title="Multi-agent debate and trust" icon={<GitBranch size={15} className="text-bronze" />} actions={<Btn icon={<Play size={13} />} onClick={debate} busy={busy === 'debate'}>Debate queue</Btn>}><p className="text-xs text-charcoal-muted mb-4">Security, growth and content agents review proposals independently. Critical proposals are paused for human review.</p><div className="space-y-2">{data.agent_reviews.length ? data.agent_reviews.map(r => <div key={r.id} className="flex flex-wrap gap-3 items-center border-b border-taupe/20 py-2"><Severity level={r.verdict === 'block' ? 'critical' : r.verdict === 'review' ? 'warning' : 'ok'} /><strong className="text-xs">{r.reviewer_agent}</strong><span className="text-xs">{r.verdict}</span><span className="text-xs text-charcoal-muted">{Math.round(r.confidence * 100)}% confidence</span><span className="ml-auto text-[10px] text-charcoal-muted">{r.action_id.slice(0, 8)}</span></div>) : <Empty>No agent debates yet.</Empty>}</div></Panel><Panel title="Trust scores"><div className="space-y-2">{data.trust_scores.length ? data.trust_scores.map(t => <div key={`${t.target_type}-${t.target_id}`} className="flex flex-wrap gap-3 items-center border-b border-taupe/20 py-2"><Severity level={t.risk === 'critical' ? 'critical' : t.risk === 'high' ? 'warning' : 'ok'} /><span className="text-xs">{t.target_type} · {t.target_id.slice(0, 8)}</span><strong className="text-sm">{Math.round(t.confidence * 100)}%</strong><span className="text-xs text-charcoal-muted">{t.evidence_count} evidence item(s)</span></div>) : <Empty>Trust scores appear after a queue debate.</Empty>}</div></Panel></>;
}

function Maintenance({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const scan = () => run('maintenance-scan', async () => { const { data: result, error } = await supabase.rpc('admin_ai_generate_maintenance_tasks'); return { error: error?.message || null, text: error ? '' : `Created ${String(result || 0)} maintenance proposal(s).` }; });
  const decide = (id: string, value: 'approve' | 'ignore') => run(`maintenance-${id}`, async () => { const { error } = await supabase.rpc('admin_ai_decide_maintenance', { p_task_id: id, p_decision: value }); return { error: error?.message || null, text: error ? '' : `Maintenance proposal ${value}d.` }; });
  return <Panel title="Autonomous content maintenance" icon={<RotateCcw size={15} className="text-bronze" />} actions={<Btn icon={<RefreshCw size={13} />} onClick={scan} busy={busy === 'maintenance-scan'}>Find maintenance work</Btn>}><p className="text-xs text-charcoal-muted mb-4">Stale knowledge, broken links and post-publication checks become owner-reviewed maintenance proposals.</p><div className="space-y-3">{data.maintenance_tasks.length ? data.maintenance_tasks.map(t => <div key={t.id} className="border border-taupe/30 rounded-sm p-4"><div className="flex flex-wrap gap-2 items-center"><Severity level={t.risk === 'high' ? 'warning' : 'info'} /><strong className="text-sm">{t.title}</strong><span className="ml-auto text-xs">{t.status}</span></div><p className="text-xs text-charcoal-muted mt-2">{t.detail}</p>{t.status === 'proposed' && <div className="flex gap-2 mt-3"><Btn variant="ghost" onClick={() => decide(t.id, 'ignore')} busy={busy === `maintenance-${t.id}`}>Ignore</Btn><Btn onClick={() => decide(t.id, 'approve')} busy={busy === `maintenance-${t.id}`}>Approve review</Btn></div>}</div>) : <Empty>No maintenance proposals yet.</Empty>}</div></Panel>;
}

function Lifecycle({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const refresh = () => run('lifecycle-refresh', async () => { const { data: result, error } = await supabase.rpc('admin_ai_refresh_lifecycle'); return { error: error?.message || null, text: error ? '' : `Refreshed ${String(result || 0)} privacy-safe lifecycle stages.` }; });
  return <Panel title="Customer lifecycle autopilot" icon={<Target size={15} className="text-bronze" />} actions={<Btn icon={<RefreshCw size={13} />} onClick={refresh} busy={busy === 'lifecycle-refresh'}>Refresh lifecycle</Btn>}><p className="text-xs text-charcoal-muted mb-4">Aggregate lifecycle intelligence helps propose reader journeys, re-engagement and conversion experiments without exposing member PII.</p><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{data.lifecycle.map(s => <div key={s.stage_key} className="border border-taupe/30 rounded-sm p-3"><p className="text-[10px] uppercase text-charcoal-muted">{s.stage_key.replace(/_/g, ' ')}</p><p className="text-xl font-serif mt-1">{s.member_count.toLocaleString()}</p><p className="text-[10px] text-charcoal-muted">aggregate snapshot</p></div>)}</div>{!data.lifecycle.length && <Empty>Refresh lifecycle to create aggregate stage snapshots.</Empty>}</Panel>;
}

function AISecurity({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const sweep = () => run('security-sweep', async () => { const { data: result, error } = await supabase.rpc('admin_ai_run_security_sweep'); return { error: error?.message || null, text: error ? '' : `Security sweep reviewed ${String(result || 0)} signal(s).` }; });
  const resolve = (id: string, status: 'resolved' | 'ignored') => run(`security-${id}`, async () => { const { error } = await supabase.rpc('admin_ai_resolve_security_finding', { p_finding_id: id, p_status: status }); return { error: error?.message || null, text: error ? '' : `Security finding ${status}.` }; });
  return <Panel title="AI security operations centre" icon={<ShieldCheck size={15} className="text-bronze" />} actions={<Btn variant="danger" icon={<Activity size={13} />} onClick={sweep} busy={busy === 'security-sweep'}>Run security sweep</Btn>}><p className="text-xs text-charcoal-muted mb-4">Prompt injection, secret exposure, suspicious permissions and unsafe proposals are quarantined before they can reach an external provider or apply to the site.</p><div className="space-y-3">{data.security_findings.length ? data.security_findings.map(f => <div key={f.id} className="border border-taupe/30 rounded-sm p-4"><div className="flex flex-wrap gap-2 items-center"><Severity level={f.severity} /><strong className="text-sm">{f.title}</strong><span className="ml-auto text-xs">{f.status}</span></div><p className="text-xs text-charcoal-muted mt-2">{f.detail}</p>{f.status === 'open' && <div className="flex gap-2 mt-3"><Btn variant="ghost" onClick={() => resolve(f.id, 'ignored')} busy={busy === `security-${f.id}`}>Ignore with audit</Btn><Btn onClick={() => resolve(f.id, 'resolved')} busy={busy === `security-${f.id}`}>Resolve</Btn></div>}</div>) : <Empty>No open security findings.</Empty>}</div></Panel>;
}

function Learning({ data, run, busy }: { data: Tower; run: (key: string, fn: () => Promise<{ error: string | null; text: string }>) => void; busy: string | null }) {
  const learn = () => run('learning', async () => { const { data: result, error } = await supabase.rpc('admin_ai_learn_from_outcomes'); return { error: error?.message || null, text: error ? '' : `Generated ${String(result || 0)} policy learning signal(s) for owner review.` }; });
  return <Panel title="Self-improving workflow recommendations" icon={<Brain size={15} className="text-bronze" />} actions={<Btn icon={<RefreshCw size={13} />} onClick={learn} busy={busy === 'learning'}>Evaluate outcomes</Btn>}><p className="text-xs text-charcoal-muted mb-4">The AI can recommend lower autonomy, stronger evidence or better debate coverage. It cannot rewrite its own permissions.</p><div className="space-y-3">{data.learning_signals.length ? data.learning_signals.map(s => <div key={s.id} className="border border-taupe/30 rounded-sm p-4"><div className="flex flex-wrap gap-2 items-center"><Severity level="info" /><strong className="text-sm">{s.agent_key || 'system'} · {s.signal_type}</strong><span className="ml-auto text-xs">{s.status}</span></div><p className="text-xs text-charcoal-muted mt-2">{s.outcome}</p><p className="text-sm mt-2">{s.recommendation}</p></div>) : <Empty>No learning signals yet. Run actions, review outcomes, then evaluate.</Empty>}</div></Panel>;
}
