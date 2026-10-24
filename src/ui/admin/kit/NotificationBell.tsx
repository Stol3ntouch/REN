import Link from 'next/link';
import { Icon } from './icons';

/**
 * Колокольчик уведомлений верхней панели с индикатором непрочитанных. Показывается только при
 * `TOPBAR_FEATURES.notifications` (включает C10 вместе со страницей `/admin/notifications`).
 */
export function NotificationBell({ unread = 0, href = '/admin/notifications' }: { unread?: number; href?: string }) {
  const label = unread > 0 ? `Уведомления: непрочитанных ${unread}` : 'Уведомления';
  return (
    <Link href={href} className="ak-iconbtn ak-bell" aria-label={label}>
      <Icon name="bell" size={20} />
      {unread > 0 ? (
        <span className="ak-bell__dot" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
