import type { Db } from '../connection';

/** Сессии покупателей и сотрудников: разные таблицы, в БД только хеш токена. */
export type SessionKind = 'user' | 'staff';
const TABLE: Record<SessionKind, { table: string; owner: string }> = {
  user: { table: 'user_sessions', owner: 'user_id' },
  staff: { table: 'staff_sessions', owner: 'staff_id' },
};

export const sessionsRepo = {
  insert(db: Db, kind: SessionKind, v: { ownerId: number; tokenHash: string; now: number; expiresAt: number }): void {
    const t = TABLE[kind];
    db.prepare(`INSERT INTO ${t.table} (${t.owner}, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(
      v.ownerId,
      v.tokenHash,
      v.now,
      v.expiresAt,
    );
  },
  /** Владелец живой сессии или null. */
  findOwnerId(db: Db, kind: SessionKind, tokenHash: string, now: number): number | null {
    const t = TABLE[kind];
    const row = db.prepare(`SELECT ${t.owner} AS owner_id FROM ${t.table} WHERE token_hash = ? AND expires_at > ?`).get(tokenHash, now) as
      | { owner_id: number }
      | undefined;
    return row?.owner_id ?? null;
  },
  deleteByHash(db: Db, kind: SessionKind, tokenHash: string): void {
    db.prepare(`DELETE FROM ${TABLE[kind].table} WHERE token_hash = ?`).run(tokenHash);
  },
  deleteAllForOwner(db: Db, kind: SessionKind, ownerId: number): void {
    const t = TABLE[kind];
    db.prepare(`DELETE FROM ${t.table} WHERE ${t.owner} = ?`).run(ownerId);
  },
  deleteExpired(db: Db, kind: SessionKind, now: number): void {
    db.prepare(`DELETE FROM ${TABLE[kind].table} WHERE expires_at <= ?`).run(now);
  },

  // --- сброс пароля ---
  insertReset(db: Db, v: { userId: number; tokenHash: string; now: number; expiresAt: number }): void {
    db.prepare('INSERT INTO password_resets (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      v.userId,
      v.tokenHash,
      v.now,
      v.expiresAt,
    );
  },
  /** Гасит неиспользованные ссылки пользователя (новый запрос отменяет старые). */
  expireOpenResets(db: Db, userId: number, now: number): void {
    db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now, userId);
  },
  /** Атомарно «сжигает» ссылку: вернёт userId только один раз и только пока ссылка живая. */
  consumeReset(db: Db, tokenHash: string, now: number): number | null {
    const row = db
      .prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id')
      .get(now, tokenHash, now) as { user_id: number } | undefined;
    return row?.user_id ?? null;
  },

  // --- блокировка перебора ---
  addFailure(db: Db, scope: SessionKind, key: string, now: number): void {
    db.prepare('INSERT INTO login_failures (scope, key, at) VALUES (?, ?, ?)').run(scope, key, now);
  },
  /** Неудачи после момента since и время самой ранней из них. */
  failuresSince(db: Db, scope: SessionKind, key: string, since: number): { count: number; oldest: number | null } {
    const r = db
      .prepare('SELECT COUNT(*) AS c, MIN(at) AS o FROM login_failures WHERE scope = ? AND key = ? AND at > ?')
      .get(scope, key, since) as { c: number; o: number | null };
    return { count: r.c, oldest: r.o };
  },
  clearFailures(db: Db, scope: SessionKind, key: string): void {
    db.prepare('DELETE FROM login_failures WHERE scope = ? AND key = ?').run(scope, key);
  },
  purgeFailures(db: Db, before: number): void {
    db.prepare('DELETE FROM login_failures WHERE at <= ?').run(before);
  },
};
