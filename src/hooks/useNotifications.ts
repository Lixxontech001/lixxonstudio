import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { BroadcastNotification, ReaderPushSubscription } from '../types/notifications';
import { urlBase64ToUint8Array, getOrCreateDeviceId, describeDevice } from '../lib/webPushClient';
import { getFingerprint } from './useFeatures';

const READ_STORAGE_KEY = 'lixxon_read_notifications_v1';
const PUSH_SUB_KEY = 'lixxon_push_subscribed_v1';

// Default standard public VAPID applicationServerKey (can be overridden by VITE_VAPID_PUBLIC_KEY)
const FALLBACK_VAPID_PUBLIC = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

export function useNotifications() {
  const [notifications, setNotifications] = useState<BroadcastNotification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(READ_STORAGE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  });
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PUSH_SUB_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const permission: NotificationPermission | 'unsupported' = useMemo(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }, []);

  // Fetch sent broadcast notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('broadcast_notifications')
        .select('*')
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(30);

      if (!error && data) {
        setNotifications(data as BroadcastNotification[]);
      }
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();

    // Listen for realtime broadcasts defensively
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      if (supabase && typeof supabase.channel === 'function') {
        channel = supabase
          .channel('broadcast-notifications-realtime')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'broadcast_notifications' },
            () => {
              fetchNotifications();
            }
          )
          .subscribe();
      }
    } catch {
      // Realtime connection optional
    }

    return () => {
      try {
        if (channel && supabase && typeof supabase.removeChannel === 'function') {
          supabase.removeChannel(channel);
        }
      } catch {
        // Ignore
      }
    };
  }, [fetchNotifications]);

  // Check existing push subscription on service worker defensively
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      try {
        navigator.serviceWorker.ready
          .then(async reg => {
            if (!reg || !reg.pushManager) return;
            const sub = await reg.pushManager.getSubscription();
            setIsSubscribed(Boolean(sub));
            try {
              localStorage.setItem(PUSH_SUB_KEY, sub ? 'true' : 'false');
            } catch {
              // Ignore
            }
          })
          .catch(() => undefined);
      } catch {
        // Ignore
      }
    }
  }, []);

  const unreadCount = useMemo(() => {
    if (!Array.isArray(notifications)) return 0;
    return notifications.filter(n => n && n.id && !readIds.has(n.id)).length;
  }, [notifications, readIds]);

  const markAsRead = useCallback((id: string) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // Ignore
      }
      return next;
    });

    // Record read metric in supabase
    const fp = getFingerprint();
    supabase.rpc('increment_notification_metric', { notif_id: id, metric: 'read' })
      .then(null, () => {
        supabase.from('notification_engagements').insert({
          notification_id: id,
          device_fingerprint: fp,
          read_at: new Date().toISOString(),
        }).then(null, () => undefined);
      });
  }, []);

  const markAllAsRead = useCallback(() => {
    const allIds = new Set(notifications.map(n => n.id));
    setReadIds(allIds);
    try {
      localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(allIds)));
    } catch {
      // Ignore
    }
  }, [notifications]);

  const recordClick = useCallback((id: string, actionUrl: string) => {
    markAsRead(id);
    const fp = getFingerprint();
    supabase.from('notification_engagements').insert({
      notification_id: id,
      device_fingerprint: fp,
      clicked_at: new Date().toISOString(),
      action_taken: actionUrl,
    }).then(null, () => undefined);
  }, [markAsRead]);

  // Subscribe browser / phone to Web Push Notifications
  const subscribeToPush = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Push notifications are not supported on this browser or platform.');
      return false;
    }

    setSubscribing(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setSubscribing(false);
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      const vapidPublic = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string) || FALLBACK_VAPID_PUBLIC;
      const appServerKey = urlBase64ToUint8Array(vapidPublic);

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey || undefined,
        });
      }

      if (!sub) {
        setSubscribing(false);
        return false;
      }

      const json = sub.toJSON();
      const endpoint = sub.endpoint;
      const p256dh = json.keys?.p256dh || '';
      const authKey = json.keys?.auth || '';
      const deviceId = getOrCreateDeviceId(localStorage);
      const userAgent = navigator.userAgent;
      const deviceType = /iphone|ipad|ipod|android/i.test(userAgent) ? 'mobile' : 'desktop';

      const { data: userSession } = await supabase.auth.getUser();

      // Upsert into reader_push_subscriptions
      const payload: ReaderPushSubscription = {
        endpoint,
        p256dh,
        auth_key: authKey,
        device_fingerprint: deviceId,
        device_type: deviceType,
        user_agent: describeDevice(userAgent),
        user_id: userSession.user?.id || null,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      };

      await supabase
        .from('reader_push_subscriptions')
        .upsert(payload, { onConflict: 'endpoint' });

      setIsSubscribed(true);
      try {
        localStorage.setItem(PUSH_SUB_KEY, 'true');
      } catch {
        // Ignore
      }

      // Show welcome toast notification
      if (reg.showNotification) {
        reg.showNotification('Lixxon Studio Notifications Enabled', {
          body: 'You will receive curated editorial dispatches, breaking skincare science, and exclusive salon drops.',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          data: { url: '/trending' },
        });
      }

      return true;
    } catch (err) {
      console.error('Failed to subscribe to Web Push:', err);
      return false;
    } finally {
      setSubscribing(false);
    }
  }, []);

  return {
    notifications,
    unreadCount,
    loading,
    permission,
    isSubscribed,
    subscribing,
    subscribeToPush,
    markAsRead,
    markAllAsRead,
    recordClick,
    refresh: fetchNotifications,
  };
}
