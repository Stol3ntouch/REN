import type { ReactNode } from 'react';

/** Идентификаторы подсказки и ошибки поля — для aria-describedby. */
export function fieldIds(id: string): { hint: string; error: string } {
  return { hint: `${id}-hint`, error: `${id}-error` };
}

export function describedBy(id: string, v: { hint?: unknown; error?: unknown }): string | undefined {
  const ids = fieldIds(id);
  const parts = [v.hint ? ids.hint : null, v.error ? ids.error : null].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

export type FieldError = string | readonly string[] | undefined | null;
export const errorText = (e: FieldError): string | null => {
  if (!e) return null;
  return typeof e === 'string' ? e : (e[0] ?? null);
};

type ShellProps = { id: string; label: string; hint?: ReactNode; error?: FieldError; required?: boolean; children: ReactNode; className?: string };

/** Подпись, подсказка и ошибка вокруг любого элемента управления. Элементу задайте id, aria-invalid и aria-describedby (см. describedBy). */
export function FieldShell({ id, label, hint, error, required, children, className }: ShellProps) {
  const ids = fieldIds(id);
  const message = errorText(error);
  return (
    <div className={`ak-field${message ? ' ak-field--invalid' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={id} className="ak-field__label">
        {label}
        {required ? (
          <span className="ak-field__req" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={ids.hint} className="ak-field__hint">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={ids.error} className="ak-field__error">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export type FieldCommon = { name: string; label: string; hint?: ReactNode; error?: FieldError; id?: string };
