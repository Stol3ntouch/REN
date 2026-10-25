import type { Db } from '../connection';

/** Подтверждение email покупателя: одноразовые ссылки (хеш токена) и отметка users.email_verified_at. */
export const emailVerificationsRepo = {
  isVerified(db: Db, userId: number): boolean {
    const r = db.prepare('SELECT email_verified_at AS v FROM users WHERE id = ?').get(userId) as { v: number | null } | undefined;
    return r?.v != null;
  },
  /** Гасит неиспользованные ссылки пользователя (новая ссылка отменяет старые). */
  expireOpen(db: Db, userId: number, now: number): void {
    db.prepare('UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now, userId);
  },
  insert(db: Db, v: { userId: number; tokenHash: string; now: number; expiresAt: number }): void {
    db.prepare('INSERT INTO email_verifications (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)').run(v.userId, v.tokenHash, v.now, v.expiresAt);
  },
  /** Атомарно «сжигает» ссылку: вернёт userId один раз и только пока ссылка живая. */
  consume(db: Db, tokenHash: string, now: number): number | null {
    const row = db
      .prepare('UPDATE email_verifications SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id')
      .get(now, tokenHash, now) as { user_id: number } | undefined;
    return row?.user_id ?? null;
  },
  markVerified(db: Db, userId: number, now: number): void {
    db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL').run(now, userId);
  },
};
