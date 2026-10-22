import type { Db } from '../connection';

export type StaffRole = 'admin' | 'manager';
export type StaffRow = {
  id: number;
  email: string;
  name: string | null;
  role: StaffRole;
  passwordHash: string;
  active: boolean;
  createdAt: number;
  lastLoginAt: number | null;
};

type Raw = {
  id: number;
  email: string;
  name: string | null;
  role: StaffRole;
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
        passwordHash: r.password_hash,
        active: r.active === 1,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
      }
    : null;

export const staffRepo = {
  findByEmail(db: Db, email: string): StaffRow | null {
    return map(db.prepare('SELECT * FROM staff WHERE email = ?').get(email) as Raw | undefined);
  },
  findById(db: Db, id: number): StaffRow | null {
    return map(db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as Raw | undefined);
  },
  insert(db: Db, v: { email: string; name?: string | null; role: StaffRole; passwordHash: string; now: number }): number {
    const r = db
      .prepare('INSERT INTO staff (email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(v.email, v.name ?? null, v.role, v.passwordHash, v.now);
    return Number(r.lastInsertRowid);
  },
  list(db: Db): StaffRow[] {
    return (db.prepare('SELECT * FROM staff ORDER BY id').all() as Raw[]).map((r) => map(r)!);
  },
  touchLogin(db: Db, id: number, now: number): void {
    db.prepare('UPDATE staff SET last_login_at = ? WHERE id = ?').run(now, id);
  },
};
