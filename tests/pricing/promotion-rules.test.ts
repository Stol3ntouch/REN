import { describe, expect, it } from 'vitest';
import { applyPromo, type PricedCart, type Promo } from '@/domain/pricing/promo';
import { periodsOverlap, promotionDiscount, promotionPrice } from '@/domain/pricing/promotion-rules';

const pct = (v: number, max: number | null = null) => ({ discountType: 'percent' as const, discountValue: v, maxDiscountKopecks: max });
const fixed = (v: number, max: number | null = null) => ({ discountType: 'fixed' as const, discountValue: v, maxDiscountKopecks: max });

describe('цена по акции (копейки, чистые функции)', () => {
  it('процент округляется вниз, фиксированная скидка вычитается', () => {
    expect(promotionDiscount(100_000, pct(15))).toBe(15_000);
    expect(promotionDiscount(99_999, pct(10))).toBe(9_999);
    expect(promotionPrice(100_000, fixed(25_000))).toBe(75_000);
  });

  it('скидка не делает цену ≤ 0 и не превышает цену: остаётся минимум 1 копейка', () => {
    expect(promotionPrice(50_000, fixed(50_000))).toBe(1);
    expect(promotionPrice(50_000, fixed(900_000))).toBe(1);
    expect(promotionDiscount(1, pct(50))).toBe(0);
    expect(promotionPrice(1, fixed(5))).toBeNull();
    expect(promotionPrice(0, pct(10))).toBeNull();
  });

  it('верхняя граница скидки ограничивает её; тип none цену не меняет', () => {
    expect(promotionDiscount(1_000_000, pct(50, 100_000))).toBe(100_000);
    expect(promotionPrice(1_000_000, { discountType: 'none', discountValue: 0, maxDiscountKopecks: null })).toBeNull();
  });

  it('периоды: пересечение с открытыми границами', () => {
    expect(periodsOverlap({ startsAt: null, endsAt: null }, { startsAt: 5, endsAt: 6 })).toBe(true);
    expect(periodsOverlap({ startsAt: 1, endsAt: 4 }, { startsAt: 5, endsAt: 6 })).toBe(false);
    expect(periodsOverlap({ startsAt: 1, endsAt: 5 }, { startsAt: 5, endsAt: 6 })).toBe(true);
    expect(periodsOverlap({ startsAt: 7, endsAt: null }, { startsAt: null, endsAt: 6 })).toBe(false);
  });
});

describe('купон: не действует на позиции по акции (excludeOnSale)', () => {
  const coupon: Promo = { code: 'X', type: 'percent', value: 10, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, minSubtotalKopecks: 0, enabled: true };
  const cart: PricedCart = {
    items: [
      { productId: 1, unit: 80_000, qty: 1, onSale: true },
      { productId: 2, unit: 20_000, qty: 2 },
    ],
    subtotal: 120_000,
  };

  it('без флага скидка считается от всей суммы', () => {
    expect(applyPromo(cart, coupon, new Date(0))).toEqual({ discount: 12_000 });
  });

  it('с флагом — только от позиций без акции', () => {
    expect(applyPromo(cart, { ...coupon, excludeOnSale: true }, new Date(0))).toEqual({ discount: 4_000 });
  });

  it('все позиции по акции — понятная ошибка, скидки нет', () => {
    const allSale: PricedCart = { items: [{ productId: 1, unit: 80_000, qty: 1, onSale: true }], subtotal: 80_000 };
    expect(applyPromo(allSale, { ...coupon, excludeOnSale: true }, new Date(0))).toEqual({ discount: 0, error: 'only_on_sale' });
  });

  it('фиксированный купон с флагом не превышает базу', () => {
    expect(applyPromo(cart, { ...coupon, type: 'fixed', value: 1_000_000, excludeOnSale: true }, new Date(0))).toEqual({ discount: 40_000 });
  });
});
