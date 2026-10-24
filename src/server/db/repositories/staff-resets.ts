import type { Db } from '../connection';

export type StaffLinkKind = 'reset' | 'invite';

/** Одноразовые ссылки сотрудников (сброс пароля, приглашение): в БД только хеш токена. */
export const staffResetsRepo = {
  insert(db: Db, v: { staffId: number; tokenHash: string; kind: StaffLinkKind; createdBy: number | null; now: number; expiresAt: number }): void {
    db.prepare('INSERT INTO staff_password_resets (staff_id, token_hash, kind, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      v.staffId,
      v.tokenHash,
      v.kind,
      v.createdBy,
      v.now,
      v.expiresAt,
    );
  },
  /** Гасит неиспользованные ссылки сотрудника: новая ссылка отменяет старые. */
  expireOpen(db: Db, staffId: number, now: number): void {
    db.prepare('UPDATE staff_password_resets SET used_at = ? WHERE staff_id = ? AND used_at IS NULL').run(now, staffId);
  },
  /** Ссылка ещё живая? Не расходует её. */
  peek(db: Db, tokenHash: string, now: number): { staffId: number; kind: StaffLinkKind } | null {
    const r = db
      .prepare('SELECT staff_id, kind FROM staff_password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(tokenHash, now) as { staff_id: number; kind: StaffLinkKind } | undefined;
    return r ? { staffId: r.staff_id, kind: r.kind } : null;
  },
  /** Атомарно «сжигает» ссылку: вернёт данные только один раз и только пока она живая. */
  consume(db: Db, tokenHash: string, now: number): { staffId: number; kind: StaffLinkKind } | null {
    const r = db
      .prepare('UPDATE staff_password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING staff_id, kind')
      .get(now, tokenHash, now) as { staff_id: number; kind: StaffLinkKind } | undefined;
    return r ? { staffId: r.staff_id, kind: r.kind } : null;
  },
};
