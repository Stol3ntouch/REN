import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Next.js собирает instrumentation, route handlers и server actions в разные бандлы: модульные переменные
 * не общие. Подключения при старте обязаны жить на globalThis — иначе instrumentation подключит почту,
 * а обработчик заказа её «не увидит». Имитируем второй бандл повторным импортом модуля.
 */
afterEach(async () => {
  (await import('@/domain/catalog/popularity')).setPopularitySource(null);
  (await import('@/domain/admin/mail-enqueue')).setMailEnqueue(null);
  (await import('@/integrations/payment/service')).setPaymentRunLogger(null);
});

describe('подключения видны из другого экземпляра модуля', () => {
  it('источник популярности', async () => {
    const a = await import('@/domain/catalog/popularity');
    a.setPopularitySource(() => 'SELECT 1 AS id, 1 AS units');
    vi.resetModules();
    const b = await import('@/domain/catalog/popularity');
    expect(b).not.toBe(a);
    expect(b.getPopularitySql({} as never)).toBe('SELECT 1 AS id, 1 AS units');
  });

  it('очередь писем', async () => {
    const a = await import('@/domain/admin/mail-enqueue');
    const seen: string[] = [];
    a.setMailEnqueue((event) => seen.push(event));
    vi.resetModules();
    const b = await import('@/domain/admin/mail-enqueue');
    expect(b).not.toBe(a);
    b.enqueueMail('x.y', {});
    expect(seen).toEqual(['x.y']);
  });

  it('журнал платежей', async () => {
    const a = await import('@/integrations/payment/service');
    expect(typeof a.setPaymentRunLogger).toBe('function');
    const seen: string[] = [];
    a.setPaymentRunLogger((e) => seen.push(e.kind));
    vi.resetModules();
    const b = await import('@/integrations/payment/service');
    expect(b).not.toBe(a);
    expect(b.getPaymentRunLogger()).not.toBeNull();
  });
});
