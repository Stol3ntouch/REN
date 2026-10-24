import type { Db } from '../connection';

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

export type StaffListRow = {
  id: number;
  email: string;
  name: string | null;
  /** Код роли. */
  role: string;
  roleId: number;
  roleName: string;
  active: boolean;
  createdAt: number;
  lastLoginAt: number | null;
};
export type StaffSearch = { q?: string; roleId?: number; active?: boolean; sort?: 'login' | 'name' | 'role' | 'created' | 'last_login'; dir?: 'asc' | 'desc'; limit: number; offset: number };

type ListRaw = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  role_id: number;
  role_name: string;
  active: number;
  created_at: number;
  last_login_at: number | null;
};
const mapList = (r: ListRaw): StaffListRow => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  roleId: r.role_id,
  roleName: r.role_name,
  active: r.active === 1,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});
const LIST_SELECT = `SELECT s.id, s.email, s.name, s.active, s.created_at, s.last_login_at, s.role_id, r.code AS role, r.name AS role_name
                       FROM staff s JOIN roles r ON r.id = s.role_id`;
const SORT_SQL = { login: 's.email', name: 's.name', role: 'r.name', created: 's.created_at', last_login: 's.last_login_at' } as const;
const likeEscape = (v: string): string => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export const staffAdminRepo = {
  list(db: Db): StaffListRow[] {
    return (db.prepare(`${LIST_SELECT} ORDER BY s.id`).all() as ListRaw[]).map(mapList);
  },
  /** Страница сотрудников с фильтрами: поиск по логину и имени, роль, статус; сортировка по белому списку колонок. */
  search(db: Db, f: StaffSearch): { rows: StaffListRow[]; total: number } {
    const where: string[] = [];
    const args: (string | number)[] = [];
    const q = f.q?.trim().toLowerCase();
    if (q) {
      where.push("(lower(s.email) LIKE ? ESCAPE '\\' OR lower(COALESCE(s.name, '')) LIKE ? ESCAPE '\\')");
      args.push(`%${likeEscape(q)}%`, `%${likeEscape(q)}%`);
    }
    if (f.roleId) {
      where.push('s.role_id = ?');
      args.push(f.roleId);
    }
    if (f.active !== undefined) {
      where.push('s.active = ?');
      args.push(f.active ? 1 : 0);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM staff s JOIN roles r ON r.id = s.role_id ${w}`).get(...args) as { n: number }).n);
    const col = SORT_SQL[f.sort ?? 'login'];
    const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
    const rows = db.prepare(`${LIST_SELECT} ${w} ORDER BY ${col} ${dir}, s.id LIMIT ? OFFSET ?`).all(...args, f.limit, f.offset) as ListRaw[];
    return { rows: rows.map(mapList), total };
  },
  setRoleId(db: Db, id: number, roleId: number): void {
    db.prepare('UPDATE staff SET role_id = ? WHERE id = ?').run(roleId, id);
  },
  setName(db: Db, id: number, name: string | null): void {
    db.prepare('UPDATE staff SET name = ? WHERE id = ?').run(name, id);
  },
  setPasswordHash(db: Db, id: number, passwordHash: string): void {
    db.prepare('UPDATE staff SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  },
  /** Блокировка также закрывает все открытые сессии сотрудника. Возвращает число закрытых сессий. */
  setActive(db: Db, id: number, active: boolean): number {
    db.prepare('UPDATE staff SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    if (active) return 0;
    return Number(db.prepare('DELETE FROM staff_sessions WHERE staff_id = ?').run(id).changes);
  },
  countSessions(db: Db, id: number, now: number): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM staff_sessions WHERE staff_id = ? AND expires_at > ?').get(id, now) as { n: number }).n);
  },
};
