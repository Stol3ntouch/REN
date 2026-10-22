import type { StaffRole } from '@/server/db/repositories/staff';
import { ForbiddenError, UnauthorizedError } from '@/server/http/errors';

export type Permission =
  | 'orders.read'
  | 'orders.write'
  | 'requests.write'
  | 'reviews.moderate'
  | 'customers.read'
  | 'catalog.read'
  | 'catalog.write'
  | 'promos.write'
  | 'content.write'
  | 'integrations.read'
  | 'integrations.run'
  | 'staff.manage'
  | 'settings.write'
  | 'audit.read'
  | 'analytics.read';

export type StaffSession = { staffId: number; email: string; name: string | null; role: StaffRole };

export const ALL_PERMISSIONS: readonly Permission[] = [
  'orders.read',
  'orders.write',
  'requests.write',
  'reviews.moderate',
  'customers.read',
  'catalog.read',
  'catalog.write',
  'promos.write',
  'content.write',
  'integrations.read',
  'integrations.run',
  'staff.manage',
  'settings.write',
  'audit.read',
  'analytics.read',
];

/** «Матрица прав» из spec.md. admin — всё; manager — только перечисленное. */
export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  manager: ['orders.read', 'orders.write', 'requests.write', 'reviews.moderate', 'customers.read', 'catalog.read', 'integrations.read'],
};

export function hasPermission(role: StaffRole, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

/**
 * Проверка права ВНУТРИ каждого защищённого обработчика / server action.
 * Нет сессии → UnauthorizedError (401); роль без права → ForbiddenError (403).
 */
export function requirePermission(session: StaffSession | null | undefined, perm: Permission): asserts session is StaffSession {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  if (!hasPermission(session.role, perm)) throw new ForbiddenError('Недостаточно прав для этого действия');
}
