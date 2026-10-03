import { Activity, Loader2 } from 'lucide-react';
import { useAdminActivityLog } from '../../hooks/usePlatform';

export default function AdminActivityLog() {
  const { logs, loading } = useAdminActivityLog();

  return (
    <div>
      <h1 className="font-serif text-2xl text-charcoal mb-1">Activity Log</h1>
      <p className="text-sm text-charcoal-muted mb-6">Recent admin actions.</p>

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No activity recorded yet.</div>
      ) : (
        <div className="bg-white rounded-sm border border-taupe/30 overflow-hidden">
          <div className="divide-y divide-taupe/20">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 px-5 py-3">
                <Activity size={14} className="text-bronze mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-charcoal">
                    <span className="font-medium">{log.action}</span>
                    {log.entity_type && <span className="text-charcoal-muted"> on {log.entity_type}</span>}
                  </p>
                  {log.description && <p className="text-xs text-charcoal-muted mt-0.5">{log.description}</p>}
                </div>
                <span className="text-xs text-charcoal-muted flex-shrink-0">{new Date(log.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
