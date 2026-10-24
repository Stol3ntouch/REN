import type { Db } from '../connection';

export type RoleRow = { id: number; code: string; name: string; isSystem: boolean; createdAt: number };
export type RoleListRow = RoleRow & { staffCount: number; permissionCount: number };

type Raw = { id: number; code: string; name: string; is_system: number; created_at: number };
const map = (r: Raw): RoleRow => ({ id: r.id, code: r.code, name: r.name, isSystem: r.is_system === 1, createdAt: r.created_at });

/** Роли и их права (таблицы roles, role_permissions). SQL — только здесь. */
export const rolesRepo = {
  list(db: Db): RoleListRow[] {
    const rows = db
      .prepare(
        `SELECT r.*,
                (SELECT COUNT(*) FROM staff s WHERE s.role_id = r.id) AS staff_count,
                (SELECT COUNT(*) FROM role_permissions p WHERE p.role_id = r.id) AS permission_count
           FROM roles r ORDER BY r.is_system DESC, r.id`,
      )
      .all() as (Raw & { staff_count: number; permission_count: number })[];
    return rows.map((r) => ({ ...map(r), staffCount: r.staff_count, permissionCount: r.permission_count }));
  },
  findById(db: Db, id: number): RoleRow | null {
    const r = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as Raw | undefined;
    return r ? map(r) : null;
  },
  findByCode(db: Db, code: string): RoleRow | null {
    const r = db.prepare('SELECT * FROM roles WHERE code = ?').get(code) as Raw | undefined;
    return r ? map(r) : null;
  },
  findByName(db: Db, name: string): RoleRow | null {
    const r = db.prepare('SELECT * FROM roles WHERE name = ?').get(name) as Raw | undefined;
    return r ? map(r) : null;
  },
  insert(db: Db, v: { code: string; name: string; isSystem: boolean; now: number }): number {
    const r = db.prepare('INSERT INTO roles (code, name, is_system, created_at) VALUES (?, ?, ?, ?)').run(v.code, v.name, v.isSystem ? 1 : 0, v.now);
    return Number(r.lastInsertRowid);
  },
  rename(db: Db, id: number, name: string): void {
    db.prepare('UPDATE roles SET name = ? WHERE id = ?').run(name, id);
  },
  delete(db: Db, id: number): void {
    db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  },
  countStaff(db: Db, id: number): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM staff WHERE role_id = ?').get(id) as { n: number }).n);
  },

  permissions(db: Db, roleId: number): string[] {
    return (db.prepare('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission').all(roleId) as { permission: string }[]).map((r) => r.permission);
  },
  /** Заменяет набор прав роли целиком. */
  replacePermissions(db: Db, roleId: number, permissions: readonly string[]): void {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const ins = db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)');
    for (const p of permissions) ins.run(roleId, p);
  },
  addPermissions(db: Db, roleId: number, permissions: readonly string[]): void {
    const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)');
    for (const p of permissions) ins.run(roleId, p);
  },

  /** Активные сотрудники, у которых есть право (через роль) или роль super_admin. excludeStaffId — не считать этого сотрудника. */
  countActiveHolders(db: Db, permission: string, excludeStaffId: number | null = null): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM staff s JOIN roles r ON r.id = s.role_id
          WHERE s.active = 1 AND (? IS NULL OR s.id <> ?)
            AND (r.code = 'super_admin' OR EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.permission = ?))`,
      )
      .get(excludeStaffId, excludeStaffId, permission) as { n: number };
    return Number(row.n);
  },
  countActiveSuperAdmins(db: Db, excludeStaffId: number | null = null): number {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM staff s JOIN roles r ON r.id = s.role_id WHERE s.active = 1 AND r.code = 'super_admin' AND (? IS NULL OR s.id <> ?)")
      .get(excludeStaffId, excludeStaffId) as { n: number };
    return Number(row.n);
  },
  /** Активные сотрудники роли (для проверки «не остаться без владельца права»). */
  countActiveStaffOfRole(db: Db, roleId: number): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM staff WHERE role_id = ? AND active = 1').get(roleId) as { n: number }).n);
  },
};
