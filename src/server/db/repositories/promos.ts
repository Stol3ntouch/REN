import type { Db } from '../connection';

export type PromoRow = {
  id: number;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  startsAt: number | null;
  endsAt: number | null;
  usageLimit: number | null;
  usedCount: number;
  minSubtotalKopecks: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

type Raw = {
  id: number;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  starts_at: number | null;
  ends_at: number | null;
  usage_limit: number | null;
  used_count: number;
  min_subtotal_kopecks: number;
  enabled: number;
  created_at: number;
  updated_at: number;
};

const map = (r: Raw | undefined): PromoRow | null =>
  r
    ? {
        id: r.id,
        code: r.code,
        type: r.type,
        value: r.value,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        usageLimit: r.usage_limit,
        usedCount: r.used_count,
        minSubtotalKopecks: r.min_subtotal_kopecks,
        enabled: r.enabled === 1,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }
    : null;

export type PromoWrite = {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  startsAt: number | null;
  endsAt: number | null;
  usageLimit: number | null;
  minSubtotalKopecks: number;
  enabled: boolean;
};

export const promosRepo = {
  findByCode(db: Db, code: string): PromoRow | null {
    return map(db.prepare('SELECT * FROM promos WHERE code = ?').get(code) as Raw | undefined);
  },
  findById(db: Db, id: number): PromoRow | null {
    return map(db.prepare('SELECT * FROM promos WHERE id = ?').get(id) as Raw | undefined);
  },
  list(db: Db): PromoRow[] {
    return (db.prepare('SELECT * FROM promos ORDER BY id DESC').all() as Raw[]).map((r) => map(r)!);
  },
  /** UNIQUE по code: дубль бросает ошибку SQLite — вызывающий превращает её в ConflictError. */
  insert(db: Db, v: PromoWrite, now: number): number {
    const r = db
      .prepare(
        `INSERT INTO promos (code, type, value, starts_at, ends_at, usage_limit, min_subtotal_kopecks, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(v.code, v.type, v.value, v.startsAt, v.endsAt, v.usageLimit, v.minSubtotalKopecks, v.enabled ? 1 : 0, now, now);
    return Number(r.lastInsertRowid);
  },
  update(db: Db, id: number, v: PromoWrite, now: number): boolean {
    const r = db
      .prepare(
        `UPDATE promos SET code = ?, type = ?, value = ?, starts_at = ?, ends_at = ?, usage_limit = ?,
         min_subtotal_kopecks = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(v.code, v.type, v.value, v.startsAt, v.endsAt, v.usageLimit, v.minSubtotalKopecks, v.enabled ? 1 : 0, now, id);
    return Number(r.changes) > 0;
  },
  delete(db: Db, id: number): boolean {
    return Number(db.prepare('DELETE FROM promos WHERE id = ?').run(id).changes) > 0;
  },
  /** Возвращает одно использование (не ниже 0): заказ с этим промокодом отменён. */
  release(db: Db, id: number): void {
    db.prepare('UPDATE promos SET used_count = MAX(used_count - 1, 0) WHERE id = ?').run(id);
  },
  /** Атомарно занимает одно использование; false — лимит исчерпан (или промокода нет). */
  tryConsume(db: Db, id: number): boolean {
    const r = db
      .prepare('UPDATE promos SET used_count = used_count + 1 WHERE id = ? AND (usage_limit IS NULL OR used_count < usage_limit)')
      .run(id);
    return Number(r.changes) > 0;
  },
};
