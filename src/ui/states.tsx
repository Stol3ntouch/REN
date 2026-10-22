import type { ReactNode } from 'react';

/** Состояния данных и форм (правило 8): loading / empty / error / success. */

export function LoadingState({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="state__spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      {children ? <div className="state__body">{children}</div> : null}
    </div>
  );
}

export function ErrorState({ title = 'Что-то пошло не так', children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">{title}</p>
      {children ? <div className="state__body">{children}</div> : null}
    </div>
  );
}

export function SuccessState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state--success" role="status" aria-live="polite">
      <p className="state__title">{title}</p>
      {children ? <div className="state__body">{children}</div> : null}
    </div>
  );
}
