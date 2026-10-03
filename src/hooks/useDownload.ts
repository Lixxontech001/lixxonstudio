import { useCallback, useState } from 'react';
import { requestDownload, ApiError } from '../lib/api';
import { useToast } from '../context/ToastContext';

/**
 * Secure download: asks the `download-file` edge function for a 60s signed URL.
 * The browser never touches the storage bucket or the entitlement row directly.
 */
export function useDownload() {
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const { showToast } = useToast();

  const download = useCallback(async (token: string) => {
    if (busyToken) return;
    setBusyToken(token);
    // open synchronously so popup blockers allow it, then redirect it
    const win = window.open('about:blank', '_blank');
    try {
      const res = await requestDownload(token);
      if (win) win.location.href = res.url; else window.location.href = res.url;
      showToast(res.remaining > 0 ? `Download started · ${res.remaining} download${res.remaining === 1 ? '' : 's'} remaining` : 'Download started · this was your last download', 'success');
    } catch (e) {
      win?.close();
      showToast(e instanceof ApiError ? e.message : 'Download failed. Please try again.', 'error');
    } finally {
      setBusyToken(null);
    }
  }, [busyToken, showToast]);

  return { download, busyToken };
}
