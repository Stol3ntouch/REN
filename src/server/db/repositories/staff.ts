import type { Db } from '../connection';

/** Код роли сотрудника (roles.code): системные admin, manager… или своя роль. */
export type StaffRole = string;
export type StaffRow = {
  id: number;
  email: string;
  name: string | null;
  /** Код роли. */
  role: StaffRole;
  roleId: number;
  roleName: string;
  passwordHash: string;
  active: boolean;
  createdAt: number;
  lastLoginAt: number | null;
};

type Raw = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  role_id: number;
  role_name: string;
  password_hash: string;
  active: number;
  created_at: number;
  last_login_at: number | null;
};
const map = (r: Raw | undefined): StaffRow | null =>
  r
    ? {
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        roleId: r.role_id,
        roleName: r.role_name,
        passwordHash: r.password_hash,
        active: r.active === 1,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
      }
    : null;

const SELECT = `SELECT s.id, s.email, s.name, s.password_hash, s.active, s.created_at, s.last_login_at,
                       s.role_id, r.code AS role, r.name AS role_name
                  FROM staff s JOIN roles r ON r.id = s.role_id`;

export const staffRepo = {
  findByEmail(db: Db, email: string): StaffRow | null {
    return map(db.prepare(`${SELECT} WHERE s.email = ?`).get(email) as Raw | undefined);
  },
  findById(db: Db, id: number): StaffRow | null {
    return map(db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as Raw | undefined);
  },
  /** Создаёт сотрудника; роль — по коду (несуществующий код → ошибка NOT NULL, её ловит вызывающий заранее). */
  insert(db: Db, v: { email: string; name?: string | null; role: StaffRole; passwordHash: string; now: number }): number {
    const r = db
      .prepare('INSERT INTO staff (email, name, role_id, password_hash, created_at) VALUES (?, ?, (SELECT id FROM roles WHERE code = ?), ?, ?)')
      .run(v.email, v.name ?? null, v.role, v.passwordHash, v.now);
    return Number(r.lastInsertRowid);
  },
  list(db: Db): StaffRow[] {
    return (db.prepare(`${SELECT} ORDER BY s.id`).all() as Raw[]).map((r) => map(r)!);
  },
  touchLogin(db: Db, id: number, now: number): void {
    db.prepare('UPDATE staff SET last_login_at = ? WHERE id = ?').run(now, id);
  },
};
