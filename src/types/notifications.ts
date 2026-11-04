export interface BroadcastNotification {
  id: string;
  title: string;
  body: string;
  category: 'editorial' | 'breaking' | 'drop' | 'digest' | 'system' | 'exclusive' | 'vault';
  icon_url?: string | null;
  image_url?: string | null;
  action_url: string;
  segment: 'all' | 'subscribers' | 'shoppers' | 'members';
  status: 'draft' | 'sent' | 'archived';
  sent_count: number;
  delivered_count: number;
  click_count: number;
  read_count: number;
  action_count: number;
  created_at: string;
  sent_at: string;
}

export interface ReaderPushSubscription {
  id?: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  device_fingerprint?: string;
  device_type?: 'mobile' | 'desktop' | 'tablet';
  user_agent?: string;
  user_id?: string | null;
  is_active: boolean;
  created_at?: string;
  last_seen_at?: string;
}

