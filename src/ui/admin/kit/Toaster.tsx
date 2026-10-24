'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { Icon } from './icons';

export type ToastKind = 'success' | 'error' | 'info';
export type ToastItem = { id: number; kind: ToastKind; message: string };
export type ToastAction = { type: 'add'; toast: ToastItem } | { type: 'remove'; id: number };

export const MAX_TOASTS = 4;
/** Через сколько миллисекунд сообщение исчезает само (ошибки живут дольше). */
export const TOAST_TTL_MS: Readonly<Record<ToastKind, number>> = { success: 5000, info: 6000, error: 10000 };

/** Состояние уведомлений: новые добавляются в конец, лишние старые вытесняются. */
export function toastReducer(state: readonly ToastItem[], action: ToastAction): ToastItem[] {
  if (action.type === 'add') return [...state, action.toast].slice(-MAX_TOASTS);
  return state.filter((t) => t.id !== action.id);
}

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
};

const NOOP: ToastApi = { success: () => undefined, error: () => undefined, info: () => undefined, dismiss: () => undefined };
const ToastContext = createContext<ToastApi>(NOOP);

/** Показ уведомлений: `const toast = useToast(); toast.success('Сохранено')`. Вне Toaster ничего не делает. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/** Провайдер и область уведомлений (aria-live: успех — вежливо, ошибка — role="alert"). Стоит в каркасе один раз. */
export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const seq = useRef(0);

  const add = useCallback((kind: ToastKind, message: string) => {
    seq.current += 1;
    dispatch({ type: 'add', toast: { id: seq.current, kind, message } });
  }, []);
  const dismiss = useCallback((id: number) => dispatch({ type: 'remove', id }), []);

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => add('success', m), error: (m) => add('error', m), info: (m) => add('info', m), dismiss }),
    [add, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ak-app ak-toasts">
        <div role="status" aria-live="polite" aria-atomic="false" className="ak-toasts__list">
          {toasts.filter((t) => t.kind !== 'error').map((t) => (
            <ToastView key={t.id} toast={t} onClose={dismiss} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="false" className="ak-toasts__list">
          {toasts.filter((t) => t.kind === 'error').map((t) => (
            <ToastView key={t.id} toast={t} onClose={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onClose }: { toast: ToastItem; onClose: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onClose(toast.id), TOAST_TTL_MS[toast.kind]);
    return () => clearTimeout(t);
  }, [toast.id, toast.kind, onClose]);
  return (
    <div className={`ak-toast ak-toast--${toast.kind}`}>
      <Icon name={toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'alert' : 'info'} size={18} />
      <p>{toast.message}</p>
      <button type="button" className="ak-iconbtn" onClick={() => onClose(toast.id)} aria-label="Закрыть уведомление">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

/**
 * Показывает результат действия по параметрам адреса (`?ok=1`, `?error=…` — так отвечает runAction), один раз при открытии.
 * Применение: `<FlashToast ok={sp.ok} error={sp.error} okText="Сохранено." />`.
 */
export function FlashToast({ ok, error, okText = 'Готово.' }: { ok?: string | undefined; error?: string | undefined; okText?: string }) {
  const toast = useToast();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const key = `${ok ?? ''}|${error ?? ''}`;
    if (key === '|' || shown.current === key) return;
    shown.current = key;
    if (error) toast.error(error);
    else if (ok) toast.success(okText);
  }, [ok, error, okText, toast]);
  return null;
}
