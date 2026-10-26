import { describe, expect, it } from 'vitest';
import { createAnalyticsExportHandler, createStatsJsonHandler } from '@/app/admin/(panel)/_lib/analytics-handlers';
import type { Permission, StaffSession } from '@/domain/admin/permissions';
import { statsOps, STATS_CSV_KINDS } from '@/domain/analytics/stats';
import { ForbiddenError, UnauthorizedError } from '@/server/http/errors';
import { createTestDb } from '@/server/db/testing';
import { admin, manager } from '../admin/helpers';
import { ms, seedOctober, seedOrder } from './helpers';
import { req, staffCookies, T0 } from './staff-cookies';

const RANGE = { from: ms('2026-10-01T00:00:00+03:00'), to: ms('2026-11-01T00:00:00+03:00') };
const only = (...permissions: Permission[]): StaffSession => ({ staffId: 9, email: 'x@shop.test', name: null, role: 'custom', permissions });

describe('статистика: отчёт', () => {
  it('продажи, статусы, отмены, топ и категории считаются по набору заказов', () => {
    const db = createTestDb();
    seedOctober(db);
    const r = statsOps.report(admin, RANGE, 'day', { db });
    expect(r.summary).toMatchObject({ ordersCreated: 5, ordersCounted: 3, revenueKopecks: 400_000, averageCheckKopecks: 200_000 });
    expect(Object.fromEntries(r.statuses.map((s) => [s.status, s.orders]))).toEqual({ delivered: 1, processing: 1, new: 1, cancelled: 1, refunded: 1 });
    expect(r.cancellations).toMatchObject({ cancelled: 1, refunded: 1, sharePercent: 40 });
    expect(r.topProducts[0]).toMatchObject({ name: 'Генератор A', units: 3, revenueKopecks: 300_000 });
    expect(r.categories.map((c) => c.name).sort()).toEqual(['Генераторы', 'Триммеры']);
    expect(r.series.map((s) => s.bucket)).toEqual(['2026-10-10', '2026-10-11']);
  });

  it('клиенты: повторными считаются те, кто покупал и до периода; регистрации — отдельно', () => {
    const db = createTestDb();
    seedOctober(db); // все заказы — одного гостя; заказ 30 сентября вне периода, но раньше
    db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('n@x.test', 'h', ?)").run(ms('2026-10-05T10:00:00+03:00'));
    const r = statsOps.report(admin, RANGE, 'day', { db });
    expect(r.customers.registered).toBe(1);
    expect(r.customers.buyers).toBe(1);
    expect(r.customers.repeatBuyers).toBe(1);
    expect(r.customers.newBuyers).toBe(0);
  });

  it('остатки: нет в наличии и низкие (учёт включён, свободно 1..5)', () => {
    const db = createTestDb();
    const { a, b } = seedOctober(db);
    db.prepare("UPDATE products SET availability = 'out_of_stock' WHERE id = ?").run(b);
    db.prepare('UPDATE products SET stock_tracked = 1, stock_qty = 4, reserved_qty = 1 WHERE id = ?').run(a);
    const r = statsOps.report(admin, RANGE, 'day', { db });
    expect(r.stock.outOfStock).toBe(1);
    expect(r.stock.low).toEqual([{ productId: a, name: 'Генератор A', sku: expect.any(String), free: 3 }]);
  });

  it('маржа: нужны products.cost и finance.read; без закупочных цен блок скрыт с причиной', () => {
    const db = createTestDb();
    const { a } = seedOctober(db);
    expect(statsOps.report(admin, RANGE, 'day', { db })).toMatchObject({ margin: null, marginHidden: 'no-cost' });
    db.prepare('UPDATE products SET purchase_price_kopecks = 60000 WHERE id = ?').run(a);
    const withCost = statsOps.report(admin, RANGE, 'day', { db });
    // оплаченные строки: A×2 по 100000 (200000), B×1 (100000, цены нет), A×1 (100000) → маржа по A: 300000 − 3×60000 = 120000
    expect(withCost.margin).toMatchObject({ marginKopecks: 120_000, knownLines: 2, lines: 3, coveragePercent: 67 });
    const noCostRight = statsOps.report(only('stats.read', 'finance.read'), RANGE, 'day', { db });
    expect(noCostRight.margin).toBeNull();
    expect(noCostRight.marginHidden).toBe('permission');
    expect(statsOps.report(only('stats.read', 'products.cost'), RANGE, 'day', { db }).marginHidden).toBe('permission');
  });

  it('stats.read без finance.read: количества видны, денег в отчёте нет', () => {
    const db = createTestDb();
    seedOctober(db);
    const r = statsOps.report(only('stats.read'), RANGE, 'day', { db });
    expect(r.money).toBe(false);
    expect(r.summary.ordersCounted).toBe(3);
    expect(r.summary.revenueKopecks).toBe(0);
    expect(r.topProducts.every((p) => p.revenueKopecks === 0)).toBe(true);
  });

  it('права: менеджер → 403, аноним → 401', () => {
    const db = createTestDb();
    expect(() => statsOps.report(manager, RANGE, 'day', { db })).toThrow(ForbiddenError);
    expect(() => statsOps.report(null, RANGE, 'day', { db })).toThrow(UnauthorizedError);
  });
});

describe('статистика: CSV', () => {
  it('stats.read без export.run не выгружает; с export.run — выгружает, деньги только при finance.read', () => {
    const db = createTestDb();
    seedOctober(db);
    expect(() => statsOps.exportCsv(only('stats.read'), 'statuses', RANGE, 'day', { db })).toThrow(ForbiddenError);
    const noMoney = statsOps.exportCsv(only('stats.read', 'export.run'), 'statuses', RANGE, 'day', { db });
    expect(noMoney).toContain('Статус;Заказов\r\n');
    expect(() => statsOps.exportCsv(only('stats.read', 'export.run'), 'series', RANGE, 'day', { db })).toThrow(ForbiddenError);
    const csv = statsOps.exportCsv(only('stats.read', 'export.run', 'finance.read'), 'series', RANGE, 'day', { db });
    expect(csv).toContain('2026-10-10;2;4000,00');
  });

  it('все виды выгрузки работают у администратора и формула в названии товара экранируется', () => {
    const db = createTestDb();
    const { a } = seedOctober(db);
    db.prepare("UPDATE products SET name = '=HYPERLINK(1)' WHERE id = ?").run(a);
    db.prepare("UPDATE order_items SET name = '=HYPERLINK(1)' WHERE product_id = ?").run(a);
    for (const k of STATS_CSV_KINDS) expect(statsOps.exportCsv(admin, k, RANGE, 'day', { db }).startsWith('﻿')).toBe(true);
    expect(statsOps.exportCsv(admin, 'products', RANGE, 'day', { db })).toContain("'=HYPERLINK(1)");
  });
});

describe('статистика: обработчики', () => {
  it('GET /admin/api/stats: JSON для администратора, 403 менеджеру, 401 без входа; export — CSV с вложением', async () => {
    const db = createTestDb();
    seedOctober(db);
    const c = await staffCookies(db);
    const stats = createStatsJsonHandler({ db, now: T0 });
    const exp = createAnalyticsExportHandler({ db, now: T0 });
    const q = '?from=2026-10-01&to=2026-10-31';
    expect((await stats(req('http://shop.test/admin/api/stats' + q))).status).toBe(401);
    expect((await stats(req('http://shop.test/admin/api/stats' + q, { cookie: c.manager }))).status).toBe(403);
    const ok = await stats(req('http://shop.test/admin/api/stats' + q, { cookie: c.admin }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).report.summary.revenueKopecks).toBe(400_000);
    const csv = await exp(req('http://shop.test/admin/analytics/export?kind=statuses&from=2026-10-01&to=2026-10-31', { cookie: c.admin }));
    expect(csv.headers.get('content-disposition')).toContain('analytics-statuses-2026-10-01_2026-10-31.csv');
    expect((await exp(req('http://shop.test/admin/analytics/export?kind=zzz', { cookie: c.admin }))).status).toBe(400);
    expect((await exp(req('http://shop.test/admin/analytics/export?kind=series', { cookie: c.manager }))).status).toBe(403);
  });
});

describe('статистика: пустая база', () => {
  it('нули без ошибок', () => {
    const r = statsOps.report(admin, RANGE, 'day', { db: createTestDb() });
    expect(r.summary).toMatchObject({ ordersCreated: 0, revenueKopecks: 0, averageCheckKopecks: null });
    expect(r.series).toEqual([]);
    expect(r.statuses).toEqual([]);
    expect(r.customers).toEqual({ registered: 0, buyers: 0, repeatBuyers: 0, newBuyers: 0 });
    expect(r.stock).toMatchObject({ outOfStock: 0, lowTotal: 0, low: [] });
  });

  it('seedOrder используется для проверки границ: заказ вне периода не попадает', () => {
    const db = createTestDb();
    seedOrder(db, { at: '2026-11-01T00:00:00+03:00', status: 'delivered', paid: true, total: 5_000 });
    expect(statsOps.report(admin, RANGE, 'day', { db }).summary.ordersCreated).toBe(0);
  });
});
