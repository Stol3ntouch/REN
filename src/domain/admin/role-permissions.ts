import type { Db } from '@/server/db/connection';
import { rolesRepo } from '@/server/db/repositories/roles';
import { ALL_PERMISSIONS, BASELINE_PERMISSIONS, SUPER_ADMIN_CODE, isPermission, type Permission } from './permission-catalog';

/**
 * Права роли из БД. super_admin получает все автоматически (строк в role_permissions у него нет);
 * базовые права (staff.self) есть у любой роли. Неизвестные ключи из БД (устаревшие) отбрасываются.
 */
export function loadRolePermissions(db: Db, roleId: number, roleCode: string): Permission[] {
  if (roleCode === SUPER_ADMIN_CODE) return [...ALL_PERMISSIONS];
  const set = new Set<Permission>(BASELINE_PERMISSIONS);
  for (const p of rolesRepo.permissions(db, roleId)) if (isPermission(p)) set.add(p);
  return ALL_PERMISSIONS.filter((p) => set.has(p));
}
