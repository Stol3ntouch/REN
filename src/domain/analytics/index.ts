import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { moscowDayStart } from '@/domain/ordering/admin-ops';
import { NOT_COUNTED_STATUSES } from '@/domain/ordering/status';
import { getDb, type Db } from '@/server/db/connection';
import { analyticsRepo, type Bucket, type Period } from '@/server/db/repositories/analytics';
import { integrationRunsRepo } from '@/server/db/repositories/integration-runs';
import { paymentsRepo } from '@/server/db/repositories/payments';
import { webhookEventsRepo } from '@/server/db/repositories/webhook-events';

export type { Bucket, Period };
type Opts = { db?: Db };

const DAY_MS = 86_400_000;
const MSK_MS = 3 * 3600_000;
const dbOf = (o?: Opts): Db => o?.db ?? getDb();

// ───────── период ─────────

export type Range = Period & { fromStr: string; toStr: string };

const mskDate = (ms: number): string => new Date(ms + MSK_MS).toISOString().slice(0, 10);

/** Период из адресной строки: даты YYYY-MM-DD по Москве, «по» включительно. Невалидное → последние 30 дней. */
export function parseRange(sp: Record<string, unknown>, now: number = Date.now()): Range {
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const from = moscowDayStart(first(sp.from));
  const toStart = moscowDayStart(first(sp.to));
  if (from !== undefined && toStart !== undefined && from <= toStart) {
    return { from, to: toStart + DAY_MS, fromStr: String(first(sp.from)), toStr: String(first(sp.to)) };
  }
  const toStr = mskDate(now);
  const toDay = moscowDayStart(toStr)!;
  return { from: toDay - 29 * DAY_MS, to: toDay + DAY_MS, fromStr: mskDate(toDay - 29 * DAY_MS), toStr };
}

export function parseBucket(v: unknown): Bucket {
  const s = Array.isArray(v) ? v[0] : v;
  return s === 'week' || s === 'month' ? s : 'day';
}

// ───────── агрегаты ─────────

export type SalesSummary = {
  ordersCreated: number;
  /** Заказы без отменённых, возвращённых и с ошибкой оплаты. */
  ordersCounted: number;
  paidOrders: number;
  revenueKopecks: number;
  averageCheckKopecks: number | null;
};

/** Выручка — оплаченные (is_paid) заказы вне NOT_COUNTED_STATUSES; средний чек = выручка / число таких заказов. */
export function salesSummary(p: Period, o?: Opts): SalesSummary {
  const s = analyticsRepo.summary(dbOf(o), p, NOT_COUNTED_STATUSES);
  return { ...s, averageCheckKopecks: s.paidOrders > 0 ? Math.round(s.revenueKopecks / s.paidOrders) : null };
}

export function salesSeries(p: Period, g: Bucket, o?: Opts) {
  return analyticsRepo.series(dbOf(o), p, g, NOT_COUNTED_STATUSES);
}
export function salesByCategory(p: Period, o?: Opts) {
  return analyticsRepo.byCategory(dbOf(o), p, NOT_COUNTED_STATUSES);
}
export function salesByProduct(p: Period, limit = 20, o?: Opts) {
  return analyticsRepo.byProduct(dbOf(o), p, limit, NOT_COUNTED_STATUSES);
}

export type Cancellations = ReturnType<typeof analyticsRepo.cancellations> & { sharePercent: number };
export function cancellations(p: Period, o?: Opts): Cancellations {
  const c = analyticsRepo.cancellations(dbOf(o), p);
  const share = c.ordersCreated > 0 ? ((c.cancelled + c.refunded) / c.ordersCreated) * 100 : 0;
  return { ...c, sharePercent: Math.round(share * 10) / 10 };
}

export type Overview = { empty: boolean; summary: SalesSummary; series: ReturnType<typeof salesSeries> };
/** Показатели Обзора. empty=true, если за период не было ни одного заказа: страница пишет «нет данных». */
export function overview(p: Period, g: Bucket, o?: Opts & { now?: number }): Overview {
  const summary = salesSummary(p, o);
  return { empty: summary.ordersCreated === 0, summary, series: summary.ordersCreated === 0 ? [] : salesSeries(p, g, o) };
}

// ───────── заявки и ошибки интеграций ─────────

export type NewRequests = { available: boolean; repair: number; callback: number; question: number; reviewsPending: number };
type RequestsSource = (db: Db) => Omit<NewRequests, 'available'>;
let requestsSource: RequestsSource | null = null;

/** T09 регистрирует точный подсчёт новых заявок/вопросов/отзывов на модерации. До этого — осторожная проверка таблиц. */
export function setNewRequestsSource(fn: RequestsSource | null): void {
  requestsSource = fn;
}

/** Новые заявки. Нет таблиц (T09 ещё не создал) → available=false и нули, не выдуманные числа. */
export function newRequests(db: Db): NewRequests {
  const out: NewRequests = { available: false, repair: 0, callback: 0, question: 0, reviewsPending: 0 };
  try {
    if (requestsSource) return { available: true, ...requestsSource(db) };
    if (analyticsRepo.tableExists(db, 'requests')) {
      const cols = analyticsRepo.columnNames(db, 'requests');
      if (cols.includes('kind') && cols.includes('status')) {
        out.available = true;
        out.repair = analyticsRepo.countByKindStatus(db, 'requests', 'repair', 'new');
        out.callback = analyticsRepo.countByKindStatus(db, 'requests', 'callback', 'new');
        out.question = analyticsRepo.countByKindStatus(db, 'requests', 'question', 'new');
      }
    }
    if (analyticsRepo.tableExists(db, 'reviews') && analyticsRepo.columnNames(db, 'reviews').includes('status')) {
      out.available = true;
      out.reviewsPending = analyticsRepo.countWhereStatus(db, 'reviews', 'pending');
    }
  } catch {
    return { available: false, repair: 0, callback: 0, question: 0, reviewsPending: 0 };
  }
  return out;
}

export type IntegrationAttention = { failedRuns7d: number; paymentErrors: number; webhookAlerts: number; total: number };
export function integrationAttention(o?: Opts & { now?: number }): IntegrationAttention {
  const db = dbOf(o);
  const failedRuns7d = integrationRunsRepo.countErrorsSince(db, (o?.now ?? Date.now()) - 7 * DAY_MS);
  const paymentErrors = paymentsRepo.listErrors(db, { limit: 500 }).length;
  const webhookAlerts = webhookEventsRepo.listAttention(db, { limit: 500 }).length;
  return { failedRuns7d, paymentErrors, webhookAlerts, total: failedRuns7d + paymentErrors + webhookAlerts };
}

// ───────── CSV ─────────

const FORMULA_START = /^[=+\-@\t\r]/;

/** Ячейка CSV: текст с = + - @ (и табом/CR в начале) получает апостроф; числа не трогаются; спецсимволы — в кавычки. */
function cell(v: string | number): string {
  if (typeof v === 'number') return String(v);
  let s = v;
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 с BOM (Excel открывает кириллицу), разделитель «;» (русская локаль Excel), строки через CRLF. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

export const rubles = (kopecks: number): string => `${Math.trunc(kopecks / 100)},${String(Math.abs(kopecks) % 100).padStart(2, '0')}`;

export type CsvKind = 'series' | 'categories' | 'products' | 'cancellations';
export const CSV_KINDS: readonly CsvKind[] = ['series', 'categories', 'products', 'cancellations'];

export function exportCsv(kind: CsvKind, p: Period, g: Bucket, o?: Opts): string {
  if (kind === 'categories') {
    return toCsv(['Категория', 'Штук', 'Выручка, ₽'], salesByCategory(p, o).map((r) => [r.name, r.units, rubles(r.revenueKopecks)]));
  }
  if (kind === 'products') {
    return toCsv(['Товар', 'Артикул', 'Штук', 'Выручка, ₽'], salesByProduct(p, 500, o).map((r) => [r.name, r.sku ?? '', r.units, rubles(r.revenueKopecks)]));
  }
  if (kind === 'cancellations') {
    const c = cancellations(p, o);
    return toCsv(['Показатель', 'Заказов', 'Сумма, ₽'], [
      ['Отменено', c.cancelled, rubles(c.cancelledKopecks)],
      ['Возвращено', c.refunded, rubles(c.refundedKopecks)],
    ]);
  }
  return toCsv(['Период', 'Заказов', 'Выручка, ₽'], salesSeries(p, g, o).map((r) => [r.bucket, r.orders, rubles(r.revenueKopecks)]));
}

// ───────── операции с проверкой прав (страницы и обработчики зовут их) ─────────

export const analyticsOps = {
  report(session: StaffSession | null, range: Period, g: Bucket, o?: Opts & { now?: number }) {
    requirePermission(session, 'analytics.read');
    return {
      overview: overview(range, g, o),
      categories: salesByCategory(range, o),
      products: salesByProduct(range, 20, o),
      cancellations: cancellations(range, o),
    };
  },
  exportCsv(session: StaffSession | null, kind: CsvKind, range: Period, g: Bucket, o?: Opts): string {
    requirePermission(session, 'analytics.read');
    return exportCsv(kind, range, g, o);
  },
};
