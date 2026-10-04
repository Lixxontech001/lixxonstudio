import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Check, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, action?: ToastAction, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success', action?: ToastAction, durationMs = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type, action }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, durationMs);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none" role="status" aria-live="polite">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`toast-enter pointer-events-auto flex items-center gap-3 px-5 py-3.5 rounded-sm luxury-shadow-lg flex items-center min-w-[280px] max-w-md ${
              toast.type === 'success' ? 'bg-charcoal text-white' :
              toast.type === 'error' ? 'bg-red-900 text-white' :
              'bg-charcoal text-white'
            }`}
          >
            {toast.type === 'success' && <Check size={16} className="text-bronze-light flex-shrink-0" />}
            {toast.type === 'error' && <AlertCircle size={16} className="text-red-300 flex-shrink-0" />}
            {toast.type === 'info' && <Info size={16} className="text-bronze-light flex-shrink-0" />}
            <span className="text-sm flex-1">{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => { toast.action?.onClick(); dismiss(toast.id); }}
                className="text-sm font-medium text-bronze-light hover:text-white underline underline-offset-2 transition-colors flex-shrink-0"
              >
                {toast.action.label}
              </button>
            )}
            <button onClick={() => dismiss(toast.id)} aria-label="Dismiss notification" className="text-white/50 hover:text-white transition-colors flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
