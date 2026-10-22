import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { getStaffSession } from '@/domain/admin/staff-session';
import { AdminShell } from '@/ui/admin/AdminShell';
import '@/ui/admin/admin.css';
import { adminLogoutAction } from './(auth)/actions';

// Админка закрыта от поисковиков целиком (правило 10).
export const metadata: Metadata = { title: { default: 'Админка', template: '%s — Админка' }, robots: { index: false, follow: false } };

/**
 * С сессией сотрудника — оболочка с навигацией; без неё — страница как есть (так работает /admin/login).
 * Layout НЕ защищает данные: каждая страница вызывает requireStaffPage(), каждый обработчик — requirePermission.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = getStaffSession(await cookies());
  if (!session) return <>{children}</>;
  return (
    <AdminShell session={session} logout={adminLogoutAction}>
      {children}
    </AdminShell>
  );
}
