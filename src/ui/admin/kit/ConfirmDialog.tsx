'use client';

import { useId, useRef, type ReactNode } from 'react';
import { useFocusTrap } from './use-focus-trap';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger — красная кнопка, начальный фокус на «Отмена» (случайный Enter ничего не удаляет). */
  tone?: 'danger' | 'default';
  /** Идёт выполнение: кнопки заблокированы. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

/**
 * Модальное подтверждение опасных действий: role="dialog", aria-modal, Tab заперт внутри, Esc и клик по фону — отмена,
 * после закрытия фокус возвращается на кнопку, открывшую окно.
 */
export function ConfirmDialog({ open, title, description, confirmLabel = 'Подтвердить', cancelLabel = 'Отмена', tone = 'default', pending = false, onConfirm, onCancel, children }: ConfirmDialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useFocusTrap(box, open, {
    onEscape: () => {
      if (!pending) onCancel();
    },
    initialFocus: () => (tone === 'danger' ? cancel.current : confirm.current),
  });

  if (!open) return null;
  return (
    <div
      className="ak-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <div ref={box} className="ak-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1}>
        <h2 id={titleId} className="ak-dialog__title">
          {title}
        </h2>
        {description ? (
          <div id={descId} className="ak-dialog__body">
            {description}
          </div>
        ) : null}
        {children}
        <div className="ak-dialog__actions">
          <button ref={cancel} type="button" className="ak-btn ak-btn--outline" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </button>
          <button ref={confirm} type="button" className={`ak-btn ${tone === 'danger' ? 'ak-btn--danger' : 'ak-btn--primary'}`} onClick={onConfirm} disabled={pending} aria-busy={pending || undefined}>
            {pending ? 'Выполняется…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
