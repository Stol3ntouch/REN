import { describe, expect, it } from 'vitest';
import { applyPromo, normalizePromoCode, type PricedCart, type Promo } from '@/domain/pricing';

const NOW = new Date(Date.UTC(2026, 9, 22, 12, 0, 0));
const DAY = 86_400_000;
const cart = (subtotal: number): PricedCart => ({ items: [{ productId: 1, unit: subtotal, qty: 1 }], subtotal });
const promo = (over: Partial<Promo> = {}): Promo => ({
  code: 'AUTUMN',
  type: 'percent',
  value: 10,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usedCount: 0,
  minSubtotalKopecks: 0,
  enabled: true,
  ...over,
});

describe('applyPromo', () => {
  it('нет промокода — скидки нет и ошибки нет', () => {
    expect(applyPromo(cart(100_000), null, NOW)).toEqual({ discount: 0 });
  });

  it('процент: от суммы товаров, округление вниз до копейки', () => {
    expect(applyPromo(cart(100_000), promo({ value: 10 }), NOW)).toEqual({ discount: 10_000 });
    expect(applyPromo(cart(99_999), promo({ value: 10 }), NOW)).toEqual({ discount: 9_999 });
  });

  it('фиксированная сумма в копейках', () => {
    expect(applyPromo(cart(100_000), promo({ type: 'fixed', value: 25_000 }), NOW)).toEqual({ discount: 25_000 });
  });

  it('фиксированная скидка не превышает сумму корзины', () => {
    expect(applyPromo(cart(10_000), promo({ type: 'fixed', value: 50_000 }), NOW)).toEqual({ discount: 10_000 });
  });

  it('период: до начала и после окончания — ошибки, внутри и на границах — действует', () => {
    const p = promo({ startsAt: NOW.getTime() - DAY, endsAt: NOW.getTime() + DAY });
    expect(applyPromo(cart(100_000), p, NOW).error).toBeUndefined();
    expect(applyPromo(cart(100_000), promo({ startsAt: NOW.getTime() + 1 }), NOW)).toEqual({ discount: 0, error: 'not_started' });
    expect(applyPromo(cart(100_000), promo({ endsAt: NOW.getTime() - 1 }), NOW)).toEqual({ discount: 0, error: 'expired' });
    expect(applyPromo(cart(100_000), promo({ startsAt: NOW.getTime(), endsAt: NOW.getTime() }), NOW).error).toBeUndefined();
  });

  it('лимит использований: исчерпан — ошибка; не исчерпан — действует', () => {
    expect(applyPromo(cart(100_000), promo({ usageLimit: 5, usedCount: 5 }), NOW)).toEqual({ discount: 0, error: 'limit_reached' });
    expect(applyPromo(cart(100_000), promo({ usageLimit: 5, usedCount: 4 }), NOW).error).toBeUndefined();
  });

  it('минимальная сумма: меньше — ошибка, ровно минимум — действует', () => {
    const p = promo({ minSubtotalKopecks: 300_000 });
    expect(applyPromo(cart(299_999), p, NOW)).toEqual({ discount: 0, error: 'min_subtotal' });
    expect(applyPromo(cart(300_000), p, NOW).error).toBeUndefined();
  });

  it('выключенный промокод — ошибка', () => {
    expect(applyPromo(cart(100_000), promo({ enabled: false }), NOW)).toEqual({ discount: 0, error: 'disabled' });
  });

  it('у каждой ошибки есть понятное сообщение на русском', async () => {
    const { PROMO_MESSAGES } = await import('@/domain/pricing');
    for (const code of ['not_found', 'disabled', 'not_started', 'expired', 'limit_reached', 'min_subtotal'] as const) {
      expect(PROMO_MESSAGES[code]).toMatch(/[а-яё]/i);
    }
  });

  it('normalizePromoCode: обрезает пробелы и поднимает регистр', () => {
    expect(normalizePromoCode('  autumn-10 ')).toBe('AUTUMN-10');
  });
});
