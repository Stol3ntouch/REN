import type { Db } from '../connection';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';
export type NotificationRow = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  entity: string | null;
  entityId: string | null;
  href: string | null;
  severity: NotificationSeverity;
  audience: string;
  createdAt: number;
};
export type NotificationForStaff = NotificationRow & { read: boolean; readAt: number | null };

type Raw = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  entity: string | null;
  entity_id: string | null;
  href: string | null;
  severity: NotificationSeverity;
  audience: string;
  created_at: number;
  read_at?: number | null;
};
const map = (r: Raw): NotificationRow => ({
  id: r.id,
  type: r.type,
  title: r.title,
  body: r.body,
  entity: r.entity,
  entityId: r.entity_id,
  href: r.href,
  severity: r.severity,
  audience: r.audience,
  createdAt: r.created_at,
});

/**
 * Условие видимости для сотрудника: audience = 'all' или 'permission:<право>' из набора прав сотрудника.
 * Права передаются параметрами (а не в SQL), поэтому подстановка безопасна.
 */
function audienceSql(permissions: readonly string[]): { sql: string; args: string[] } {
  const marks = permissions.map(() => '?').join(', ');
  const perm = permissions.length > 0 ? ` OR n.audience IN (${marks})` : '';
  return { sql: `(n.audience = 'all'${perm})`, args: permissions.map((p) => `permission:${p}`) };
}

export const notificationsRepo = {
  insert(
    db: Db,
    v: { type: string; title: string; body: string | null; entity: string | null; entityId: string | null; href: string | null; severity: NotificationSeverity; audience: string; now: number },
  ): number {
    const r = db
      .prepare('INSERT INTO admin_notifications (type, title, body, entity, entity_id, href, severity, audience, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(v.type, v.title, v.body, v.entity, v.entityId, v.href, v.severity, v.audience, v.now);
    return Number(r.lastInsertRowid);
  },
  /** Недавнее уведомление с тем же типом и объектом (для дедупликации). */
  findRecent(db: Db, v: { type: string; entity: string | null; entityId: string; since: number }): number | null {
    const r = db
      .prepare('SELECT id FROM admin_notifications WHERE type = ? AND entity IS ? AND entity_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 1')
      .get(v.type, v.entity, v.entityId, v.since) as { id: number } | undefined;
    return r?.id ?? null;
  },
  listForStaff(db: Db, staffId: number, permissions: readonly string[], f: { unreadOnly: boolean; limit: number; offset: number }): NotificationForStaff[] {
    const a = audienceSql(permissions);
    const rows = db
      .prepare(
        `SELECT n.*, r.read_at FROM admin_notifications n
           LEFT JOIN admin_notification_reads r ON r.notification_id = n.id AND r.staff_id = ?
          WHERE ${a.sql} ${f.unreadOnly ? 'AND r.read_at IS NULL' : ''}
          ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`,
      )
      .all(staffId, ...a.args, f.limit, f.offset) as Raw[];
    return rows.map((r) => ({ ...map(r), read: r.read_at !== null && r.read_at !== undefined, readAt: r.read_at ?? null }));
  },
  countForStaff(db: Db, staffId: number, permissions: readonly string[], unreadOnly: boolean): number {
    const a = audienceSql(permissions);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM admin_notifications n
           LEFT JOIN admin_notification_reads r ON r.notification_id = n.id AND r.staff_id = ?
          WHERE ${a.sql} ${unreadOnly ? 'AND r.read_at IS NULL' : ''}`,
      )
      .get(staffId, ...a.args) as { n: number };
    return Number(row.n);
  },
  /** Видно ли уведомление сотруднику (по audience). */
  isVisible(db: Db, id: number, permissions: readonly string[]): boolean {
    const a = audienceSql(permissions);
    return db.prepare(`SELECT 1 AS ok FROM admin_notifications n WHERE n.id = ? AND ${a.sql}`).get(id, ...a.args) !== undefined;
  },
  markRead(db: Db, id: number, staffId: number, now: number): void {
    db.prepare('INSERT OR IGNORE INTO admin_notification_reads (notification_id, staff_id, read_at) VALUES (?, ?, ?)').run(id, staffId, now);
  },
  /** Отмечает прочитанными все видимые сотруднику непрочитанные. Возвращает число отмеченных. */
  markAllRead(db: Db, staffId: number, permissions: readonly string[], now: number): number {
    const a = audienceSql(permissions);
    const r = db
      .prepare(
        `INSERT OR IGNORE INTO admin_notification_reads (notification_id, staff_id, read_at)
         SELECT n.id, ?, ? FROM admin_notifications n WHERE ${a.sql}`,
      )
      .run(staffId, now, ...a.args);
    return Number(r.changes);
  },
};
