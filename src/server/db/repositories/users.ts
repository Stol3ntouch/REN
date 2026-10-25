import type { Db } from '../connection';

export type UserStatus = 'active' | 'vip' | 'blocked';
export type UserRow = { id: number; email: string; passwordHash: string; createdAt: number; lastLoginAt: number | null; status: UserStatus };

type Raw = { id: number; email: string; password_hash: string; created_at: number; last_login_at: number | null; status?: UserStatus };
const map = (r: Raw | undefined): UserRow | null =>
  r ? { id: r.id, email: r.email, passwordHash: r.password_hash, createdAt: r.created_at, lastLoginAt: r.last_login_at, status: r.status ?? 'active' } : null;

export const usersRepo = {
  findByEmail(db: Db, email: string): UserRow | null {
    return map(db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Raw | undefined);
  },
  findById(db: Db, id: number): UserRow | null {
    return map(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Raw | undefined);
  },
  /** Бросает ошибку UNIQUE при дубле email — вызывающий превращает её в ConflictError. */
  insert(db: Db, v: { email: string; passwordHash: string; now: number }): number {
    const r = db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)').run(v.email, v.passwordHash, v.now);
    return Number(r.lastInsertRowid);
  },
  setPasswordHash(db: Db, id: number, passwordHash: string): void {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  },
  touchLogin(db: Db, id: number, now: number): void {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, id);
  },
  setStatus(db: Db, id: number, status: UserStatus): void {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  },
};
