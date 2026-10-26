import { hasPermission, requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { NOT_COUNTED_STATUSES } from '@/domain/ordering/status';
import { getDb, type Db } from '@/server/db/connection';
import { analyticsRepo, type Bucket, type Period } from '@/server/db/repositories/analytics';
import { cancellations, rubles, salesByCategory, salesByProduct, salesSeries, salesSummary, toCsv } from './index';
import { canSeeMoney } from './dashboard';

type Opts = { db?: Db };
export const LOW_STOCK_THRESHOLD = 5;

/** Страница статистики: право stats.read (прежнее analytics.read тоже подходит). */
export function canStats(s: StaffSession): boolean {
  return hasPermission(s, 'stats.read') || hasPermission(s, 'analytics.read');
}
/** Маржа — закупочные цены: нужны и финансовые данные, и право products.cost. */
export function canSeeMargin(s: StaffSession): boolean {
  return canSeeMoney(s) && hasPermission(s, 'products.cost');
}
/** Выгрузка CSV: export.run при stats.read, либо прежнее analytics.read. */
export function canExportStats(s: StaffSession): boolean {
  return hasPermission(s, 'analytics.read') || (hasPermission(s, 'stats.read') && hasPermission(s, 'export.run'));
}

export const REVENUE_DEFINITION =
  'Выручка — сумма оплаченных заказов (is_paid) за вычетом отменённых, возвращённых и с ошибкой оплаты; заказ относится к дню его создания по Москве. Заказы с оплатой при получении учитываются после того, как оплата отмечена.';

export type StatsReport = {
  summary: ReturnType<typeof salesSummary>;
  /** null — у роли нет права на деньги. */
  money: boolean;
  series: ReturnType<typeof salesSeries>;
  statuses: ReturnType<typeof analyticsRepo.byStatus>;
  cancellations: ReturnType<typeof cancellations>;
  topProducts: ReturnType<typeof salesByProduct>;
  categories: ReturnType<typeof salesByCategory>;
  stock: ReturnType<typeof analyticsRepo.stockOverview>;
  customers: ReturnType<typeof analyticsRepo.customersSplit>;
  /** null — блок скрыт (нет права) или нет ни одной строки с закупочной ценой. */
  margin: (ReturnType<typeof analyticsRepo.margin> & { coveragePercent: number }) | null;
  marginHidden: 'permission' | 'no-cost' | null;
};

export const statsOps = {
  report(session: StaffSession | null, range: Period, bucket: Bucket, opts: Opts = {}): StatsReport {
    const s = requireStats(session);
    const db = opts.db ?? getDb();
    const money = canSeeMoney(s);
    const summary = salesSummary(range, { db });
    const hideMoney = <T extends { revenueKopecks: number }>(rows: T[]): T[] => (money ? rows : rows.map((r) => ({ ...r, revenueKopecks: 0 })));
    let margin: StatsReport['margin'] = null;
    let marginHidden: StatsReport['marginHidden'] = 'permission';
    if (canSeeMargin(s)) {
      const m = analyticsRepo.margin(db, range, NOT_COUNTED_STATUSES);
      marginHidden = m.knownLines > 0 ? null : 'no-cost';
      if (m.knownLines > 0) margin = { ...m, coveragePercent: Math.round((m.knownLines / m.lines) * 100) };
    }
    return {
      summary: money ? summary : { ...summary, revenueKopecks: 0, averageCheckKopecks: null },
      money,
      series: money ? salesSeries(range, bucket, { db }) : salesSeries(range, bucket, { db }).map((r) => ({ ...r, revenueKopecks: 0 })),
      statuses: analyticsRepo.byStatus(db, range),
      cancellations: cancellations(range, { db }),
      topProducts: hideMoney(salesByProduct(range, 10, { db })),
      categories: hideMoney(salesByCategory(range, { db })),
      stock: analyticsRepo.stockOverview(db, LOW_STOCK_THRESHOLD, 20),
      customers: analyticsRepo.customersSplit(db, range, NOT_COUNTED_STATUSES),
      margin,
      marginHidden,
    };
  },

  exportCsv(session: StaffSession | null, kind: StatsCsvKind, range: Period, bucket: Bucket, opts: Opts = {}): string {
    const s = requireStats(session);
    if (!canExportStats(s)) requirePermission(s, 'export.run');
    const db = opts.db ?? getDb();
    const money = canSeeMoney(s);
    if (kind === 'statuses') {
      return toCsv(['Статус', 'Заказов', ...(money ? ['Сумма, ₽'] : [])], analyticsRepo.byStatus(db, range).map((r) => [r.status, r.orders, ...(money ? [rubles(r.totalKopecks)] : [])]));
    }
    if (kind === 'stock') {
      const st = analyticsRepo.stockOverview(db, LOW_STOCK_THRESHOLD, 100);
      return toCsv(['Товар', 'Артикул', 'Свободный остаток'], st.low.map((r) => [r.name, r.sku ?? '', r.free]));
    }
    if (!money) requirePermission(s, 'finance.read');
    if (kind === 'categories') return toCsv(['Категория', 'Штук', 'Выручка, ₽'], salesByCategory(range, { db }).map((r) => [r.name, r.units, rubles(r.revenueKopecks)]));
    if (kind === 'products') return toCsv(['Товар', 'Артикул', 'Штук', 'Выручка, ₽'], salesByProduct(range, 500, { db }).map((r) => [r.name, r.sku ?? '', r.units, rubles(r.revenueKopecks)]));
    if (kind === 'cancellations') {
      const c = cancellations(range, { db });
      return toCsv(['Показатель', 'Заказов', 'Сумма, ₽'], [['Отменено', c.cancelled, rubles(c.cancelledKopecks)], ['Возвращено', c.refunded, rubles(c.refundedKopecks)]]);
    }
    return toCsv(['Период', 'Заказов', 'Выручка, ₽'], salesSeries(range, bucket, { db }).map((r) => [r.bucket, r.orders, rubles(r.revenueKopecks)]));
  },
};

export type StatsCsvKind = 'series' | 'categories' | 'products' | 'cancellations' | 'statuses' | 'stock';
export const STATS_CSV_KINDS: readonly StatsCsvKind[] = ['series', 'categories', 'products', 'cancellations', 'statuses', 'stock'];

function requireStats(session: StaffSession | null): StaffSession {
  if (!session) requirePermission(session, 'stats.read');
  const s = session as StaffSession;
  if (!canStats(s)) requirePermission(s, 'stats.read');
  return s;
}
