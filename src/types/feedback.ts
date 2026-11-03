export type FeedbackCategory = 'Praise' | 'Question' | 'Bug / Issue' | 'General Idea';
export type FeedbackStatus = 'unread' | 'under_review' | 'resolved' | 'archived';

export interface SiteFeedback {
  id: string;
  category: FeedbackCategory;
  message: string;
  rating: number; // 1-5
  name: string;
  email: string;
  page_url: string;
  viewport: string;
  status: FeedbackStatus;
  admin_notes: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}
