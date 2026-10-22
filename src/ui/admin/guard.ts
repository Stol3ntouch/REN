import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveAdminAccess } from '@/domain/admin/guard';
import type { Permission, StaffSession } from '@/domain/admin/permissions';

/**
 * Защита СТРАНИЦЫ админки. Первой строкой каждой страницы под src/app/admin/(panel)/**:
 *   const session = await requireStaffPage('orders.read');
 * Нет сессии → редирект на /admin/login; нет права → на обзор с сообщением. Данные страницы
 * и server actions всё равно проверяют права сами (requirePermission) — это не замена.
 */
export async function requireStaffPage(perm: Permission | null = null): Promise<StaffSession> {
  const access = resolveAdminAccess(await cookies(), perm);
  if (access.ok) return access.session;
  if (access.reason === 'unauthenticated') redirect(access.redirectTo);
  redirect('/admin?forbidden=1');
}
