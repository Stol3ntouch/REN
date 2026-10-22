import { describe, expect, it } from 'vitest';
import { resolvePrice } from '@/domain/pricing';

describe('resolvePrice', () => {
  it('без скидочной цены — розничная, original не задан', () => {
    expect(resolvePrice({ priceKopecks: 1_000_00 })).toEqual({ unit: 1_000_00 });
    expect(resolvePrice({ priceKopecks: 1_000_00, discountPriceKopecks: null })).toEqual({ unit: 1_000_00 });
  });

  it('скидочная цена ниже розничной действует; original — розничная', () => {
    expect(resolvePrice({ priceKopecks: 1_000_00, discountPriceKopecks: 900_00 })).toEqual({ unit: 900_00, original: 1_000_00 });
  });

  it('скидочная цена равна розничной — не действует', () => {
    expect(resolvePrice({ priceKopecks: 1_000_00, discountPriceKopecks: 1_000_00 })).toEqual({ unit: 1_000_00 });
  });

  it('скидочная цена выше розничной — не действует', () => {
    expect(resolvePrice({ priceKopecks: 1_000_00, discountPriceKopecks: 1_200_00 })).toEqual({ unit: 1_000_00 });
  });

  it('нулевая скидочная цена считается ошибкой данных и не действует', () => {
    expect(resolvePrice({ priceKopecks: 1_000_00, discountPriceKopecks: 0 })).toEqual({ unit: 1_000_00 });
  });
});
