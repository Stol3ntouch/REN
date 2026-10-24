import type { ReactNode } from 'react';
import type { StaffSession } from '@/domain/admin/permissions';
import { visibleNavGroups } from '../nav';
import { TOPBAR_FEATURES } from '../nav-core';
import { AutoBreadcrumbs } from './AutoBreadcrumbs';
import { ShellOverlay, ShellProvider } from './shell-context';
import { Sidebar } from './Sidebar';
import { Toaster } from './Toaster';
import { Topbar, type TopbarFeatures } from './Topbar';

/**
 * Каркас всех страниц админки: боковая панель, верхняя панель, хлебные крошки, область содержимого, уведомления.
 * Страница вставляется как `children`; заголовок страницы — `PageHeader`. Права скрывают пункты меню (удобство),
 * защита страниц — `requireStaffPage` в самой странице.
 *
 * `collapsed` — состояние панели из cookie, читается на сервере (панель не мигает при загрузке).
 */
export function AdminLayout({
  session,
  logout,
  collapsed = false,
  features = TOPBAR_FEATURES,
  children,
}: {
  session: StaffSession;
  logout: () => Promise<void>;
  collapsed?: boolean;
  features?: TopbarFeatures;
  children: ReactNode;
}) {
  return (
    <Toaster>
      <ShellProvider initialCollapsed={collapsed}>
        <a href="#admin-main" className="skip-link">
          Перейти к содержимому
        </a>
        <Sidebar groups={visibleNavGroups(session)} />
        <ShellOverlay />
        <div className="ak-body">
          <Topbar session={session} logout={logout} features={features} />
          <main id="admin-main" className="ak-main" tabIndex={-1}>
            <AutoBreadcrumbs />
            {children}
          </main>
        </div>
      </ShellProvider>
    </Toaster>
  );
}
