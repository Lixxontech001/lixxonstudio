import { Lightbulb, Wrench, ArrowRight, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '../../context/NavigationContext';
import { Panel, Btn, Notice, Severity, useAdminRpc, useAdminAction, Loading, Empty } from '../components/ui';

type Suggestion = {
  title: string; impact: 'critical' | 'high' | 'medium' | 'low'; score: number; detail: string;
  action_route: string | null; action_label: string | null; fix_key: string | null; permission: string | null;
};

export default function AdminAdvisor() {
  const { can } = useAuth();
  const { navigate } = useNavigation();
  const suggestions = useAdminRpc<Suggestion[]>('admin_suggestions');
  const action = useAdminAction();

  const runFix = (s: Suggestion) => action.run(`fix-${s.fix_key}`, async () => {
    const { data, error } = await supabase.rpc('admin_fix_issue', { p_key: s.fix_key });
    suggestions.reload();
    const message = (data as { message?: string } | null)?.message;
    return { error: error?.message || null, text: message || 'Repair applied.' };
  });

  const list = suggestions.data || [];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl text-charcoal flex items-center gap-2"><Lightbulb size={20} className="text-bronze" /> Advisor</h1>
          <p className="text-sm text-charcoal-muted mt-1">
            Prioritised suggestions computed from the live database — what is broken first, then what grows the site. Nothing here is generic advice: every line comes from a real row.
          </p>
        </div>
        <Btn variant="ghost" icon={<RefreshCw size={13} />} onClick={suggestions.reload} busy={suggestions.loading}>Recompute</Btn>
      </div>

      {action.message && <div className="mb-4"><Notice tone={action.message.tone}>{action.message.text}</Notice></div>}

      {suggestions.loading ? <Loading /> : suggestions.error ? <Notice tone="error">{suggestions.error}</Notice> : list.length === 0 ? (
        <Empty>Nothing needs attention right now. Check back after the next scan.</Empty>
      ) : (
        <div className="space-y-3">
          {list.map(s => {
            const allowedByPermission = !s.permission || can(s.permission);
            return (
              <Panel key={s.title} className="mb-0!">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <Severity level={s.impact} />
                  <span className="text-sm font-medium text-charcoal">{s.title}</span>
                  <span className="text-[10px] text-charcoal-muted uppercase tracking-wide">priority {s.score}</span>
                </div>
                <p className="text-xs text-charcoal-light">{s.detail}</p>
                {!allowedByPermission && <p className="text-[11px] text-amber-700 mt-2">Needs the <code>{s.permission}</code> permission.</p>}
                <div className="flex gap-2 mt-3">
                  {s.fix_key && allowedByPermission && (
                    <Btn variant="ghost" icon={<Wrench size={12} />} busy={action.busy === `fix-${s.fix_key}`} onClick={() => runFix(s)}>Fix now</Btn>
                  )}
                  {s.action_route && (
                    <Btn variant="ghost" icon={<ArrowRight size={12} />} onClick={() => navigate({ name: s.action_route } as never)}>{s.action_label || 'Open'}</Btn>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
