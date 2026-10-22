import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, hasPermission, requirePermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { ForbiddenError, UnauthorizedError } from '@/server/http/errors';

/**
 * Ожидание выписано вручную из «Матрицы прав» spec.md, не из кода:
 *  admin — всё; manager — заказы, заявки/отзывы, покупатели (просмотр), каталог (просмотр), журнал интеграций (просмотр).
 */
const EXPECTED: Record<Permission, { admin: boolean; manager: boolean }> = {
  'orders.read': { admin: true, manager: true },
  'orders.write': { admin: true, manager: true },
  'requests.write': { admin: true, manager: true },
  'reviews.moderate': { admin: true, manager: true },
  'customers.read': { admin: true, manager: true },
  'catalog.read': { admin: true, manager: true },
  'catalog.write': { admin: true, manager: false },
  'promos.write': { admin: true, manager: false },
  'content.write': { admin: true, manager: false },
  'integrations.read': { admin: true, manager: true },
  'integrations.run': { admin: true, manager: false },
  'staff.manage': { admin: true, manager: false },
  'settings.write': { admin: true, manager: false },
  'audit.read': { admin: true, manager: false },
  'analytics.read': { admin: true, manager: false },
};

const session = (role: 'admin' | 'manager'): StaffSession => ({ staffId: 1, email: 'x@example.com', name: null, role });

describe('матрица прав', () => {
  it('список Permission совпадает с таблицей ожиданий (15 прав)', () => {
    expect([...ALL_PERMISSIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [perm, roles] of Object.entries(EXPECTED) as [Permission, { admin: boolean; manager: boolean }][]) {
    for (const role of ['admin', 'manager'] as const) {
      it(`${role} × ${perm} → ${roles[role] ? 'разрешено' : 'запрещено'}`, () => {
        expect(hasPermission(role, perm)).toBe(roles[role]);
        if (roles[role]) {
          expect(() => requirePermission(session(role), perm)).not.toThrow();
        } else {
          expect(() => requirePermission(session(role), perm)).toThrow(ForbiddenError);
        }
      });
    }
  }

  it('ROLE_PERMISSIONS менеджера — ровно 7 прав из спецификации', () => {
    expect([...ROLE_PERMISSIONS.manager].sort()).toEqual(
      ['catalog.read', 'customers.read', 'integrations.read', 'orders.read', 'orders.write', 'requests.write', 'reviews.moderate'].sort(),
    );
  });

  it('без сессии → UnauthorizedError (401), неизвестная роль из БД → отказ', () => {
    expect(() => requirePermission(null, 'orders.read')).toThrow(UnauthorizedError);
    expect(() => requirePermission(undefined, 'orders.read')).toThrow(UnauthorizedError);
    const odd = { ...session('manager'), role: 'owner' as unknown as 'admin' };
    expect(() => requirePermission(odd, 'orders.read')).toThrow(ForbiddenError);
  });
});
