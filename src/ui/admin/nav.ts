import { hasPermission, type Permission } from '@/domain/admin/permissions';
import type { StaffRole } from '@/server/db/repositories/staff';
import { ADMIN_NAV_GROUPS, type AdminNavGroup, type AdminNavItem } from './nav-core';

/** Меню админки: данные и чистые функции — в `nav-core.ts` (их можно импортировать из клиентских компонентов); здесь — фильтр по правам. */
export * from './nav-core';

const allowed = (role: StaffRole, permission: Permission | null): boolean => permission === null || hasPermission(role, permission);

/** Меню по группам для роли: скрыты пункты без права и опустевшие группы; родитель с видимыми детьми виден всегда. */
export function visibleNavGroups(role: StaffRole): AdminNavGroup[] {
  const groups: AdminNavGroup[] = [];
  for (const g of ADMIN_NAV_GROUPS) {
    const items: AdminNavItem[] = [];
    for (const item of g.items) {
      const children = item.children?.filter((c) => allowed(role, c.permission));
      if (allowed(role, item.permission)) items.push({ ...item, ...(item.children ? { children } : {}) });
    }
    if (items.length > 0) groups.push({ ...g, items });
  }
  return groups;
}

/** Пункты верхнего уровня, видимые роли (плоским списком). */
export function visibleNav(role: StaffRole): AdminNavItem[] {
  return visibleNavGroups(role).flatMap((g) => [...g.items]);
}
