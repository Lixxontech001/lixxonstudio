export const REQUEST_ERROR_EVENT = 'lixxon:request-error';

/** Notify the current route that a request exhausted its timeout/network retry. */
export function reportRequestError(source: 'supabase' | 'edge'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(REQUEST_ERROR_EVENT, { detail: { source } }));
}
