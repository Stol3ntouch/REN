import type { ReactNode } from 'react';
import { Icon } from './icons';

/** Ошибка: понятный текст без внутренних деталей и действие «Повторить» / «На главную» — через `action`. */
export function ErrorState({ title = 'Что-то пошло не так', children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ak-state ak-state--error" role="alert">
      <Icon name="alert" size={28} />
      <p className="ak-state__title">{title}</p>
      {children ? <div className="ak-state__body">{children}</div> : null}
      {action ? <div className="ak-state__action">{action}</div> : null}
    </div>
  );
}
