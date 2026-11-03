import { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare, Bug, Lightbulb, Heart, HelpCircle, Star,
  Trash2, Check, Archive, Mail, ExternalLink, RefreshCw,
  Clock, Monitor, Save
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import type { SiteFeedback, FeedbackStatus, FeedbackCategory } from '../../types/feedback';

const STATUS_TABS: { label: string; value: 'all' | FeedbackStatus }[] = [
  { label: 'All Messages', value: 'all' },
  { label: 'Unread', value: 'unread' },
  { label: 'Under Review', value: 'under_review' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Archived', value: 'archived' },
];

export default function AdminFeedback() {
  const [feedbackList, setFeedbackList] = useState<SiteFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | FeedbackStatus>('all');
  const [notesState, setNotesState] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('site_feedback')
        .select('*')
        .order('created_at', { ascending: false });

      if (activeTab !== 'all') {
        query = query.eq('status', activeTab);
      }

      const { data, error } = await query;

      if (!error && Array.isArray(data)) {
        setFeedbackList(data as SiteFeedback[]);
        // Initialize note editing state
        const notesMap: Record<string, string> = {};
        for (const item of data) {
          notesMap[item.id] = item.admin_notes || '';
        }
        setNotesState(notesMap);
      } else {
        // Fallback to user_feedback if site_feedback is empty or migration pending
        const { data: legacyData } = await supabase
          .from('user_feedback')
          .select('*')
          .order('created_at', { ascending: false });

        if (Array.isArray(legacyData)) {
          const mapped: SiteFeedback[] = legacyData.map(l => ({
            id: l.id,
            category:
              l.type === 'praise'
                ? 'Praise'
                : l.type === 'bug'
                ? 'Bug / Issue'
                : l.type === 'suggestion'
                ? 'General Idea'
                : 'Question',
            message: l.message,
            rating: 5,
            name: '',
            email: l.email || '',
            page_url: l.page_url || '',
            viewport: '',
            status: 'unread',
            admin_notes: '',
            created_at: l.created_at,
          }));
          setFeedbackList(mapped);
        }
      }
    } catch (err) {
      console.error('[AdminFeedback] error loading:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  const handleUpdateStatus = async (id: string, newStatus: FeedbackStatus) => {
    try {
      await supabase.from('site_feedback').update({ status: newStatus }).eq('id', id);
      setFeedbackList(prev =>
        prev.map(item => (item.id === id ? { ...item, status: newStatus } : item))
      );
      showNotification(`Feedback marked as ${newStatus.replace('_', ' ')}`);
    } catch {
      showNotification('Could not update status');
    }
  };

  const handleSaveNotes = async (id: string) => {
    const note = notesState[id] || '';
    try {
      await supabase.from('site_feedback').update({ admin_notes: note }).eq('id', id);
      showNotification('Internal note saved');
    } catch {
      showNotification('Failed to save note');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Permanently delete this feedback item?')) return;
    try {
      await supabase.from('site_feedback').delete().eq('id', id);
      await supabase.from('user_feedback').delete().eq('id', id);
      setFeedbackList(prev => prev.filter(f => f.id !== id));
      showNotification('Feedback deleted');
    } catch {
      showNotification('Delete failed');
    }
  };

  const getCategoryBadge = (cat: FeedbackCategory) => {
    switch (cat) {
      case 'Praise':
        return { icon: Heart, color: 'bg-green-100 text-green-800' };
      case 'Bug / Issue':
        return { icon: Bug, color: 'bg-red-100 text-red-800' };
      case 'Question':
        return { icon: HelpCircle, color: 'bg-blue-100 text-blue-800' };
      case 'General Idea':
      default:
        return { icon: Lightbulb, color: 'bg-amber-100 text-amber-800' };
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white px-4 py-2.5 rounded-sm shadow-lg text-xs tracking-wide">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare size={22} className="text-bronze" />
            <h1 className="font-serif text-2xl sm:text-3xl text-charcoal">Feedback Desk &amp; Resolution Inbox</h1>
          </div>
          <p className="text-sm text-charcoal-muted mt-1">
            Review reader inquiries, praise, bug reports, and track resolutions.
          </p>
        </div>

        <button
          onClick={loadFeedback}
          className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-sm hover:bg-gray-50 text-gray-700 text-xs tracking-editorial uppercase transition-colors"
          aria-label="Refresh feedback"
        >
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2 text-xs tracking-editorial uppercase font-medium rounded-sm transition-all ${
              activeTab === tab.value
                ? 'bg-charcoal text-white shadow-xs'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Feedback Items List */}
      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading reader feedback...</div>
      ) : feedbackList.length === 0 ? (
        <div className="py-20 text-center bg-white border border-gray-200 rounded-sm p-8">
          <MessageSquare size={32} className="mx-auto text-gray-400 mb-3" />
          <p className="text-sm text-gray-500">No feedback entries found in this view.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {feedbackList.map(item => {
            const badge = getCategoryBadge(item.category);
            const BadgeIcon = badge.icon;
            const replySubject = encodeURIComponent(`Regarding your feedback on Lixxon Studio`);
            const replyBody = encodeURIComponent(
              `Hi ${item.name || 'there'},\n\nThank you for reaching out with your feedback regarding: "${item.message.slice(0, 80)}..."\n\n`
            );
            const mailtoUrl = `mailto:${item.email}?subject=${replySubject}&body=${replyBody}`;

            return (
              <div
                key={item.id}
                className="bg-white rounded-sm border border-gray-200 p-6 shadow-xs hover:border-bronze/40 transition-colors"
              >
                {/* Top Meta Line */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 border-b border-gray-100 pb-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-editorial ${badge.color}`}
                    >
                      <BadgeIcon size={12} />
                      {item.category}
                    </span>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-editorial font-bold ${
                        item.status === 'unread'
                          ? 'bg-amber-100 text-amber-800'
                          : item.status === 'under_review'
                          ? 'bg-blue-100 text-blue-800'
                          : item.status === 'resolved'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {item.status.replace('_', ' ')}
                    </span>

                    {/* Star rating */}
                    {item.rating > 0 && (
                      <div className="inline-flex items-center gap-1 text-amber-500">
                        {[...Array(item.rating)].map((_, i) => (
                          <Star key={i} size={12} className="fill-amber-500" />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Clock size={13} />
                    <span>{new Date(item.created_at).toLocaleString()}</span>
                  </div>
                </div>

                {/* Message Body */}
                <p className="text-sm text-gray-800 leading-relaxed mb-4 whitespace-pre-wrap">
                  {item.message}
                </p>

                {/* Submitter & Environment Details */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 bg-gray-50 p-3 rounded-sm border border-gray-100 mb-4">
                  {item.name && (
                    <div>
                      Sender: <strong className="text-gray-700">{item.name}</strong>
                    </div>
                  )}
                  {item.email && (
                    <div className="flex items-center gap-1">
                      Email: <strong className="text-gray-700">{item.email}</strong>
                    </div>
                  )}
                  {item.page_url && (
                    <div className="flex items-center gap-1 truncate max-w-xs">
                      Page:
                      <a
                        href={item.page_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-bronze hover:underline truncate"
                      >
                        {item.page_url}
                      </a>
                      <ExternalLink size={11} className="text-bronze flex-shrink-0" />
                    </div>
                  )}
                  {item.viewport && (
                    <div className="flex items-center gap-1">
                      <Monitor size={12} />
                      <span>{item.viewport}</span>
                    </div>
                  )}
                </div>

                {/* Internal Notes Box & Action Buttons */}
                <div className="grid sm:grid-cols-2 gap-4 items-end">
                  {/* Internal Notes */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-editorial font-semibold text-gray-500 mb-1">
                      Internal Admin Notes
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={notesState[item.id] || ''}
                        onChange={e =>
                          setNotesState({ ...notesState, [item.id]: e.target.value })
                        }
                        placeholder="Resolution notes, bug ticket #, or follow-up details..."
                        className="flex-1 border border-gray-300 p-2 text-xs rounded-sm focus:border-bronze focus:outline-none"
                      />
                      <button
                        onClick={() => handleSaveNotes(item.id)}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-sm flex items-center gap-1"
                        title="Save internal note"
                      >
                        <Save size={13} />
                        <span>Save</span>
                      </button>
                    </div>
                  </div>

                  {/* Actions & Status Transitions */}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {/* Reply via email shortcut */}
                    {item.email && (
                      <a
                        href={mailtoUrl}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-colors shadow-xs"
                      >
                        <Mail size={13} />
                        <span>Reply via Mail</span>
                      </a>
                    )}

                    {/* Status Actions */}
                    {item.status !== 'resolved' && (
                      <button
                        onClick={() => handleUpdateStatus(item.id, 'resolved')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 text-xs font-medium rounded-sm hover:bg-green-100 transition-colors"
                      >
                        <Check size={13} />
                        <span>Resolve</span>
                      </button>
                    )}

                    {item.status !== 'under_review' && (
                      <button
                        onClick={() => handleUpdateStatus(item.id, 'under_review')}
                        className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-sm hover:bg-gray-200 transition-colors"
                      >
                        Flag Review
                      </button>
                    )}

                    {item.status !== 'archived' && (
                      <button
                        onClick={() => handleUpdateStatus(item.id, 'archived')}
                        className="p-1.5 text-gray-400 hover:text-gray-700 rounded-sm"
                        title="Archive feedback"
                      >
                        <Archive size={15} />
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-sm"
                      title="Delete feedback"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
