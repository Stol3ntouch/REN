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

  byProduct(db: Db, p: Period, limit: number, notCounted: readonly string[], orderBy: 'revenue' | 'units' = 'revenue'): { productId: number | null; name: string; sku: string | null; units: number; revenueKopecks: number }[] {
    const rows = db
      .prepare(
        `SELECT i.product_id AS product_id, MAX(i.name) AS name, MAX(i.sku) AS sku, SUM(i.qty) AS units, SUM(i.line_kopecks) AS revenue
         FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE o.created_at >= ? AND o.created_at < ? AND o.is_paid = 1 AND o.status NOT IN (${marks(notCounted)})
         GROUP BY COALESCE(i.product_id, -i.id) ORDER BY ${orderBy === 'units' ? 'units DESC, revenue DESC' : 'revenue DESC'}, name LIMIT ?`,
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

  /** Заказы за период по статусам (все статусы, включая отменённые). */
  byStatus(db: Db, p: Period): { status: string; orders: number; totalKopecks: number }[] {
    const rows = db
      .prepare('SELECT status, COUNT(*) AS n, COALESCE(SUM(total_kopecks), 0) AS total FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY status ORDER BY n DESC, status')
      .all(p.from, p.to) as { status: string; n: number; total: number }[];
    return rows.map((r) => ({ status: r.status, orders: Number(r.n), totalKopecks: Number(r.total) }));
  },

  /** Все счётчики карточек Обзора одним запросом: товары, клиенты, обращения, ремонт. Видимый товар: published=1 и не скрыт админом. */
  dashboardCounts(db: Db, p: Period) {
    const r = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM products) AS products_total,
           (SELECT COUNT(*) FROM products WHERE published = 1 AND hidden_by_admin = 0) AS products_visible,
           (SELECT COUNT(*) FROM products WHERE availability = 'out_of_stock') AS out_of_stock,
           (SELECT COUNT(*) FROM users WHERE created_at >= ?1 AND created_at < ?2) AS new_customers,
           (SELECT COUNT(*) FROM requests WHERE kind <> 'repair' AND created_at >= ?1 AND created_at < ?2) AS new_inquiries,
           (SELECT COUNT(*) FROM requests WHERE kind = 'repair' AND created_at >= ?1 AND created_at < ?2) AS new_repairs`,
      )
      .get(p.from, p.to) as Record<string, number>;
    return {
      productsTotal: Number(r.products_total),
      productsVisible: Number(r.products_visible),
      outOfStock: Number(r.out_of_stock),
      newCustomers: Number(r.new_customers),
      newInquiries: Number(r.new_inquiries),
      newRepairs: Number(r.new_repairs),
    };
  },

  recentOrders(db: Db, limit: number): { number: string; contactName: string; status: string; totalKopecks: number; isPaid: boolean; createdAt: number }[] {
    const rows = db
      .prepare('SELECT number, contact_name, status, total_kopecks, is_paid, created_at FROM orders ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(Math.min(Math.max(limit, 1), 50)) as { number: string; contact_name: string; status: string; total_kopecks: number; is_paid: number; created_at: number }[];
    return rows.map((r) => ({ number: r.number, contactName: r.contact_name, status: r.status, totalKopecks: Number(r.total_kopecks), isPaid: r.is_paid === 1, createdAt: Number(r.created_at) }));
  },

  /** Заказы, ждущие дольше порога: новые, оплаченные без обработки и неоплаченные онлайн. */
  staleOrders(db: Db, olderThan: number, limit: number): { total: number; items: { number: string; status: string; createdAt: number; totalKopecks: number }[] } {
    const total = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('new', 'paid', 'awaiting_payment') AND created_at < ?").get(olderThan) as { n: number };
    const rows = db
      .prepare("SELECT number, status, created_at, total_kopecks FROM orders WHERE status IN ('new', 'paid', 'awaiting_payment') AND created_at < ? ORDER BY created_at ASC LIMIT ?")
      .all(olderThan, Math.min(Math.max(limit, 1), 50)) as { number: string; status: string; created_at: number; total_kopecks: number }[];
    return { total: Number(total.n), items: rows.map((r) => ({ number: r.number, status: r.status, createdAt: Number(r.created_at), totalKopecks: Number(r.total_kopecks) })) };
  },

  /** Остатки: нет в наличии и «заканчиваются» (учёт ведётся, свободный остаток от 1 до порога). */
  stockOverview(db: Db, lowThreshold: number, limit: number) {
    const out = db.prepare("SELECT COUNT(*) AS n FROM products WHERE availability = 'out_of_stock'").get() as { n: number };
    const lowWhere = "stock_tracked = 1 AND availability = 'in_stock' AND stock_qty - reserved_qty BETWEEN 1 AND ?";
    const lowTotal = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${lowWhere}`).get(lowThreshold) as { n: number };
    const low = db
      .prepare(`SELECT id, name, sku, stock_qty - reserved_qty AS free FROM products WHERE ${lowWhere} ORDER BY free ASC, name LIMIT ?`)
      .all(lowThreshold, Math.min(Math.max(limit, 1), 100)) as { id: number; name: string; sku: string | null; free: number }[];
    return { outOfStock: Number(out.n), lowTotal: Number(lowTotal.n), low: low.map((r) => ({ productId: r.id, name: r.name, sku: r.sku, free: Number(r.free) })) };
  },

  /** Клиенты: зарегистрировались за период; покупатели периода — новые (раньше не покупали) и повторные. Гости считаются по guest_id. */
  customersSplit(db: Db, p: Period, notCounted: readonly string[]) {
    const registered = db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?').get(p.from, p.to) as { n: number };
    const buyers = db
      .prepare(
        `SELECT COUNT(*) AS buyers, COALESCE(SUM(CASE WHEN earlier > 0 THEN 1 ELSE 0 END), 0) AS repeat_buyers FROM (
           SELECT COALESCE('u' || o.user_id, 'g' || o.guest_id) AS who,
                  (SELECT COUNT(*) FROM orders e WHERE e.created_at < ? AND e.status NOT IN (${marks(notCounted)})
                     AND COALESCE('u' || e.user_id, 'g' || e.guest_id) = COALESCE('u' || o.user_id, 'g' || o.guest_id)) AS earlier
             FROM orders o WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN (${marks(notCounted)})
            GROUP BY who)`,
      )
      .get(p.from, ...notCounted, p.from, p.to, ...notCounted) as { buyers: number; repeat_buyers: number };
    return { registered: Number(registered.n), buyers: Number(buyers.buyers), repeatBuyers: Number(buyers.repeat_buyers), newBuyers: Number(buyers.buyers) - Number(buyers.repeat_buyers) };
  },

  /** Маржа по строкам оплаченных неотменённых заказов с известной закупочной ценой; строки без неё считаются отдельно. */
  margin(db: Db, p: Period, notCounted: readonly string[]) {
    const r = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN pr.purchase_price_kopecks IS NOT NULL THEN i.line_kopecks - i.qty * pr.purchase_price_kopecks END), 0) AS margin,
                COALESCE(SUM(CASE WHEN pr.purchase_price_kopecks IS NOT NULL THEN i.line_kopecks END), 0) AS covered_revenue,
                COALESCE(SUM(CASE WHEN pr.purchase_price_kopecks IS NOT NULL THEN 1 ELSE 0 END), 0) AS known_lines,
                COUNT(i.id) AS lines
           FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN products pr ON pr.id = i.product_id
          WHERE o.created_at >= ? AND o.created_at < ? AND o.is_paid = 1 AND o.status NOT IN (${marks(notCounted)})`,
      )
      .get(p.from, p.to, ...notCounted) as { margin: number; covered_revenue: number; known_lines: number; lines: number };
    return { marginKopecks: Number(r.margin), coveredRevenueKopecks: Number(r.covered_revenue), knownLines: Number(r.known_lines), lines: Number(r.lines) };
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
