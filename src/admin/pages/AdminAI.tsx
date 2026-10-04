import { useEffect, useState } from 'react';
import { Check, XCircle as CircleSlash, FileText as FileCheck2, MessageCircle, Play, RefreshCw, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '../../context/NavigationContext';
import { Btn, Empty, Loading, Notice, Panel, Severity, useAdminAction, useAdminRpc } from '../components/ui';

type Suggestion = {
  id: string;
  kind: 'fix' | 'growth' | 'content' | 'reply' | 'workflow';
  title: string;
  detail: string;
  priority: number;
  risk: 'low' | 'medium' | 'high';
  permission: string | null;
  action_route: string | null;
  action_label: string | null;
  fix_key: string | null;
  target_type: string | null;
  target_id: string | null;
  proposed: Record<string, unknown>;
  created_at: string;
};

type Room = {
  suggestions: Suggestion[];
  recent_runs: { id: string; kind: string; status: string; summary: Record<string, unknown>; started_at: string; finished_at?: string }[];
  policy: { auto_fix_low_risk?: boolean; auto_publish?: boolean; auto_reply?: boolean };
};

export default function AdminAI() {
  const { can } = useAuth();
  const { navigate } = useNavigation();
  const allowed = can('admin.ai.run');
  const canApprove = can('admin.ai.approve');
  const room = useAdminRpc<Room>('admin_ai_control_room', undefined, allowed);
  const action = useAdminAction();
  const [postId, setPostId] = useState('');
  const [workflow, setWorkflow] = useState('publish');
  const [workflowNote, setWorkflowNote] = useState('');
  const [commentId, setCommentId] = useState('');
  const [autoFix, setAutoFix] = useState(false);

  useEffect(() => { setAutoFix(room.data?.policy.auto_fix_low_risk === true); }, [room.data?.policy.auto_fix_low_risk]);

  const reload = room.reload;
  const runScan = () => action.run('scan', async () => {
    const { data, error } = await supabase.rpc('admin_ai_scan');
    reload();
    return { error: error?.message || null, text: error ? '' : `Scan complete — ${String((data as { suggestions?: number } | null)?.suggestions || 0)} signals checked.` };
  });
  const runAutoFix = () => action.run('auto-fix', async () => {
    const { data, error } = await supabase.rpc('admin_ai_auto_run');
    reload();
    return { error: error?.message || null, text: error ? '' : `Safe automation applied ${String((data as { applied?: number } | null)?.applied || 0)} repair(s).` };
  });
  const savePolicy = () => action.run('policy', async () => {
    const { error } = await supabase.rpc('admin_ai_set_policy', { p_auto_fix_low_risk: autoFix });
    reload();
    return { error: error?.message || null, text: error ? '' : 'Automation policy saved. High-impact actions remain approval-only.' };
  });
  const apply = (id: string) => action.run(`apply-${id}`, async () => {
    const { data, error } = await supabase.rpc('admin_ai_apply', { p_suggestion_id: id });
    reload();
    return { error: error?.message || null, text: error ? '' : String((data as { message?: string } | null)?.message || 'AI action applied.') };
  });
  const dismiss = (id: string) => action.run(`dismiss-${id}`, async () => {
    const { error } = await supabase.rpc('admin_ai_dismiss', { p_suggestion_id: id });
    reload();
    return { error: error?.message || null, text: error ? '' : 'Suggestion dismissed.' };
  });
  const queueWorkflow = () => action.run('queue-workflow', async () => {
    const { error } = await supabase.rpc('admin_ai_queue_workflow', {
      p_post_id: postId.trim(), p_action: workflow, p_note: workflowNote.trim() || null,
    });
    reload();
    return { error: error?.message || null, text: error ? '' : 'Workflow action queued for approval.' };
  });
  const draftReply = () => action.run('draft-reply', async () => {
    const { error } = await supabase.rpc('admin_ai_draft_reply', { p_comment_id: commentId.trim() });
    reload();
    return { error: error?.message || null, text: error ? '' : 'A reply draft is ready in the approval queue.' };
  });

  if (!allowed) return <Notice tone="warn">You need the <code>admin.ai.run</code> permission to open the Admin AI control room.</Notice>;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><Sparkles size={21} className="text-bronze" /> Admin AI system</h1>
          <p className="text-sm text-charcoal-muted mt-1 max-w-3xl">A database-grounded control room for growth and scale. It finds live issues, proposes editorial and community actions, and keeps high-impact work behind an explicit approval.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="ghost" icon={<RefreshCw size={13} />} onClick={reload} busy={room.loading}>Reload</Btn>
          <Btn icon={<Sparkles size={13} />} onClick={runScan} busy={action.busy === 'scan'}>Scan site</Btn>
          {canApprove && <Btn variant="ghost" icon={<Wrench size={13} />} onClick={runAutoFix} busy={action.busy === 'auto-fix'}>Auto-fix safe issues</Btn>}
        </div>
      </div>

      {action.message && <div className="mb-4"><Notice tone={action.message.tone}>{action.message.text}</Notice></div>}
      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-taupe/30 rounded-sm p-4"><p className="text-[10px] uppercase tracking-wide text-charcoal-muted">Open suggestions</p><p className="text-2xl font-serif text-charcoal mt-1">{room.data?.suggestions.length ?? '—'}</p><p className="text-xs text-charcoal-muted">Live, reviewable signals</p></div>
        <div className="bg-white border border-taupe/30 rounded-sm p-4"><p className="text-[10px] uppercase tracking-wide text-charcoal-muted">Safe automation</p><p className="text-2xl font-serif text-charcoal mt-1">{room.data?.policy.auto_fix_low_risk ? 'On' : 'Approval'}</p><p className="text-xs text-charcoal-muted">Publish and reply never run silently</p></div>
        <div className="bg-white border border-taupe/30 rounded-sm p-4"><p className="text-[10px] uppercase tracking-wide text-charcoal-muted">Guardrail</p><p className="text-2xl font-serif text-charcoal mt-1 flex items-center gap-2"><ShieldCheck size={19} className="text-green-700" /> DB</p><p className="text-xs text-charcoal-muted">RBAC and audit are server-side</p></div>
      </div>

      {room.loading ? <Loading /> : room.error ? <Notice tone="error">{room.error}</Notice> : (
        <>
          {canApprove && <Panel title="Autonomy policy" icon={<ShieldCheck size={15} className="text-bronze" />}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-sm text-charcoal">Allow low-risk maintenance repairs to run in a batch</p><p className="text-xs text-charcoal-muted mt-1">Email requeue, image URL repair, SEO backfill and ANALYZE only. Publishing, editing and replies always stay manual.</p></div>
              <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs text-charcoal"><input type="checkbox" checked={autoFix} onChange={e => setAutoFix(e.target.checked)} /> Enable safe automation</label><Btn onClick={savePolicy} busy={action.busy === 'policy'}>Save policy</Btn></div>
            </div>
          </Panel>}

          <Panel title="Suggested actions" icon={<Sparkles size={15} className="text-bronze" />}>
            {room.data?.suggestions.length ? (
              <div className="space-y-3">
                {room.data.suggestions.map(s => <SuggestionCard key={s.id} suggestion={s} canApprove={canApprove} busy={action.busy} onApply={() => apply(s.id)} onDismiss={() => dismiss(s.id)} onOpen={s.action_route ? () => navigate({ name: s.action_route } as never) : undefined} />)}
              </div>
            ) : <Empty>Run a scan to turn live health, SEO, commerce and audience signals into actions.</Empty>}
          </Panel>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="Queue a workflow action" icon={<FileCheck2 size={15} className="text-bronze" />}>
              <p className="text-xs text-charcoal-muted mb-3">Admin AI can propose approve, publish, reject or edit. Nothing changes until an admin with <code>admin.ai.approve</code> applies it.</p>
              <div className="space-y-3">
                <input value={postId} onChange={e => setPostId(e.target.value)} placeholder="Article UUID" className="w-full border border-taupe/50 px-3 py-2 text-sm rounded-sm" />
                <div className="flex gap-2"><select value={workflow} onChange={e => setWorkflow(e.target.value)} className="border border-taupe/50 px-3 py-2 text-sm rounded-sm"><option value="publish">Publish</option><option value="approve">Approve</option><option value="reject">Reject</option><option value="edit">Edit review</option></select><input value={workflowNote} onChange={e => setWorkflowNote(e.target.value)} placeholder="Optional review note" className="flex-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm" /></div>
                <Btn icon={<Play size={13} />} onClick={queueWorkflow} busy={action.busy === 'queue-workflow'} disabled={!postId.trim()}>Queue for approval</Btn>
              </div>
            </Panel>
            <Panel title="Draft a community reply" icon={<MessageCircle size={15} className="text-bronze" />}>
              <p className="text-xs text-charcoal-muted mb-3">Give a comment UUID to create a short, context-aware reply draft. The AI never posts it automatically.</p>
              <div className="flex gap-2"><input value={commentId} onChange={e => setCommentId(e.target.value)} placeholder="Comment UUID" className="flex-1 border border-taupe/50 px-3 py-2 text-sm rounded-sm" /><Btn icon={<MessageCircle size={13} />} onClick={draftReply} busy={action.busy === 'draft-reply'} disabled={!commentId.trim()}>Draft reply</Btn></div>
            </Panel>
          </div>

          <Panel title="Recent AI runs" icon={<Sparkles size={15} className="text-bronze" />}>
            {!room.data?.recent_runs.length ? <Empty>No runs yet.</Empty> : <div className="divide-y divide-taupe/20">{room.data.recent_runs.map(r => <div key={r.id} className="py-2.5 flex items-center justify-between gap-3 text-xs"><span className="text-charcoal capitalize">{r.kind.replace('_', ' ')}</span><span className={r.status === 'completed' ? 'text-green-700' : r.status === 'failed' ? 'text-red-700' : 'text-charcoal-muted'}>{r.status}</span><time className="text-charcoal-muted">{new Date(r.started_at).toLocaleString()}</time></div>)}</div>}
          </Panel>
        </>
      )}
    </div>
  );
}

function SuggestionCard({ suggestion: s, canApprove, busy, onApply, onDismiss, onOpen }: { suggestion: Suggestion; canApprove: boolean; busy: string | null; onApply: () => void; onDismiss: () => void; onOpen?: () => void }) {
  const proposedBody = typeof s.proposed?.body === 'string' ? s.proposed.body : null;
  return <div className="border border-taupe/30 rounded-sm p-4">
    <div className="flex flex-wrap items-center gap-2 mb-1.5"><Severity level={s.risk === 'high' ? 'critical' : s.risk === 'medium' ? 'warning' : 'info'} /><span className="text-sm font-medium text-charcoal">{s.title}</span><span className="text-[10px] text-charcoal-muted uppercase tracking-wide">priority {s.priority}</span><span className="text-[10px] text-charcoal-muted uppercase tracking-wide ml-auto">{s.kind}</span></div>
    <p className="text-xs text-charcoal-light">{s.detail}</p>
    {proposedBody && <blockquote className="mt-2 border-l-2 border-gray-200 pl-3 text-xs text-charcoal-muted italic">{proposedBody}</blockquote>}
    <div className="flex flex-wrap gap-2 mt-3"><Btn onClick={onApply} busy={busy === `apply-${s.id}`} disabled={!canApprove} icon={<Check size={12} />}>Approve &amp; apply</Btn><Btn variant="ghost" onClick={onDismiss} busy={busy === `dismiss-${s.id}`} disabled={!canApprove} icon={<CircleSlash size={12} />}>Dismiss</Btn>{onOpen && <Btn variant="ghost" onClick={onOpen}>Open context</Btn>}</div>
  </div>;
}
