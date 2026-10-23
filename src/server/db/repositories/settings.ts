import type { Db } from '../connection';

/** Общие настройки магазина: ключ-значение (таблица shop_settings). Пустого значения не храним — ключ удаляется. */
export const settingsRepo = {
  get(db: Db, key: string): string | null {
    const r = db.prepare('SELECT value FROM shop_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? r.value : null;
  },
  all(db: Db): Record<string, string> {
    const rows = db.prepare('SELECT key, value FROM shop_settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  set(db: Db, key: string, value: string, now: number): void {
    db.prepare(
      'INSERT INTO shop_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run(key, value, now);
  },
  delete(db: Db, key: string): void {
    db.prepare('DELETE FROM shop_settings WHERE key = ?').run(key);
  },
};
