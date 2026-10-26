import { describe, expect, it, vi } from 'vitest';
import type { Permission, StaffSession } from '@/domain/admin/permissions';
import { dashboard } from '@/domain/analytics/dashboard';
import { parseDashboardPeriod } from '@/domain/analytics/period';
import { auditRepo } from '@/server/db/repositories/audit';
import { UnauthorizedError } from '@/server/http/errors';
import { createTestDb } from '@/server/db/testing';
import { admin, manager } from '../admin/helpers';
import { ms, seedOctober, seedOrder } from './helpers';

const NOW = ms('2026-10-22T12:00:00+03:00');
const OCT = parseDashboardPeriod({ from: '2026-10-01', to: '2026-10-31' }, NOW).range;
const only = (...permissions: Permission[]): StaffSession => ({ staffId: 9, email: 'x@shop.test', name: null, role: 'custom', permissions });

describe('период Обзора', () => {
  it('сегодня — московские сутки: 01:30 по Москве уже следующая дата, хотя по UTC ещё вчера', () => {
    const now = Date.parse('2026-10-22T22:30:00Z'); // 23 октября 01:30 МСК
    const { preset, range } = parseDashboardPeriod({ period: 'today' }, now);
    expect(preset).toBe('today');
    expect(range).toEqual({ from: ms('2026-10-23T00:00:00+03:00'), to: ms('2026-10-24T00:00:00+03:00'), fromStr: '2026-10-23', toStr: '2026-10-23' });
  });

  it('7 дней включают сегодня, месяц — с 1-го числа до начала следующего, 30 дней — по умолчанию', () => {
    expect(parseDashboardPeriod({ period: '7d' }, NOW).range).toMatchObject({ fromStr: '2026-10-16', toStr: '2026-10-22' });
    expect(parseDashboardPeriod({ period: 'month' }, NOW).range).toMatchObject({ fromStr: '2026-10-01', toStr: '2026-10-31', to: ms('2026-11-01T00:00:00+03:00') });
    expect(parseDashboardPeriod({}, NOW)).toMatchObject({ preset: '30d', range: { fromStr: '2026-09-23', toStr: '2026-10-22' } });
    expect(parseDashboardPeriod({ period: 'month' }, ms('2026-12-15T12:00:00+03:00')).range.toStr).toBe('2026-12-31');
  });

  it('свой диапазон: «по» включительно; перевёрнутый или мусор → 30 дней', () => {
    const r = parseDashboardPeriod({ from: '2026-10-10', to: '2026-10-11' }, NOW);
    expect(r.preset).toBe('custom');
    expect(r.range).toMatchObject({ from: ms('2026-10-10T00:00:00+03:00'), to: ms('2026-10-12T00:00:00+03:00') });
    expect(parseDashboardPeriod({ from: '2026-10-11', to: '2026-10-10' }, NOW).preset).toBe('30d');
    expect(parseDashboardPeriod({ from: 'abc', to: '2026-02-31' }, NOW).preset).toBe('30d');
    expect(parseDashboardPeriod({ period: ['7d', 'x'] }, NOW).preset).toBe('7d');
  });
});

describe('dashboard: агрегаты на наборе заказов', () => {
  it('карточки считаются по реальным заказам; деньги — целые копейки оплаченных неотменённых', () => {
    const db = createTestDb();
    seedOctober(db);
    const d = dashboard(admin, OCT, 'day', { db, now: NOW });
    expect(d.cards.orders).toEqual({ created: 5, counted: 3 });
    expect(d.cards.revenue).toEqual({ kopecks: 400_000, paidOrders: 2, averageCheckKopecks: 200_000 });
    expect(d.cards.products).toEqual({ visible: 2, total: 2 });
    expect(d.sales?.series.map((r) => [r.bucket, r.orders, r.revenueKopecks])).toEqual([
      ['2026-10-10', 2, 400_000],
      ['2026-10-11', 1, 0],
    ]);
    expect(d.emptyShop).toBe(false);
    expect(Number.isInteger(d.cards.revenue!.kopecks)).toBe(true);
  });

  it('граница суток по Москве: заказ в 01:00 МСК 11 октября не попадает в 10 октября', () => {
    const db = createTestDb();
    seedOctober(db);
    const day10 = parseDashboardPeriod({ from: '2026-10-10', to: '2026-10-10' }, NOW).range;
    const day11 = parseDashboardPeriod({ from: '2026-10-11', to: '2026-10-11' }, NOW).range;
    expect(dashboard(admin, day10, 'day', { db, now: NOW }).cards.orders).toEqual({ created: 2, counted: 2 });
    expect(dashboard(admin, day11, 'day', { db, now: NOW }).cards.orders).toEqual({ created: 1, counted: 1 });
  });

  it('популярные товары — по проданным единицам оплаченных заказов', () => {
    const db = createTestDb();
    const { a, b } = seedOctober(db);
    seedOrder(db, { at: '2026-10-13T10:00:00+03:00', status: 'delivered', paid: true, total: 500_000, lines: [[b, 5, 100_000]] });
    const d = dashboard(admin, OCT, 'day', { db, now: NOW });
    expect(d.popular?.map((p) => [p.productId, p.units])).toEqual([[b, 6], [a, 3]]);
  });

  it('требуют внимания: новый и неоплаченный дольше 24 часов; свежий не попадает', () => {
    const db = createTestDb();
    seedOrder(db, { at: '2026-10-20T10:00:00+03:00', status: 'new', total: 10_000 });
    seedOrder(db, { at: '2026-10-21T10:00:00+03:00', status: 'awaiting_payment', total: 20_000 });
    seedOrder(db, { at: '2026-10-22T09:00:00+03:00', status: 'new', total: 30_000 });
    const d = dashboard(admin, OCT, 'day', { db, now: NOW });
    expect(d.attention.orders?.total).toBe(2);
    expect(d.attention.orders?.items.map((o) => o.status)).toEqual(['new', 'awaiting_payment']);
    expect(d.attention.integrations).toMatchObject({ total: 0 });
  });

  it('новые клиенты, обращения, ремонт и «нет в наличии» — из таблиц, а не из воздуха', () => {
    const db = createTestDb();
    const at = ms('2026-10-12T12:00:00+03:00');
    db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('a@x.test', 'h', ?), ('b@x.test', 'h', ?)").run(at, ms('2026-09-01T00:00:00+03:00'));
    const ins = db.prepare("INSERT INTO requests (number, kind, status, name, created_at, updated_at) VALUES (?, ?, 'new', 'И', ?, ?)");
    ins.run('MSG-1', 'contact', at, at);
    ins.run('ZV-1', 'callback', at, at);
    ins.run('REM-1', 'repair', at, at);
    seedOctober(db);
    db.prepare("UPDATE products SET availability = 'out_of_stock' WHERE name = 'Триммер B'").run();
    db.prepare("UPDATE products SET published = 0 WHERE name = 'Генератор A'").run();
    const d = dashboard(admin, OCT, 'day', { db, now: NOW });
    expect(d.cards).toMatchObject({ newCustomers: 1, newInquiries: 2, newRepairs: 1, outOfStock: 1, products: { visible: 1, total: 2 } });
  });

  it('последние заказы — реальные номера, новые сверху', () => {
    const db = createTestDb();
    seedOctober(db);
    const d = dashboard(admin, OCT, 'day', { db, now: NOW });
    expect(d.recentOrders).toHaveLength(6);
    expect(d.recentOrders![0]!.number).toMatch(/^RTS-/);
    const times = d.recentOrders!.map((o) => o.createdAt);
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  it('журнал администрирования — только с правом audit.read и без содержимого before/after', () => {
    const db = createTestDb();
    auditRepo.insert(db, { at: NOW, actorId: '1', actorType: 'staff', action: 'product.update', entity: 'product', entityId: '5', beforeJson: '{"secret":1}', afterJson: '{"secret":2}' });
    const d = dashboard(admin, OCT, 'day', { db, now: NOW });
    expect(d.audit).toHaveLength(1);
    expect(JSON.stringify(d.audit)).not.toContain('secret');
    expect(dashboard(only('orders.read'), OCT, 'day', { db, now: NOW }).audit).toBeNull();
  });
});

describe('dashboard: пустая база и права', () => {
  it('пустая база: нули, а не выдумки, и подсказки «что делать дальше»', () => {
    const db = createTestDb();
    const d = dashboard(admin, OCT, 'day', { db, now: NOW });
    expect(d.emptyShop).toBe(true);
    expect(d.cards.orders).toEqual({ created: 0, counted: 0 });
    expect(d.cards.revenue).toEqual({ kopecks: 0, paidOrders: 0, averageCheckKopecks: null });
    expect(d.cards).toMatchObject({ products: { visible: 0, total: 0 }, outOfStock: 0, newCustomers: 0, newInquiries: 0, newRepairs: 0 });
    expect(d.sales).toBeNull();
    expect(d.popular).toBeNull();
    expect(d.recentOrders).toEqual([]);
    expect(d.hints.map((h) => h.href)).toEqual(expect.arrayContaining(['/admin/import', '/admin/catalog/products/new', '/admin/orders']));
  });

  it('менеджер видит заказы, клиентов и обращения, но не выручку, график, журнал и интеграции', () => {
    const db = createTestDb();
    seedOctober(db);
    const d = dashboard(manager, OCT, 'day', { db, now: NOW });
    expect(d.cards.orders).toBeDefined();
    expect(d.cards.revenue).toBeUndefined();
    expect(d.sales).toBeNull();
    expect(d.audit).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/revenue/i);
  });

  it('роль без прав на разделы получает пустую панель', () => {
    const db = createTestDb();
    seedOctober(db);
    const d = dashboard(only('staff.self'), OCT, 'day', { db, now: NOW });
    expect(d.cards).toEqual({});
    expect(d.recentOrders).toBeNull();
    expect(d.popular).toBeNull();
    expect(d.attention.orders).toBeNull();
    expect(d.attention.integrations).toBeNull();
  });

  it('выручку даёт finance.read; без orders.read число заказов скрыто', () => {
    const db = createTestDb();
    seedOctober(db);
    const d = dashboard(only('finance.read'), OCT, 'day', { db, now: NOW });
    expect(d.cards.revenue?.kopecks).toBe(400_000);
    expect(d.cards.orders).toBeUndefined();
  });

  it('аноним → 401', () => {
    expect(() => dashboard(null, OCT, 'day', { db: createTestDb(), now: NOW })).toThrow(UnauthorizedError);
  });

  it('производительность: панель администратора — не более 14 запросов к БД (зафиксировано)', () => {
    const db = createTestDb();
    seedOctober(db);
    const spy = vi.spyOn(db, 'prepare');
    dashboard(admin, OCT, 'day', { db, now: NOW });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(14);
    expect(spy.mock.calls.length).toBeGreaterThan(5);
  });
});
