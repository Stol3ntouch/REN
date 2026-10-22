import { hasPermission, type Permission } from '@/domain/admin/permissions';
import type { StaffRole } from '@/server/db/repositories/staff';

/**
 * Разделы админки (по схеме). permission — право, при котором пункт показан (null — всем сотрудникам).
 * Скрытие пункта — только удобство: страницы и обработчики раздела сами проверяют права на сервере.
 * Новый раздел: добавьте объект сюда (key, label, href, permission) и защитите страницу requireStaffPage(permission).
 */
export type AdminNavItem = { key: string; label: string; href: string; permission: Permission | null };

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { key: 'overview', label: 'Обзор', href: '/admin', permission: null },
  { key: 'catalog', label: 'Каталог', href: '/admin/catalog', permission: 'catalog.read' },
  { key: 'orders', label: 'Заказы', href: '/admin/orders', permission: 'orders.read' },
  { key: 'stock', label: 'Склад', href: '/admin/stock', permission: 'catalog.read' },
  { key: 'pricing', label: 'Цены и акции', href: '/admin/promos', permission: 'catalog.read' },
  { key: 'customers', label: 'Покупатели', href: '/admin/customers', permission: 'customers.read' },
  { key: 'content', label: 'Контент и услуги', href: '/admin/content', permission: 'content.write' },
  { key: 'integrations', label: 'Импорт и интеграции', href: '/admin/integrations', permission: 'integrations.read' },
  { key: 'analytics', label: 'Аналитика', href: '/admin/analytics', permission: 'analytics.read' },
  { key: 'access', label: 'Доступ и настройки', href: '/admin/access', permission: 'staff.manage' },
];

export function visibleNav(role: StaffRole): AdminNavItem[] {
  return ADMIN_NAV.filter((i) => i.permission === null || hasPermission(role, i.permission));
}
