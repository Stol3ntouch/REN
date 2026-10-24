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
  'products.write': { admin: true, manager: false },
  'products.delete': { admin: true, manager: false },
  'products.cost': { admin: true, manager: false },
  'categories.write': { admin: true, manager: false },
  'brands.write': { admin: true, manager: false },
  'attributes.write': { admin: true, manager: false },
  'filters.write': { admin: true, manager: false },
  'import.run': { admin: true, manager: false },
  'export.run': { admin: true, manager: false },
  'orders.refund': { admin: true, manager: false },
  'customers.write': { admin: true, manager: false },
  'inquiries.read': { admin: true, manager: true },
  'inquiries.write': { admin: true, manager: true },
  'repair.write': { admin: true, manager: true },
  'services.write': { admin: true, manager: false },
  'marketing.write': { admin: true, manager: false },
  'payments.write': { admin: true, manager: false },
  'shipping.write': { admin: true, manager: false },
  'warehouses.write': { admin: true, manager: false },
  'email.write': { admin: true, manager: false },
  'seo.write': { admin: true, manager: false },
  'users.manage': { admin: true, manager: false },
  'roles.manage': { admin: true, manager: false },
  'backup.run': { admin: true, manager: false },
  'stats.read': { admin: true, manager: false },
  'finance.read': { admin: true, manager: false },
  'notifications.read': { admin: true, manager: true },
  'products.read': { admin: true, manager: true },
  'staff.self': { admin: true, manager: true },
};

const session = (role: string): StaffSession => ({ staffId: 1, email: 'x@example.com', name: null, role });

describe('матрица прав', () => {
  it('список Permission совпадает с таблицей ожиданий (15 прежних + 28 новых из interfaces.md + staff.self)', () => {
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

  it('ROLE_PERMISSIONS менеджера — прежние 7 прав плюс точные аналоги', () => {
    expect([...ROLE_PERMISSIONS.manager!].sort()).toEqual(
      ['catalog.read', 'customers.read', 'integrations.read', 'orders.read', 'orders.write', 'requests.write', 'reviews.moderate', ...["products.read","inquiries.read","inquiries.write","repair.write","notifications.read","staff.self"]].sort(),
    );
  });

  it('сессия с загруженными правами важнее сида: роль без права отказывает, суперадмин проходит всё', () => {
    const narrowed: StaffSession = { ...session('admin'), permissions: ['staff.self'] };
    expect(() => requirePermission(narrowed, 'orders.read')).toThrow(ForbiddenError);
    expect(hasPermission({ role: 'super_admin' }, 'roles.manage')).toBe(true);
  });

  it('без сессии → UnauthorizedError (401), неизвестная роль из БД → отказ', () => {
    expect(() => requirePermission(null, 'orders.read')).toThrow(UnauthorizedError);
    expect(() => requirePermission(undefined, 'orders.read')).toThrow(UnauthorizedError);
    const odd = { ...session('manager'), role: 'owner' as unknown as 'admin' };
    expect(() => requirePermission(odd, 'orders.read')).toThrow(ForbiddenError);
  });
});
