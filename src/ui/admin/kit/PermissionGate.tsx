import type { ReactNode } from 'react';
import { hasPermission, type Permission, type StaffSession } from '@/domain/admin/permissions';

/** Может ли сотрудник выполнить действие. Только удобство интерфейса: сервер проверяет право сам (requirePermission). */
export function can(session: Pick<StaffSession, 'role'> | null | undefined, permission: Permission): boolean {
  return !!session && hasPermission(session.role, permission);
}

/**
 * Показывает children только при наличии права, иначе `fallback` (по умолчанию ничего).
 * Скрытая кнопка не заменяет проверку в server action / обработчике.
 */
export function PermissionGate({
  session,
  permission,
  fallback = null,
  children,
}: {
  session: Pick<StaffSession, 'role'> | null | undefined;
  permission: Permission;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return <>{can(session, permission) ? children : fallback}</>;
}
