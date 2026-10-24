import { ForbiddenError, UnauthorizedError } from '@/server/http/errors';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, SUPER_ADMIN_CODE, type Permission } from './permission-catalog';

export { ALL_PERMISSIONS, ROLE_PERMISSIONS, SUPER_ADMIN_CODE, type Permission };

/**
 * Сессия сотрудника. `permissions` — набор прав роли, прочитанный из БД при КАЖДОМ запросе
 * (getStaffSession), поэтому правка роли действует на открытые сессии со следующего запроса.
 * Без `permissions` (сессия, собранная вручную, например в тесте) права берутся из сида ролей в коде.
 */
export type StaffSession = {
  staffId: number;
  email: string;
  name: string | null;
  /** Код роли: super_admin, admin, manager… или код своей роли. */
  role: string;
  roleId?: number;
  /** Название роли для интерфейса. */
  roleName?: string;
  permissions?: readonly Permission[];
};

export type PermissionSubject = string | { role: string; permissions?: readonly string[] };

/** Набор прав субъекта: загруженный из БД, иначе — сид системной роли; неизвестная роль → пусто. */
export function permissionsOf(subject: PermissionSubject): readonly string[] {
  if (typeof subject === 'object') {
    if (subject.permissions) return subject.permissions;
    return permissionsOf(subject.role);
  }
  if (subject === SUPER_ADMIN_CODE) return ALL_PERMISSIONS;
  return ROLE_PERMISSIONS[subject] ?? [];
}

/**
 * Есть ли право. Передавайте сессию (`hasPermission(session, 'x')`) — тогда работают и свои роли из БД.
 * Строка с кодом роли понимает только системные роли «из кода»; это для старых вызовов и тестов.
 */
export function hasPermission(subject: PermissionSubject, perm: Permission): boolean {
  return permissionsOf(subject).includes(perm);
}

export const isSuperAdmin = (subject: { role: string }): boolean => subject.role === SUPER_ADMIN_CODE;

/**
 * Проверка права ВНУТРИ каждого защищённого обработчика / server action.
 * Нет сессии → UnauthorizedError (401); роль без права → ForbiddenError (403).
 */
export function requirePermission(session: StaffSession | null | undefined, perm: Permission): asserts session is StaffSession {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  if (!hasPermission(session, perm)) throw new ForbiddenError('Недостаточно прав для этого действия');
}
