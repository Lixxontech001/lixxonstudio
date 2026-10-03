import {MessageSquare, Trash2, Bug, Lightbulb, Heart} from 'lucide-react';
import { useAdminFeedback } from '../../hooks/usePlatform';

const TYPE_ICONS: Record<string, typeof MessageSquare> = {
  general: MessageSquare,
  bug: Bug,
  suggestion: Lightbulb,
  praise: Heart,
};

const TYPE_COLORS: Record<string, string> = {
  general: 'text-charcoal-muted',
  bug: 'text-red-500',
  suggestion: 'text-amber-500',
  praise: 'text-green-500',
};

export default function AdminFeedback() {
  const { feedback, loading, remove } = useAdminFeedback();

  return (
    <div>
      <h1 className="font-serif text-2xl text-charcoal mb-1">User Feedback</h1>
      <p className="text-sm text-charcoal-muted mb-6">Feedback submitted by readers via the feedback widget.</p>

      {loading ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">Loading...</div>
      ) : feedback.length === 0 ? (
        <div className="text-center py-12 text-charcoal-muted text-sm">No feedback yet.</div>
      ) : (
        <div className="space-y-3">
          {feedback.map(f => {
            const Icon = TYPE_ICONS[f.type] || MessageSquare;
            const color = TYPE_COLORS[f.type] || 'text-charcoal-muted';
            return (
              <div key={f.id} className="bg-white rounded-sm border border-taupe/30 p-5 group">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon size={14} className={color} />
                    <span className={`text-xs uppercase tracking-wide ${color}`}>{f.type}</span>
                  </div>
                  <button onClick={() => remove(f.id)} className="text-charcoal-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-sm text-charcoal leading-relaxed mb-2">{f.message}</p>
                <div className="flex items-center gap-4 text-xs text-charcoal-muted">
                  {f.email && <span>{f.email}</span>}
                  {f.page_url && <a href={f.page_url} target="_blank" rel="noopener noreferrer" className="truncate hover:text-bronze">{f.page_url}</a>}
                  <span className="ml-auto">{new Date(f.created_at).toLocaleString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
