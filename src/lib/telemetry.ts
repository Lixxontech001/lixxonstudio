import { supabase } from './supabaseClient';
import { getFingerprint } from '../hooks/usePlatform';

export type TelemetryEventType =
  | 'impression'
  | 'click_button1'
  | 'click_button2'
  | 'dismiss'
  | 'retention_dwell'
  | 'scroll_depth';

export interface TelemetryPayload {
  announcementId?: string | null;
  formType: 'modal' | 'toast';
  eventType: TelemetryEventType;
  pagePath?: string;
  dwellSeconds?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Record a telemetry event with graceful offline/error fallback
 */
export async function recordTelemetry(payload: TelemetryPayload): Promise<void> {
  try {
    const fp = getFingerprint();
    const pagePath = payload.pagePath || (typeof window !== 'undefined' ? window.location.pathname : '/');
    
    // Store in session storage for local frequency capping / analytics
    if (typeof window !== 'undefined' && payload.announcementId) {
      const key = `lixxon_telem_${payload.announcementId}_${payload.eventType}`;
      sessionStorage.setItem(key, String(Date.now()));
    }

    await supabase.from('announcement_events').insert({
      announcement_id: payload.announcementId || null,
      form_type: payload.formType,
      event_type: payload.eventType,
      page_path: pagePath,
      dwell_seconds: payload.dwellSeconds || 0,
      fingerprint: fp,
      metadata: payload.metadata || {},
    });
  } catch (err) {
    // Non-blocking telemetry
    console.debug('[telemetry] Event logging skipped:', err);
  }
}

/**
 * Check frequency capping: Has this announcement been dismissed or seen today?
 */
export function isAnnouncementCapped(announcementId: string, cooldownMinutes = 3): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const dismissedAt = localStorage.getItem(`lixxon_ann_dismissed_${announcementId}`);
    if (dismissedAt) {
      const elapsedMinutes = (Date.now() - parseInt(dismissedAt, 10)) / (1000 * 60);
      if (elapsedMinutes < cooldownMinutes) {
        return true;
      }
    }

    const sessionDismissed = sessionStorage.getItem(`lixxon_ann_dismissed_session_${announcementId}`);
    if (sessionDismissed) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Mark announcement as dismissed locally
 */
export function markAnnouncementDismissed(announcementId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const now = String(Date.now());
    localStorage.setItem(`lixxon_ann_dismissed_${announcementId}`, now);
    sessionStorage.setItem(`lixxon_ann_dismissed_session_${announcementId}`, now);
  } catch {
    // ignore
  }
}

