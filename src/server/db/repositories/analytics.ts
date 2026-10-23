import type { Db } from '../connection';

/** Период [from, to) в unix-мс. Время суток считается по Москве (UTC+3, без перехода на летнее). */
export type Period = { from: number; to: number };
export type Bucket = 'day' | 'week' | 'month';

const MSK_SECONDS = 3 * 3600;
const marks = (list: readonly string[]) => list.map(() => '?').join(',');

/** Выражение даты заказа в московском времени для группировки. */
function bucketExpr(g: Bucket): string {
  if (g === 'day') return "strftime('%Y-%m-%d', o.created_at / 1000 + 10800, 'unixepoch')";
  if (g === 'month') return "strftime('%Y-%m', o.created_at / 1000 + 10800, 'unixepoch')";
  return "date(o.created_at / 1000, 'unixepoch', '+3 hours', 'weekday 0', '-6 days')"; // понедельник недели
}

export const analyticsRepo = {
  /** Создано заказов, неотменённых, оплаченных, выручка оплаченных неотменённых. */
  summary(db: Db, p: Period, notCounted: readonly string[]) {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS created,
                COALESCE(SUM(CASE WHEN status NOT IN (${marks(notCounted)}) THEN 1 ELSE 0 END), 0) AS counted,
                COALESCE(SUM(CASE WHEN status NOT IN (${marks(notCounted)}) AND is_paid = 1 THEN 1 ELSE 0 END), 0) AS paid,
                COALESCE(SUM(CASE WHEN status NOT IN (${marks(notCounted)}) AND is_paid = 1 THEN total_kopecks ELSE 0 END), 0) AS revenue
         FROM orders WHERE created_at >= ? AND created_at < ?`,
      )
      .get(...notCounted, ...notCounted, ...notCounted, p.from, p.to) as { created: number; counted: number; paid: number; revenue: number };
    return { ordersCreated: Number(r.created), ordersCounted: Number(r.counted), paidOrders: Number(r.paid), revenueKopecks: Number(r.revenue) };
  },

  series(db: Db, p: Period, g: Bucket, notCounted: readonly string[]): { bucket: string; orders: number; revenueKopecks: number }[] {
    const rows = db
      .prepare(
        `SELECT ${bucketExpr(g)} AS bucket, COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN o.is_paid = 1 THEN o.total_kopecks ELSE 0 END), 0) AS revenue
         FROM orders o WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN (${marks(notCounted)})
         GROUP BY bucket ORDER BY bucket`,
      )
      .all(p.from, p.to, ...notCounted) as { bucket: string; orders: number; revenue: number }[];
    return rows.map((r) => ({ bucket: r.bucket, orders: Number(r.orders), revenueKopecks: Number(r.revenue) }));
  },

  /** Продажи по категориям: строки оплаченных неотменённых заказов; удалённый товар — «Без категории». */
  byCategory(db: Db, p: Period, notCounted: readonly string[]): { categoryId: number | null; name: string; units: number; revenueKopecks: number }[] {
    const rows = db
      .prepare(
        `SELECT c.id AS category_id, COALESCE(c.name, 'Без категории') AS name, SUM(i.qty) AS units, SUM(i.line_kopecks) AS revenue
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
         LEFT JOIN products pr ON pr.id = i.product_id
         LEFT JOIN categories c ON c.id = pr.category_id
         WHERE o.created_at >= ? AND o.created_at < ? AND o.is_paid = 1 AND o.status NOT IN (${marks(notCounted)})
         GROUP BY c.id ORDER BY revenue DESC, name`,
      )
      .all(p.from, p.to, ...notCounted) as { category_id: number | null; name: string; units: number; revenue: number }[];
    return rows.map((r) => ({ categoryId: r.category_id, name: r.name, units: Number(r.units), revenueKopecks: Number(r.revenue) }));
  },

  byProduct(db: Db, p: Period, limit: number, notCounted: readonly string[]): { productId: number | null; name: string; sku: string | null; units: number; revenueKopecks: number }[] {
    const rows = db
      .prepare(
        `SELECT i.product_id AS product_id, MAX(i.name) AS name, MAX(i.sku) AS sku, SUM(i.qty) AS units, SUM(i.line_kopecks) AS revenue
         FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE o.created_at >= ? AND o.created_at < ? AND o.is_paid = 1 AND o.status NOT IN (${marks(notCounted)})
         GROUP BY COALESCE(i.product_id, -i.id) ORDER BY revenue DESC, name LIMIT ?`,
      )
      .all(p.from, p.to, ...notCounted, Math.min(Math.max(limit, 1), 500)) as { product_id: number | null; name: string; sku: string | null; units: number; revenue: number }[];
    return rows.map((r) => ({ productId: r.product_id, name: r.name, sku: r.sku, units: Number(r.units), revenueKopecks: Number(r.revenue) }));
  },

  /** Отменённые и возвращённые за период (по дате создания заказа). */
  cancellations(db: Db, p: Period) {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS created,
                COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
                COALESCE(SUM(CASE WHEN status = 'cancelled' THEN total_kopecks ELSE 0 END), 0) AS cancelled_sum,
                COALESCE(SUM(status = 'refunded'), 0) AS refunded,
                COALESCE(SUM(CASE WHEN status = 'refunded' THEN total_kopecks ELSE 0 END), 0) AS refunded_sum
         FROM orders WHERE created_at >= ? AND created_at < ?`,
      )
      .get(p.from, p.to) as { created: number; cancelled: number; cancelled_sum: number; refunded: number; refunded_sum: number };
    return {
      ordersCreated: Number(r.created),
      cancelled: Number(r.cancelled),
      cancelledKopecks: Number(r.cancelled_sum),
      refunded: Number(r.refunded),
      refundedKopecks: Number(r.refunded_sum),
    };
  },

  tableExists(db: Db, name: string): boolean {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  },

  columnNames(db: Db, table: string): string[] {
    if (!/^[a-z_]+$/.test(table)) return [];
    return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  },

  /** Число строк таблицы с условием status = value. Имя таблицы — только из белого списка вызывающего. */
  countWhereStatus(db: Db, table: string, status: string): number {
    if (!/^[a-z_]+$/.test(table)) return 0;
    return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE status = ?`).get(status) as { n: number }).n);
  },

  /** Число строк таблицы по kind и status. */
  countByKindStatus(db: Db, table: string, kind: string, status: string): number {
    if (!/^[a-z_]+$/.test(table)) return 0;
    return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ? AND status = ?`).get(kind, status) as { n: number }).n);
  },
};

export const MOSCOW_OFFSET_SECONDS = MSK_SECONDS;
