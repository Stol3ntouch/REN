import type { Db } from '../connection';

export type ActorType = 'staff' | 'user' | 'system';
export type AuditResult = 'ok' | 'denied' | 'error';
export const AUDIT_RESULTS: readonly AuditResult[] = ['ok', 'denied', 'error'];

export type AuditRow = {
  id: number;
  at: number;
  actorId: string | null;
  actorType: ActorType;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  result: AuditResult;
  ipHash: string | null;
  uaHash: string | null;
};
export type AuditFilter = {
  entity?: string;
  entityId?: string;
  actorId?: string;
  /** Точное действие. */
  action?: string;
  /** Тип действия по префиксу: «staff.» — все действия над сотрудниками. */
  actionPrefix?: string;
  result?: AuditResult;
  /** Период, unix-мс: from включительно, to исключительно. */
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
};
export type AuditSearchRow = AuditRow & { actorLabel: string | null };

type Raw = {
  id: number;
  at: number;
  actor_id: string | null;
  actor_type: ActorType;
  action: string;
  entity: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  result: AuditResult;
  ip_hash: string | null;
  ua_hash: string | null;
  actor_label?: string | null;
};
const parse = (s: string | null): unknown => (s === null ? undefined : JSON.parse(s));
const mapRow = (r: Raw): AuditSearchRow => ({
  id: r.id,
  at: r.at,
  actorId: r.actor_id,
  actorType: r.actor_type,
  action: r.action,
  entity: r.entity,
  entityId: r.entity_id,
  before: parse(r.before_json),
  after: parse(r.after_json),
  result: r.result,
  ipHash: r.ip_hash,
  uaHash: r.ua_hash,
  actorLabel: r.actor_label ?? null,
});

const likeEscape = (v: string): string => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function buildWhere(f: AuditFilter): { sql: string; args: (string | number)[] } {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const eq = (col: string, v: string | undefined) => {
    if (v) {
      where.push(`a.${col} = ?`);
      args.push(v);
    }
  };
  eq('entity', f.entity);
  eq('entity_id', f.entityId);
  eq('actor_id', f.actorId);
  eq('action', f.action);
  eq('result', f.result);
  if (f.actionPrefix) {
    where.push("a.action LIKE ? ESCAPE '\\'");
    args.push(`${likeEscape(f.actionPrefix)}%`);
  }
  if (f.from !== undefined) {
    where.push('a.at >= ?');
    args.push(f.from);
  }
  if (f.to !== undefined) {
    where.push('a.at < ?');
    args.push(f.to);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

/** Только добавление и чтение: методов изменения/удаления нет (и триггеры БД их запрещают). */
export const auditRepo = {
  insert(
    db: Db,
    v: {
      at: number;
      actorId: string | null;
      actorType: ActorType;
      action: string;
      entity: string;
      entityId: string | null;
      beforeJson: string | null;
      afterJson: string | null;
      result?: AuditResult;
      ipHash?: string | null;
      uaHash?: string | null;
    },
  ): number {
    const r = db
      .prepare(
        'INSERT INTO audit_log (at, actor_id, actor_type, action, entity, entity_id, before_json, after_json, result, ip_hash, ua_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(v.at, v.actorId, v.actorType, v.action, v.entity, v.entityId, v.beforeJson, v.afterJson, v.result ?? 'ok', v.ipHash ?? null, v.uaHash ?? null);
    return Number(r.lastInsertRowid);
  },
  list(db: Db, f: AuditFilter = {}): AuditRow[] {
    return auditRepo.search(db, f).rows;
  },
  /** Страница журнала + общее число записей под фильтр; для сотрудников подставляется логин. */
  search(db: Db, f: AuditFilter = {}): { rows: AuditSearchRow[]; total: number } {
    const { sql, args } = buildWhere(f);
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${sql}`).get(...args) as { n: number }).n);
    const rows = db
      .prepare(
        `SELECT a.*, CASE WHEN a.actor_type = 'staff' THEN (SELECT s.email FROM staff s WHERE CAST(s.id AS TEXT) = a.actor_id) END AS actor_label
           FROM audit_log a ${sql} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, Math.min(f.limit ?? 50, 5000), f.offset ?? 0) as Raw[];
    return { rows: rows.map(mapRow), total };
  },
};
