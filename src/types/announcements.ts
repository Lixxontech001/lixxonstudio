export type AnnouncementFormType = 'modal' | 'toast';
export type AnnouncementTargetAudience = 'all_pages' | 'articles_only' | 'new_visitors';

export interface Announcement {
  id: string;
  title: string;
  description: string;
  badge_text: string;
  form_type: AnnouncementFormType;
  image_url: string;
  button1_label: string;
  button1_url: string;
  button2_label: string;
  button2_url: string;
  trigger_delay_seconds: number;
  scroll_percentage: number;
  cooldown_minutes: number;
  target_audience: AnnouncementTargetAudience;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at?: string;
}

