'use client';

import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Кнопка отправки формы с подтверждением: клик открывает ConfirmDialog, «Подтвердить» отправляет форму кнопки
 * (с её formAction, name и value). Для опасных server action: удаление, отмена, массовые операции.
 *   <form action={removeAction}><ConfirmButton title="Удалить товар?" confirmLabel="Удалить">Удалить</ConfirmButton></form>
 */
export function ConfirmButton({
  title,
  description,
  confirmLabel = 'Подтвердить',
  tone = 'danger',
  className = 'ak-btn ak-btn--danger-outline',
  children,
  ...rest
}: {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'default';
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'className' | 'children'>) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  return (
    <>
      <button
        ref={button}
        type="submit"
        className={className}
        aria-haspopup="dialog"
        {...rest}
        onClick={(e) => {
          if (confirmed.current) {
            confirmed.current = false;
            return; // подтверждено — форма уходит как обычно
          }
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </button>
      <ConfirmDialog
        open={open}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        tone={tone}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          confirmed.current = true;
          button.current?.click();
        }}
      />
    </>
  );
}
