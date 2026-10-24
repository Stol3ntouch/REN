import type { ReactNode } from 'react';
import { Icon, type AdminIconName } from './icons';

/** Пусто: объяснение, что здесь будет, и (по возможности) действие. */
export function EmptyState({ title, children, action, icon = 'info' }: { title: string; children?: ReactNode; action?: ReactNode; icon?: AdminIconName }) {
  return (
    <div className="ak-state ak-state--empty">
      <Icon name={icon} size={28} />
      <p className="ak-state__title">{title}</p>
      {children ? <div className="ak-state__body">{children}</div> : null}
      {action ? <div className="ak-state__action">{action}</div> : null}
    </div>
  );
}
