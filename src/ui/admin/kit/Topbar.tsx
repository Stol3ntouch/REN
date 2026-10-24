import type { StaffSession } from '@/domain/admin/permissions';
import { TOPBAR_FEATURES } from '../nav-core';
import { Icon } from './icons';
import { initialOf, roleLabel } from './labels';
import { NotificationBell } from './NotificationBell';
import { SearchBox } from './SearchBox';
import { MenuButton } from './shell-context';
import { UserMenu } from './UserMenu';

export type TopbarFeatures = { search: boolean; notifications: boolean };

/**
 * Верхняя панель, общая для всех страниц: «Админ-панель» + подпись, слоты поиска и уведомлений (по флагам),
 * «Перейти на сайт» (новая вкладка), меню профиля.
 */
export function Topbar({
  session,
  logout,
  features = TOPBAR_FEATURES,
  unreadNotifications = 0,
}: {
  session: StaffSession;
  logout: () => Promise<void>;
  features?: TopbarFeatures;
  unreadNotifications?: number;
}) {
  const displayName = session.name?.trim() || session.email;
  return (
    <header className="ak-topbar">
      <MenuButton />
      <div className="ak-topbar__title">
        <p className="ak-topbar__name">Админ-панель</p>
        <p className="ak-topbar__sub">Управление интернет-магазином</p>
      </div>
      <div className="ak-topbar__slot">{features.search ? <SearchBox /> : null}</div>
      <div className="ak-topbar__actions">
        <a className="ak-btn ak-btn--outline ak-site-link" href="/" target="_blank" rel="noopener noreferrer">
          <Icon name="external" size={18} />
          <span className="ak-site-link__text">Перейти на сайт</span>
          <span className="visually-hidden"> (откроется в новой вкладке)</span>
        </a>
        {features.notifications ? <NotificationBell unread={unreadNotifications} /> : null}
        <UserMenu initial={initialOf(session.name, session.email)} name={displayName} roleLabel={roleLabel(session.role)} logout={logout} />
      </div>
    </header>
  );
}
