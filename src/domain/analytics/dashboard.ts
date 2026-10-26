import { hasPermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { NOT_COUNTED_STATUSES } from '@/domain/ordering/status';
import { UnauthorizedError } from '@/server/http/errors';
import { getDb, type Db } from '@/server/db/connection';
import { analyticsRepo, type Bucket } from '@/server/db/repositories/analytics';
import { auditRepo } from '@/server/db/repositories/audit';
import { integrationAttention, type IntegrationAttention } from './index';
import type { DashboardRange } from './period';

const HOUR_MS = 3_600_000;

/** Через сколько часов «новый» или неоплаченный заказ считается требующим внимания. */
export const ATTENTION_AFTER_HOURS = 24;
export const DASHBOARD_RECENT_ORDERS = 8;
export const DASHBOARD_AUDIT_ROWS = 8;
export const DASHBOARD_POPULAR = 5;

/** Деньги (выручка, график) — финансовые данные. `analytics.read` — прежнее общее право, тоже даёт доступ. */
export function canSeeMoney(s: StaffSession): boolean {
  return hasPermission(s, 'finance.read') || hasPermission(s, 'analytics.read');
}
const has = (s: StaffSession, p: Permission): boolean => hasPermission(s, p);

export type DashboardHint = { text: string; href: string; linkLabel: string };

export type Dashboard = {
  range: DashboardRange;
  /** В магазине нет ни товаров, ни заказов, ни клиентов — показываем подсказки «что делать дальше». */
  emptyShop: boolean;
  /** Карточки: отсутствующее поле = у роли нет права, блока нет вообще. */
  cards: {
    orders?: { created: number; counted: number };
    revenue?: { kopecks: number; paidOrders: number; averageCheckKopecks: number | null };
    products?: { visible: number; total: number };
    outOfStock?: number;
    newCustomers?: number;
    newInquiries?: number;
    newRepairs?: number;
  };
  recentOrders: ReturnType<typeof analyticsRepo.recentOrders> | null;
  audit: { at: number; action: string; entity: string; entityId: string | null; actor: string | null }[] | null;
  sales: { series: { bucket: string; orders: number; revenueKopecks: number }[]; bucket: Bucket } | null;
  /** Без выручки: популярность — по штукам, деньги по товарам видны только в статистике. */
  popular: { productId: number | null; name: string; sku: string | null; units: number }[] | null;
  attention: {
    orders: ReturnType<typeof analyticsRepo.staleOrders> | null;
    integrations: IntegrationAttention | null;
    afterHours: number;
  };
  hints: DashboardHint[];
};

/**
 * Данные панели управления. Каждый блок собирается только при наличии права и считается по БД; того, на что
 * у роли нет права, нет и в ответе (запрос к БД не выполняется). Число запросов ограничено (тест фиксирует ≤ 14).
 */
export function dashboard(session: StaffSession | null, range: DashboardRange, bucket: Bucket, opts: { db?: Db; now?: number } = {}): Dashboard {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const canOrders = has(session, 'orders.read');
  const canProducts = has(session, 'products.read');
  const money = canSeeMoney(session);

  const counts = analyticsRepo.dashboardCounts(db, range);
  const cards: Dashboard['cards'] = {};
  let summary: ReturnType<typeof analyticsRepo.summary> | null = null;
  if (canOrders || money) summary = analyticsRepo.summary(db, range, NOT_COUNTED_STATUSES);
  if (canOrders && summary) cards.orders = { created: summary.ordersCreated, counted: summary.ordersCounted };
  if (money && summary) {
    cards.revenue = { kopecks: summary.revenueKopecks, paidOrders: summary.paidOrders, averageCheckKopecks: summary.paidOrders > 0 ? Math.round(summary.revenueKopecks / summary.paidOrders) : null };
  }
  if (canProducts) {
    cards.products = { visible: counts.productsVisible, total: counts.productsTotal };
    cards.outOfStock = counts.outOfStock;
  }
  if (has(session, 'customers.read')) cards.newCustomers = counts.newCustomers;
  if (has(session, 'inquiries.read')) cards.newInquiries = counts.newInquiries;
  if (has(session, 'repair.write')) cards.newRepairs = counts.newRepairs;

  const sales = money && summary && summary.ordersCreated > 0 ? { series: analyticsRepo.series(db, range, bucket, NOT_COUNTED_STATUSES), bucket } : null;
  const popular = canOrders && summary && summary.ordersCreated > 0 ? analyticsRepo.byProduct(db, range, DASHBOARD_POPULAR, NOT_COUNTED_STATUSES, 'units').map(({ productId, name, sku, units }) => ({ productId, name, sku, units })) : null;
  const recentOrders = canOrders ? analyticsRepo.recentOrders(db, DASHBOARD_RECENT_ORDERS) : null;
  const audit = has(session, 'audit.read')
    ? auditRepo.search(db, { limit: DASHBOARD_AUDIT_ROWS }).rows.map((r) => ({ at: r.at, action: r.action, entity: r.entity, entityId: r.entityId, actor: r.actorLabel }))
    : null;

  const attention = {
    orders: canOrders ? analyticsRepo.staleOrders(db, now - ATTENTION_AFTER_HOURS * HOUR_MS, 5) : null,
    integrations: has(session, 'integrations.read') ? integrationAttention({ db, now }) : null,
    afterHours: ATTENTION_AFTER_HOURS,
  };

  const emptyShop = counts.productsTotal === 0 && counts.newCustomers === 0 && (summary?.ordersCreated ?? 0) === 0 && (recentOrders?.length ?? 0) === 0;
  const hints: DashboardHint[] = [];
  if (emptyShop) {
    if (canProducts && counts.productsTotal === 0) {
      if (has(session, 'import.run')) hints.push({ text: 'В каталоге пока нет товаров. Загрузите каталог из файла YML.', href: '/admin/import', linkLabel: 'Импорт каталога' });
      if (has(session, 'products.write')) hints.push({ text: 'Или добавьте первый товар вручную.', href: '/admin/catalog/products/new', linkLabel: 'Добавить товар' });
    }
    if (canOrders) hints.push({ text: 'Заказов пока нет. Они появятся здесь после первого оформления на сайте.', href: '/admin/orders', linkLabel: 'Раздел «Заказы»' });
    if (has(session, 'settings.write')) hints.push({ text: 'Проверьте контакты и реквизиты магазина.', href: '/admin/settings/store', linkLabel: 'Настройки магазина' });
  }

  return { range, emptyShop, cards, recentOrders, audit, sales, popular, attention, hints };
}
