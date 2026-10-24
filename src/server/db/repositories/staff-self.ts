import type { Db } from '../connection';

/** Правки сотрудником самого себя (профиль): имя, пароль, завершение прочих сессий. */
export const staffSelfRepo = {
  setName(db: Db, id: number, name: string | null): void {
    db.prepare('UPDATE staff SET name = ? WHERE id = ?').run(name, id);
  },
  setPasswordHash(db: Db, id: number, passwordHash: string): void {
    db.prepare('UPDATE staff SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  },
  /** Закрывает все сессии сотрудника, кроме текущей (хеш токена). Без текущей — закрывает все. Возвращает число закрытых. */
  deleteOtherSessions(db: Db, id: number, keepTokenHash: string | null): number {
    const r =
      keepTokenHash === null
        ? db.prepare('DELETE FROM staff_sessions WHERE staff_id = ?').run(id)
        : db.prepare('DELETE FROM staff_sessions WHERE staff_id = ? AND token_hash <> ?').run(id, keepTokenHash);
    return Number(r.changes);
  },
};
