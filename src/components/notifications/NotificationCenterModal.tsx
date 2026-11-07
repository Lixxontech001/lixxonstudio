import { useState, useMemo } from 'react';
import {
  Bell, BellRing, Check, CheckCheck, ExternalLink, Sparkles, X, Smartphone,
  Flame, BookOpen, Clock, ShieldCheck
} from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import { useNavigation } from '../../context/NavigationContext';
import type { BroadcastNotification } from '../../types/notifications';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationCenterModal({ isOpen, onClose }: NotificationCenterModalProps) {
  const {
    notifications,
    unreadCount,
    loading,
    isSubscribed,
    subscribing,
    subscribeToPush,
    markAsRead,
    markAllAsRead,
    recordClick,
  } = useNotifications();

  const { navigate } = useNavigation();
  const [filter, setFilter] = useState<'all' | 'unread' | 'editorial' | 'breaking' | 'vault'>('all');

  const filtered = useMemo(() => {
    return notifications.filter(n => {
      if (filter === 'unread') return true;
      if (filter === 'editorial') return n.category === 'editorial';
      if (filter === 'breaking') return n.category === 'breaking';
      if (filter === 'vault') return n.category === 'vault';
      return true;
    });
  }, [notifications, filter]);

  if (!isOpen) return null;

  const handleActionClick = (notif: BroadcastNotification) => {
    recordClick(notif.id, notif.action_url);
    onClose();

    const target = notif.action_url || '/';

    // Handle functional action triggers
    if (target.startsWith('fn:')) {
      const fnName = target.replace('fn:', '');
      if (fnName === 'enable_notifications') {
        subscribeToPush();
        return;
      }
      if (fnName === 'open_salon') {
        navigate({ name: 'salon' as never });
        return;
      }
      if (fnName === 'open_search') {
        window.dispatchEvent(new CustomEvent('lixxon:open_search'));
        return;
      }
      if (fnName.startsWith('copy_promo_code:')) {
        const code = fnName.replace('copy_promo_code:', '');
        if (navigator?.clipboard) {
          navigator.clipboard.writeText(code);
          alert(`Exclusive code "${code}" copied to your clipboard!`);
        }
        return;
      }
      if (fnName === 'open_formulation_analyzer') {
        navigate({ name: 'formulation' as never });
        return;
      }
    }

    // Determine target route or external
    if (target.startsWith('http')) {
      window.open(target, '_blank', 'noopener,noreferrer');
    } else if (target === '/trending') {
      navigate({ name: 'trending' });
    } else if (target === '/salon') {
      navigate({ name: 'salon' as never });
    } else if (target === '/vault') {
      navigate({ name: 'vault' });
    } else if (target === '/shop') {
      navigate({ name: 'shop' });
    } else if (target.startsWith('/article/')) {
      const slug = target.replace('/article/', '').split('?')[0];
      navigate({ name: 'article', slug });
    } else {
      window.location.href = target;
    }
  };

  const getCategoryBadge = (cat: BroadcastNotification['category']) => {
    switch (cat) {
      case 'breaking':
        return <span className="bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-[9px] uppercase tracking-editorial px-2 py-0.5 rounded-full font-medium flex items-center gap-1"><Flame size={10} /> Breaking</span>;
      case 'vault':
        return <span className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 text-[9px] uppercase tracking-editorial px-2 py-0.5 rounded-full font-medium flex items-center gap-1"><Sparkles size={10} /> Vault Exclusive</span>;
      case 'drop':
        return <span className="bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20 text-[9px] uppercase tracking-editorial px-2 py-0.5 rounded-full font-medium flex items-center gap-1">Studio Drop</span>;
      default:
        return <span className="bg-bronze/10 text-bronze border border-bronze/20 text-[9px] uppercase tracking-editorial px-2 py-0.5 rounded-full font-medium flex items-center gap-1"><BookOpen size={10} /> Editorial</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-charcoal/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Box */}
      <div className="relative w-full max-w-lg bg-white dark:bg-[#1E1E1E] rounded-sm shadow-2xl border border-taupe/40 dark:border-white/10 overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-taupe/30 dark:border-white/10 flex items-center justify-between bg-porcelain dark:bg-[#181818]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-bronze/10 text-bronze flex items-center justify-center flex-shrink-0">
              <BellRing size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-xl text-charcoal dark:text-white font-normal">
                  Notifications
                </h2>
                {unreadCount > 0 && (
                  <span className="bg-bronze text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <p className="text-xs text-charcoal-muted dark:text-white/50">
                Editorial dispatches, breaking updates, and salon drops
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-[11px] text-bronze hover:underline font-medium flex items-center gap-1"
                title="Mark all as read"
              >
                <CheckCheck size={13} />
                <span className="hidden sm:inline">Mark all read</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-charcoal-muted hover:text-charcoal dark:text-white/60 dark:hover:text-white transition-colors"
              aria-label="Close notifications"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Web Push Subscription Banner */}
        {!isSubscribed && (
          <div className="bg-gradient-to-r from-bronze/10 via-taupe-light/40 to-bronze/10 dark:from-bronze/20 dark:to-white/5 p-4 border-b border-taupe/30 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Smartphone size={18} className="text-bronze flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-charcoal dark:text-white">
                  Get Phone &amp; Desktop Alerts
                </p>
                <p className="text-[11px] text-charcoal-muted dark:text-white/60">
                  Receive breaking stories &amp; daily reset dispatches directly
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={subscribeToPush}
              disabled={subscribing}
              className="w-full sm:w-auto text-center px-3.5 py-2 sm:py-1.5 bg-bronze text-white text-[11px] tracking-editorial uppercase font-semibold rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50 flex-shrink-0 shadow-xs"
            >
              {subscribing ? 'Connecting...' : 'Enable Alerts'}
            </button>
          </div>
        )}

        {isSubscribed && (
          <div className="bg-emerald-50 dark:bg-emerald-950/20 px-4 py-2 border-b border-emerald-200 dark:border-emerald-800/30 flex items-center justify-between text-[11px] text-emerald-800 dark:text-emerald-300">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-emerald-600" /> Web Push is active on this device
            </span>
            <span className="text-[10px] uppercase tracking-editorial font-mono opacity-80">Synced</span>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-taupe/20 dark:border-white/5 bg-white dark:bg-[#1E1E1E] overflow-x-auto text-xs">
          {(['all', 'editorial', 'breaking', 'vault'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1 rounded-full text-[11px] font-medium tracking-editorial uppercase transition-all capitalize ${
                filter === tab
                  ? 'bg-charcoal text-white dark:bg-white dark:text-charcoal'
                  : 'text-charcoal-muted hover:text-charcoal dark:text-white/60 dark:hover:text-white'
              }`}
            >
              {tab === 'all' ? 'All Alerts' : tab}
            </button>
          ))}
        </div>

        {/* Notifications List */}
        <div className="overflow-y-auto divide-y divide-taupe/20 dark:divide-white/5 flex-1 p-2">
          {loading ? (
            <div className="p-6 space-y-4">
              {[0, 1, 2].map(i => (
                <div key={i} className="skeleton h-20 rounded-sm" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center px-6">
              <Bell size={36} strokeWidth={1.2} className="text-bronze/40 mx-auto mb-3" />
              <h3 className="font-serif text-lg text-charcoal dark:text-white font-normal mb-1">
                You're all caught up
              </h3>
              <p className="text-xs text-charcoal-muted dark:text-white/50 max-w-xs mx-auto">
                New editorial releases and salon announcements will appear here.
              </p>
            </div>
          ) : (
            filtered.map(item => (
              <div
                key={item.id}
                className="p-4 hover:bg-taupe-light/30 dark:hover:bg-white/5 transition-colors rounded-sm group relative"
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-2">
                    {getCategoryBadge(item.category)}
                    <span className="text-[10px] text-charcoal-muted dark:text-white/40 flex items-center gap-1 font-mono">
                      <Clock size={10} />
                      {new Date(item.sent_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => markAsRead(item.id)}
                    className="text-[10px] text-charcoal-muted hover:text-bronze dark:text-white/40 dark:hover:text-bronze-light transition-colors"
                    title="Mark read"
                  >
                    <Check size={14} />
                  </button>
                </div>

                <h4 className="font-serif text-base text-charcoal dark:text-white font-medium leading-snug mb-1">
                  {item.title}
                </h4>

                <p className="text-xs text-charcoal-muted dark:text-white/70 leading-relaxed mb-3">
                  {item.body}
                </p>

                {item.action_url && (
                  <button
                    type="button"
                    onClick={() => handleActionClick(item)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-taupe-light/80 dark:bg-white/10 text-charcoal dark:text-white text-[11px] font-medium tracking-editorial uppercase rounded-sm hover:bg-bronze hover:text-white transition-all duration-300"
                  >
                    <span>View Story</span>
                    <ExternalLink size={11} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-porcelain dark:bg-[#181818] border-t border-taupe/30 dark:border-white/10 text-center">
          <p className="text-[10px] tracking-editorial uppercase text-charcoal-muted dark:text-white/40">
            Lixxon Studio · Real-time Reader Dispatch Engine
          </p>
        </div>
      </div>
    </div>
  );
}
