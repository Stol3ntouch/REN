import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { ALL_PERMISSIONS, EDITABLE_PERMISSIONS, SYSTEM_ROLES } from '@/domain/admin/permission-catalog';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { rolesService } from '@/domain/admin/roles';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { getStaffSession } from '@/domain/admin/staff-session';
import { rolesRepo } from '@/server/db/repositories/roles';
import { createTestDb } from '@/server/db/testing';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { fakeCookies, T0 } from '../auth/helpers';

async function setup() {
  const db = createTestDb();
  await createStaff({ email: 'root', password: 'root-password-123', role: 'super_admin' }, { db, now: T0 });
  await createStaff({ email: 'boss', password: 'boss-password-123', role: 'admin' }, { db, now: T0 });
  await createStaff({ email: 'mgr', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
  const sessionOf = async (login: string, password: string): Promise<StaffSession> => {
    const c = fakeCookies();
    await loginStaff({ email: login, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
    return getStaffSession(c, { db, now: T0 })!;
  };
  return {
    db,
    root: await sessionOf('root', 'root-password-123'),
    boss: await sessionOf('boss', 'boss-password-123'),
    mgr: await sessionOf('mgr', 'manager-password-1'),
    sessionOf,
  };
}
const opts = (db: ReturnType<typeof createTestDb>) => ({ db, now: T0 });

describe('сид ролей', () => {
  it('миграция создаёт шесть системных ролей с теми же правами, что SYSTEM_ROLES в коде', async () => {
    const { db } = await setup();
    const roles = rolesRepo.list(db);
    expect(roles.map((r) => r.code)).toEqual(['super_admin', 'admin', 'manager', 'content_manager', 'warehouse', 'service']);
    expect(roles.every((r) => r.isSystem)).toBe(true);
    for (const seed of SYSTEM_ROLES) {
      const role = rolesRepo.findByCode(db, seed.code)!;
      expect(role.name).toBe(seed.name);
      const stored = rolesRepo.permissions(db, role.id).sort();
      // у super_admin строк нет — все права автоматически
      expect(stored).toEqual(seed.code === 'super_admin' ? [] : [...seed.permissions].sort());
    }
  });

  it('ensureSystemRoles идемпотентен и не затирает правки администратора; недостающую роль воссоздаёт', async () => {
    const { db, root } = await setup();
    const manager = rolesRepo.findByCode(db, 'manager')!;
    rolesService.setPermissions(root, manager.id, ['orders.read'], opts(db));
    expect(rolesService.ensureSystemRoles(opts(db)).created).toEqual([]);
    expect(rolesRepo.permissions(db, manager.id).sort()).toEqual(['orders.read']);

    db.prepare('UPDATE staff SET role_id = (SELECT id FROM roles WHERE code = ?) WHERE email = ?').run('admin', 'mgr');
    db.prepare("DELETE FROM roles WHERE code = 'warehouse'").run();
    expect(rolesService.ensureSystemRoles(opts(db)).created).toEqual(['warehouse']);
    expect(rolesRepo.permissions(db, rolesRepo.findByCode(db, 'warehouse')!.id)).toContain('warehouses.write');
  });

  it('список прав: 15 прежних + 28 новых + staff.self = 44 ключа без повторов', () => {
    expect(ALL_PERMISSIONS).toHaveLength(44);
    expect(new Set(ALL_PERMISSIONS).size).toBe(44);
    expect(EDITABLE_PERMISSIONS).toHaveLength(43);
  });

  it('миграция 1100 не расходится с каталогом: её SQL содержит каждое право системных ролей', () => {
    const sql = readFileSync(resolve(__dirname, '../../migrations/1100_rbac_roles.sql'), 'utf8');
    for (const seed of SYSTEM_ROLES) for (const p of seed.permissions) expect(sql).toContain(`'${p}'`);
  });
});

describe('права из БД действуют на открытые сессии', () => {
  it('изменил роль — доступ пропал без перелогина (и вернулся)', async () => {
    const { db, root, mgr, sessionOf } = await setup();
    expect(() => requirePermission(mgr, 'orders.write')).not.toThrow();
    const role = rolesRepo.findByCode(db, 'manager')!;
    rolesService.setPermissions(root, role.id, ['orders.read'], opts(db));

    // та же cookie, новый запрос: права читаются из БД заново
    const c = fakeCookies();
    await loginStaff({ email: 'mgr', password: 'manager-password-1' }, { db, cookies: c, ip: '2.2.2.2', now: T0 });
    const again = getStaffSession(c, { db, now: T0 })!;
    expect(() => requirePermission(again, 'orders.write')).toThrow(ForbiddenError);
    expect(() => requirePermission(again, 'orders.read')).not.toThrow();
    rolesService.setPermissions(root, role.id, ['orders.read', 'orders.write'], opts(db));
    expect(() => requirePermission(getStaffSession(c, { db, now: T0 })!, 'orders.write')).not.toThrow();
    void sessionOf;
  });

  it('super_admin получает все права автоматически, даже новые; у любой роли есть staff.self', async () => {
    const { root, mgr } = await setup();
    expect(root.permissions).toEqual(ALL_PERMISSIONS);
    expect(mgr.permissions).toContain('staff.self');
  });
});

describe('роли: операции', () => {
  it('создание, переименование, дублирование, удаление несистемной роли; всё в аудите', async () => {
    const { db, boss } = await setup();
    const o = opts(db);
    const { roleId } = rolesService.create(boss, { name: '  Оператор  ', permissions: ['orders.read'] }, o);
    expect(rolesRepo.findById(db, roleId)).toMatchObject({ name: 'Оператор', isSystem: false });
    rolesService.rename(boss, roleId, 'Оператор склада', o);
    const copy = rolesService.duplicate(boss, roleId, 'Копия', o);
    expect(rolesRepo.permissions(db, copy.roleId)).toEqual(['orders.read']);
    rolesService.remove(boss, copy.roleId, o);
    expect(rolesRepo.findById(db, copy.roleId)).toBeNull();
    expect(audit.list({ entity: 'role' }, { db }).map((r) => r.action).reverse()).toEqual(['role.create', 'role.rename', 'role.duplicate', 'role.delete']);
  });

  it('нельзя: дубль названия, удалить системную или занятую роль, менять super_admin, неизвестное право', async () => {
    const { db, boss, root } = await setup();
    const o = opts(db);
    expect(() => rolesService.create(boss, { name: 'менеджер' }, o)).toThrow(ConflictError);
    expect(() => rolesService.create(boss, { name: 'x' }, o)).toThrow(ValidationError);
    expect(() => rolesService.remove(boss, rolesRepo.findByCode(db, 'manager')!.id, o)).toThrow(ConflictError);
    const { roleId } = rolesService.create(boss, { name: 'Занятая' }, o);
    db.prepare('UPDATE staff SET role_id = ? WHERE email = ?').run(roleId, 'mgr');
    expect(() => rolesService.remove(boss, roleId, o)).toThrow(ConflictError);
    const sa = rolesRepo.findByCode(db, 'super_admin')!.id;
    for (const fn of [() => rolesService.setPermissions(root, sa, ['orders.read'], o), () => rolesService.rename(root, sa, 'Другое', o), () => rolesService.duplicate(root, sa, 'Копия SA', o), () => rolesService.remove(root, sa, o)]) {
      expect(fn).toThrow(ConflictError);
    }
    expect(() => rolesService.setPermissions(boss, roleId, ['nope.nope'], o)).toThrow(ValidationError);
    expect(() => rolesService.get(boss, 9999, o)).toThrow(NotFoundError);
  });

  it('защита от повышения привилегий: нельзя выдать право, которого нет у правящего', async () => {
    const { db, root } = await setup();
    const o = opts(db);
    const { roleId } = rolesService.create(root, { name: 'Главный по ролям', permissions: ['roles.manage', 'orders.read'] }, o);
    const code = rolesRepo.findById(db, roleId)!.code;
    await createStaff({ email: 'rolesman', password: 'rolesman-pass-1', role: code }, o);
    const c = fakeCookies();
    await loginStaff({ email: 'rolesman', password: 'rolesman-pass-1' }, { db, cookies: c, ip: '3.3.3.3', now: T0 });
    const limited = getStaffSession(c, { db, now: T0 })!;
    expect(() => rolesService.setPermissions(limited, roleId, ['roles.manage', 'orders.read', 'finance.read'], o)).toThrow(ForbiddenError);
    expect(() => rolesService.create(limited, { name: 'Богатая', permissions: ['finance.read'] }, o)).toThrow(ForbiddenError);
    expect(() => rolesService.duplicate(limited, rolesRepo.findByCode(db, 'admin')!.id, 'Копия админа', o)).toThrow(ForbiddenError);
  });

  it('нельзя снять users.manage/roles.manage у единственных владельцев', async () => {
    const { db, root } = await setup();
    const o = opts(db);
    const admin = rolesRepo.findByCode(db, 'admin')!;
    // суперадмин остаётся владельцем прав — снять с роли admin можно
    expect(() => rolesService.setPermissions(root, admin.id, EDITABLE_PERMISSIONS.filter((p) => p !== 'users.manage'), o)).not.toThrow();
    db.prepare("UPDATE staff SET active = 0 WHERE email = 'root'").run();
    // теперь root неактивен: единственные держатели roles.manage — сотрудники роли admin
    expect(() => rolesService.setPermissions(root, admin.id, ['orders.read'], o)).toThrow(ConflictError);
  });

  it('каждая операция: без сессии 401, без права roles.manage 403', async () => {
    const { db, mgr, boss } = await setup();
    const o = opts(db);
    const id = rolesRepo.findByCode(db, 'manager')!.id;
    const calls: ((s: StaffSession | null) => unknown)[] = [
      (s) => rolesService.list(s, o),
      (s) => rolesService.get(s, id, o),
      (s) => rolesService.create(s, { name: 'Новая' }, o),
      (s) => rolesService.rename(s, id, 'Другое имя', o),
      (s) => rolesService.duplicate(s, id, 'Копия', o),
      (s) => rolesService.remove(s, id, o),
      (s) => rolesService.setPermissions(s, id, [], o),
      (s) => rolesService.assignable(s, o),
    ];
    for (const call of calls) {
      expect(() => call(null)).toThrow(UnauthorizedError);
      expect(() => call(mgr)).toThrow(ForbiddenError);
    }
    expect(() => rolesService.list(boss, o)).not.toThrow();
  });
});
