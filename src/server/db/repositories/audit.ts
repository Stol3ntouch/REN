import type { Db } from '../connection';

export type ActorType = 'staff' | 'user' | 'system';
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
};
export type AuditFilter = { entity?: string; entityId?: string; actorId?: string; action?: string; limit?: number; offset?: number };

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
};
const parse = (s: string | null): unknown => (s === null ? undefined : JSON.parse(s));

/** Только добавление и чтение: методов изменения/удаления нет (и триггеры БД их запрещают). */
export const auditRepo = {
  insert(
    db: Db,
    v: { at: number; actorId: string | null; actorType: ActorType; action: string; entity: string; entityId: string | null; beforeJson: string | null; afterJson: string | null },
  ): number {
    const r = db
      .prepare('INSERT INTO audit_log (at, actor_id, actor_type, action, entity, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(v.at, v.actorId, v.actorType, v.action, v.entity, v.entityId, v.beforeJson, v.afterJson);
    return Number(r.lastInsertRowid);
  },
  list(db: Db, f: AuditFilter = {}): AuditRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.entity) {
      where.push('entity = ?');
      args.push(f.entity);
    }
    if (f.entityId) {
      where.push('entity_id = ?');
      args.push(f.entityId);
    }
    if (f.actorId) {
      where.push('actor_id = ?');
      args.push(f.actorId);
    }
    if (f.action) {
      where.push('action = ?');
      args.push(f.action);
    }
    const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ? OFFSET ?`;
    args.push(Math.min(f.limit ?? 50, 500), f.offset ?? 0);
    return (db.prepare(sql).all(...args) as Raw[]).map((r) => ({
      id: r.id,
      at: r.at,
      actorId: r.actor_id,
      actorType: r.actor_type,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      before: parse(r.before_json),
      after: parse(r.after_json),
    }));
  },
};
