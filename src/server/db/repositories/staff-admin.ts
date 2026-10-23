import type { Db } from '../connection';
import type { StaffRole } from './staff';

// ───────── флаги и настройки админки (таблица admin_flags; не shop_settings) ─────────

/** '1' — разрешено править цену/публикацию/описание/SEO вручную; по умолчанию выключено (источник истины — 1С/YML). */
export const FLAG_MANUAL_EDIT = 'catalog.manualEdit';
/** JSON-массив email получателей служебных уведомлений (T09 читает). */
export const FLAG_NOTIFY_RECIPIENTS = 'notifications.recipients';

export const adminFlagsRepo = {
  get(db: Db, key: string): string | null {
    const r = db.prepare('SELECT value FROM admin_flags WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? r.value : null;
  },
  set(db: Db, key: string, value: string, now: number, by: string | null): void {
    db.prepare(
      'INSERT INTO admin_flags (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    ).run(key, value, now, by);
  },
  isManualEditEnabled(db: Db): boolean {
    return adminFlagsRepo.get(db, FLAG_MANUAL_EDIT) === '1';
  },
  /** Получатели уведомлений (email в нижнем регистре). Нет записи или повреждено → пустой список. */
  getRecipients(db: Db): string[] {
    const raw = adminFlagsRepo.get(db, FLAG_NOTIFY_RECIPIENTS);
    if (!raw) return [];
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  },
};

// ───────── сотрудники ─────────

export type StaffListRow = { id: number; email: string; name: string | null; role: StaffRole; active: boolean; createdAt: number; lastLoginAt: number | null };

export const staffAdminRepo = {
  list(db: Db): StaffListRow[] {
    const rows = db.prepare('SELECT id, email, name, role, active, created_at, last_login_at FROM staff ORDER BY id').all() as {
      id: number;
      email: string;
      name: string | null;
      role: StaffRole;
      active: number;
      created_at: number;
      last_login_at: number | null;
    }[];
    return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, active: r.active === 1, createdAt: r.created_at, lastLoginAt: r.last_login_at }));
  },
  countActiveAdmins(db: Db): number {
    return Number((db.prepare("SELECT COUNT(*) AS n FROM staff WHERE role = 'admin' AND active = 1").get() as { n: number }).n);
  },
  setRole(db: Db, id: number, role: StaffRole): void {
    db.prepare('UPDATE staff SET role = ? WHERE id = ?').run(role, id);
  },
  /** Блокировка также закрывает все открытые сессии сотрудника. */
  setActive(db: Db, id: number, active: boolean): void {
    db.prepare('UPDATE staff SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    if (!active) db.prepare('DELETE FROM staff_sessions WHERE staff_id = ?').run(id);
  },
};
