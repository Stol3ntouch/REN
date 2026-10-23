import { describe, expect, it } from 'vitest';
import { cancellations, newRequests, overview, parseRange, salesByCategory, salesByProduct, salesSeries, salesSummary } from '@/domain/analytics';
import { createTestDb } from '@/server/db/testing';
import { ms, seedOctober } from './helpers';

const OCT = { from: ms('2026-10-01T00:00:00+03:00'), to: ms('2026-11-01T00:00:00+03:00') };

describe('аналитика: агрегаты на заданном наборе заказов', () => {
  it('сводка: выручка только оплаченных не отменённых, заказы без отменённых, средний чек', () => {
    const db = createTestDb();
    seedOctober(db);
    expect(salesSummary(OCT, { db })).toEqual({
      ordersCreated: 5,
      ordersCounted: 3,
      paidOrders: 2,
      revenueKopecks: 400_000,
      averageCheckKopecks: 200_000,
    });
  });

  it('динамика по дням учитывает границы суток по Москве, по неделям (с понедельника) и месяцам', () => {
    const db = createTestDb();
    seedOctober(db);
    expect(salesSeries(OCT, 'day', { db })).toEqual([
      { bucket: '2026-10-10', orders: 2, revenueKopecks: 400_000 },
      { bucket: '2026-10-11', orders: 1, revenueKopecks: 0 },
    ]);
    expect(salesSeries(OCT, 'week', { db })).toEqual([{ bucket: '2026-10-05', orders: 3, revenueKopecks: 400_000 }]);
    expect(salesSeries(OCT, 'month', { db })).toEqual([{ bucket: '2026-10', orders: 3, revenueKopecks: 400_000 }]);
  });

  it('по категориям и товарам: только строки оплаченных не отменённых заказов, по убыванию выручки', () => {
    const db = createTestDb();
    seedOctober(db);
    expect(salesByCategory(OCT, { db }).map((r) => [r.name, r.units, r.revenueKopecks])).toEqual([
      ['Генераторы', 3, 300_000],
      ['Триммеры', 1, 100_000],
    ]);
    expect(salesByProduct(OCT, 10, { db }).map((r) => [r.name, r.units, r.revenueKopecks])).toEqual([
      ['Генератор A', 3, 300_000],
      ['Триммер B', 1, 100_000],
    ]);
  });

  it('отмены и возвраты за период: количество, суммы и доля от созданных', () => {
    const db = createTestDb();
    seedOctober(db);
    expect(cancellations(OCT, { db })).toEqual({
      ordersCreated: 5,
      cancelled: 1,
      cancelledKopecks: 70_000,
      refunded: 1,
      refundedKopecks: 90_000,
      sharePercent: 40,
    });
  });

  it('пустой период → empty=true, а не нули под видом данных', () => {
    const db = createTestDb();
    seedOctober(db);
    const empty = { from: ms('2025-01-01T00:00:00+03:00'), to: ms('2025-02-01T00:00:00+03:00') };
    const o = overview(empty, 'day', { db, now: ms('2026-10-22T12:00:00Z') });
    expect(o.empty).toBe(true);
    expect(o.summary.averageCheckKopecks).toBeNull();
    expect(o.series).toEqual([]);
  });

  it('новые заявки: таблиц заявок ещё нет → available=false и нули', () => {
    const db = createTestDb();
    expect(newRequests(db)).toEqual({ available: false, repair: 0, callback: 0, question: 0, reviewsPending: 0 });
  });

  it('parseRange: даты по Москве, «по» включительно; мусор → последние 30 дней', () => {
    const now = ms('2026-10-22T12:00:00+03:00');
    expect(parseRange({ from: '2026-10-01', to: '2026-10-31' }, now)).toMatchObject({ from: OCT.from, to: OCT.to, fromStr: '2026-10-01', toStr: '2026-10-31' });
    const dflt = parseRange({ from: 'x', to: '2026-13-99' }, now);
    expect(dflt.toStr).toBe('2026-10-22');
    expect(dflt.fromStr).toBe('2026-09-23');
  });
});
