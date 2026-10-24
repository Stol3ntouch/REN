import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { getStaffSession } from '@/domain/admin/staff-session';
import '@/ui/admin/admin.css';
import { AdminLayout } from '@/ui/admin/kit/AdminLayout';
import { isCollapsedCookie, NAV_COOKIE } from '@/ui/admin/kit/shell-constants';
import { adminLogoutAction } from './(auth)/actions';

// Админка закрыта от поисковиков целиком (правило 10).
export const metadata: Metadata = { title: { default: 'Админка', template: '%s — Админка' }, robots: { index: false, follow: false } };

/**
 * С сессией сотрудника — каркас (боковая и верхняя панели); без неё — страница как есть (так работает /admin/login).
 * Layout НЕ защищает данные: каждая страница вызывает requireStaffPage(), каждый обработчик — requirePermission.
 */
export default async function AdminRootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = getStaffSession(jar);
  if (!session) return <>{children}</>;
  return (
    <AdminLayout session={session} logout={adminLogoutAction} collapsed={isCollapsedCookie(jar.get(NAV_COOKIE)?.value)}>
      {children}
    </AdminLayout>
  );
}
