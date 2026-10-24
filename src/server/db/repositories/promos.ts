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
  /** Купон не действует на позиции с акционной или скидочной ценой. */
  excludeOnSale: boolean;
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
  exclude_on_sale: number;
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
        excludeOnSale: r.exclude_on_sale === 1,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }
    : null;

export type PromoUsageRow = { orderNumber: string; status: string; discountKopecks: number; totalKopecks: number; createdAt: number };

export type PromoWrite = {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  startsAt: number | null;
  endsAt: number | null;
  usageLimit: number | null;
  minSubtotalKopecks: number;
  enabled: boolean;
  excludeOnSale?: boolean;
};

export type PromoFilter = {
  q?: string;
  status?: 'enabled' | 'disabled' | 'expired' | 'exhausted';
  sort?: 'created' | 'code' | 'used' | 'ends';
  dir?: 'asc' | 'desc';
  limit: number;
  offset: number;
};

const PROMO_SORTS = { created: 'created_at', code: 'code', used: 'used_count', ends: 'ends_at' } as const;

export const promosRepo = {
  /** Список купонов для админки: поиск по коду, фильтр по состоянию, сортировка из белого списка, страница. */
  search(db: Db, f: PromoFilter, now: number): { rows: PromoRow[]; total: number } {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (f.q && f.q.trim() !== '') {
      conds.push("code LIKE ? ESCAPE '\\'");
      params.push(`%${f.q.trim().toUpperCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (f.status === 'enabled') conds.push('enabled = 1');
    if (f.status === 'disabled') conds.push('enabled = 0');
    if (f.status === 'expired') {
      conds.push('ends_at IS NOT NULL AND ends_at < ?');
      params.push(now);
    }
    if (f.status === 'exhausted') conds.push('usage_limit IS NOT NULL AND used_count >= usage_limit');
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM promos ${where}`).get(...params) as { n: number }).n;
    const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
    const rows = (db.prepare(`SELECT * FROM promos ${where} ORDER BY ${PROMO_SORTS[f.sort ?? 'created']} ${dir}, id ${dir} LIMIT ? OFFSET ?`).all(...params, f.limit, f.offset) as Raw[]).map((r) => map(r)!);
    return { rows, total };
  },
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
        `INSERT INTO promos (code, type, value, starts_at, ends_at, usage_limit, min_subtotal_kopecks, enabled, exclude_on_sale, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(v.code, v.type, v.value, v.startsAt, v.endsAt, v.usageLimit, v.minSubtotalKopecks, v.enabled ? 1 : 0, v.excludeOnSale ? 1 : 0, now, now);
    return Number(r.lastInsertRowid);
  },
  update(db: Db, id: number, v: PromoWrite, now: number): boolean {
    const r = db
      .prepare(
        `UPDATE promos SET code = ?, type = ?, value = ?, starts_at = ?, ends_at = ?, usage_limit = ?,
         min_subtotal_kopecks = ?, enabled = ?, exclude_on_sale = ?, updated_at = ? WHERE id = ?`,
      )
      .run(v.code, v.type, v.value, v.startsAt, v.endsAt, v.usageLimit, v.minSubtotalKopecks, v.enabled ? 1 : 0, v.excludeOnSale ? 1 : 0, now, id);
    return Number(r.changes) > 0;
  },
  /** Заказы, где применён купон: для отчёта об использовании. */
  usage(db: Db, promoId: number, limit = 200): PromoUsageRow[] {
    return (
      db
        .prepare('SELECT number, status, discount_kopecks, total_kopecks, created_at FROM orders WHERE promo_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(promoId, limit) as { number: string; status: string; discount_kopecks: number; total_kopecks: number; created_at: number }[]
    ).map((r) => ({ orderNumber: r.number, status: r.status, discountKopecks: r.discount_kopecks, totalKopecks: r.total_kopecks, createdAt: r.created_at }));
  },
  /** Итоги по купону среди оформленных заказов, не отменённых и не возвращённых. */
  usageTotals(db: Db, promoId: number): { orders: number; discountKopecks: number; revenueKopecks: number } {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(discount_kopecks), 0) AS d, COALESCE(SUM(total_kopecks), 0) AS t FROM orders
         WHERE promo_id = ? AND status NOT IN ('cancelled', 'refunded', 'payment_failed')`,
      )
      .get(promoId) as { n: number; d: number; t: number };
    return { orders: Number(r.n), discountKopecks: Number(r.d), revenueKopecks: Number(r.t) };
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
