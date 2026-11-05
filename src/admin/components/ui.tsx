import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

/** Shared building blocks for the super-panel pages (same palette as the rest of admin). */

export function Panel({ title, icon, actions, children, className = '' }: {
  title?: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`bg-white dark:bg-[#161616] border border-taupe/30 dark:border-white/10 rounded-sm p-5 mb-5 transition-colors ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          {title && <h3 className="text-sm font-medium text-charcoal dark:text-white flex items-center gap-2">{icon}{title}</h3>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  title?: string;
  ariaLabel?: string;
  type?: 'button' | 'submit';
  className?: string;
  /** Disclosure wiring for buttons that show or hide a panel. */
  ariaExpanded?: boolean;
  ariaControls?: string;
};

export function Btn({ children, onClick, variant = 'primary', disabled, busy, icon, title, ariaLabel, type = 'button', className = '', ariaExpanded, ariaControls }: BtnProps) {
  const styles = variant === 'primary'
    ? 'bg-charcoal text-white hover:bg-bronze dark:bg-bronze dark:hover:bg-bronze-dark'
    : variant === 'danger'
      ? 'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800/80 dark:text-red-400 dark:hover:bg-red-950/40'
      : 'border border-taupe/50 bg-white text-charcoal hover:border-bronze dark:bg-[#202020] dark:border-white/15 dark:text-gray-200 dark:hover:border-bronze dark:hover:text-white';
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} title={title} aria-label={ariaLabel}
      aria-expanded={ariaExpanded} aria-controls={ariaControls}
      className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs rounded-sm disabled:opacity-60 ${styles} ${className}`}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : icon}{children}
    </button>
  );
}

export function Notice({ tone, children }: { tone: 'ok' | 'warn' | 'error' | 'info'; children: ReactNode }) {
  const map = {
    ok: { cls: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-950/40 dark:border-green-800/60 dark:text-green-300', Icon: CheckCircle2 },
    warn: { cls: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-300', Icon: AlertTriangle },
    error: { cls: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-300', Icon: XCircle },
    info: { cls: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/40 dark:border-blue-800/60 dark:text-blue-300', Icon: Info },
  } as const;
  const { cls, Icon } = map[tone];
  return (
    <div className={`flex items-start gap-2 border rounded-sm px-3 py-2 text-xs ${cls}`}>
      <Icon size={14} className="mt-0.5 flex-shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Severity({ level }: { level: string }) {
  const map: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/60',
    warning: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60',
    info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/60',
    ok: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800/60',
  };
  return <span className={`inline-block px-1.5 py-0.5 text-[10px] uppercase tracking-wide border rounded-sm ${map[level] || map.info}`}>{level}</span>;
}

/** Tiny RPC data hook: loading / error / reload, typed via `T`. */
export function useAdminRpc<T = unknown>(name: string, args?: Record<string, unknown>, enabled = true): {
  data: T | null; error: string | null; loading: boolean; reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [nonce, setNonce] = useState(0);
  const argsKey = JSON.stringify(args ?? null);

  useEffect(() => {
    // Never issue an RPC the current role cannot use — the database would refuse it anyway.
    if (!enabled) { setData(null); setError(null); setLoading(false); return; }
    let on = true;
    setLoading(true);
    supabase.rpc(name, args ?? {}).then(({ data: d, error: e }) => {
      if (!on) return;
      if (e) setError(e.message); else { setError(null); setData((d as T) ?? null); }
      setLoading(false);
    });
    return () => { on = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, argsKey, nonce, enabled]);

  const reload = useCallback(() => setNonce(n => n + 1), []);
  return { data, error, loading, reload };
}

/** Imperative RPC call with busy/notice state, used by action buttons. */
export function useAdminAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const run = useCallback(async (key: string, fn: () => Promise<{ error: string | null; text: string }>) => {
    setBusy(key); setMessage(null);
    const { error, text } = await fn();
    setBusy(null);
    setMessage(error ? { tone: 'error', text: error } : { tone: 'ok', text });
    return !error;
  }, []);
  return { busy, message, setMessage, run };
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-charcoal-muted dark:text-gray-400">{children}</p>;
}

export function Loading() {
  return <p className="py-10 text-center text-sm text-charcoal-muted dark:text-gray-400 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin text-bronze" /> Loading…</p>;
}

export function ReloadBtn({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return <Btn variant="ghost" onClick={onClick} busy={busy} icon={<RefreshCw size={13} />}>Reload</Btn>;
}
