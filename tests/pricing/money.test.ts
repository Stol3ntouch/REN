import { describe, expect, it } from 'vitest';
import { MoneyError, percentOf, roundMoney, taxAdded, taxIncluded } from '@/domain/pricing/money';
import { allocateDiscount, orderCharges, paymentFee, type ChargeRules } from '@/domain/pricing/charges';

describe('roundMoney: дробь копеек → целые копейки', () => {
  it('граница 0,5: nearest — вверх, down — вниз, up — вверх', () => {
    expect(roundMoney(1, 2, 'nearest')).toBe(1);
    expect(roundMoney(1, 2, 'down')).toBe(0);
    expect(roundMoney(1, 2, 'up')).toBe(1);
    expect(roundMoney(499, 1000, 'nearest')).toBe(0);
    expect(roundMoney(501, 1000, 'nearest')).toBe(1);
  });

  it('none — это округление до копейки «половина вверх» и шаг рубля игнорируется', () => {
    expect(roundMoney(1, 2, 'none')).toBe(1);
    expect(roundMoney(1, 2, 'none', 'ruble')).toBe(1);
    expect(roundMoney(7, 3, 'none')).toBe(2);
  });

  it('точное деление не меняется ни при каком правиле', () => {
    for (const rule of ['none', 'down', 'up', 'nearest'] as const) expect(roundMoney(300, 3, rule)).toBe(100);
  });

  it('шаг «рубль»: результат кратен 100 копейкам', () => {
    expect(roundMoney(150, 1, 'nearest', 'ruble')).toBe(200);
    expect(roundMoney(149, 1, 'nearest', 'ruble')).toBe(100);
    expect(roundMoney(199, 1, 'down', 'ruble')).toBe(100);
    expect(roundMoney(101, 1, 'up', 'ruble')).toBe(200);
    expect(roundMoney(100, 1, 'up', 'ruble')).toBe(100);
    expect(roundMoney(0, 1, 'up', 'ruble')).toBe(0);
  });

  it('большие суммы без потери точности (BigInt внутри)', () => {
    const big = 9_000_000_000_000_000; // 90 трлн рублей в копейках
    expect(roundMoney(big, 1, 'nearest')).toBe(big);
    expect(roundMoney(big * 3, 4, 'down')).toBe(6_750_000_000_000_000);
  });

  it('отрицательные и нецелые значения, нулевой знаменатель — запрещены', () => {
    expect(() => roundMoney(-1, 2, 'nearest')).toThrow(MoneyError);
    expect(() => roundMoney(1, -2, 'nearest')).toThrow(MoneyError);
    expect(() => roundMoney(1, 0, 'nearest')).toThrow(MoneyError);
    expect(() => roundMoney(1.5, 1, 'nearest')).toThrow(MoneyError);
    expect(() => roundMoney(Number.NaN, 1, 'nearest')).toThrow(MoneyError);
  });

  it('результат больше безопасного целого — ошибка, а не тихая потеря точности', () => {
    expect(() => roundMoney(BigInt(Number.MAX_SAFE_INTEGER) * 10n, 1n, 'nearest')).toThrow(MoneyError);
  });
});

describe('процент и налог в сотых долях процента', () => {
  it('percentOf: 1,5% (150) от 1 000,00 ₽', () => {
    expect(percentOf(100_000, 150)).toBe(1_500);
    expect(percentOf(333, 150)).toBe(5); // 4,995 → 5
    expect(percentOf(333, 150, 'down')).toBe(4);
    expect(percentOf(100_000, 0)).toBe(0);
  });

  it('налог сверху: 20% (2000) от 1 000,00 ₽ = 200,00 ₽', () => {
    expect(taxAdded(100_000, 2000)).toBe(20_000);
  });

  it('налог внутри цены: 20% из 1 200,00 ₽ = 200,00 ₽; 10% из 110 = 10', () => {
    expect(taxIncluded(120_000, 2000)).toBe(20_000);
    expect(taxIncluded(110, 1000)).toBe(10);
    expect(taxIncluded(100, 2000)).toBe(17); // 16,666…
  });

  it('ставка 0 не даёт налога', () => {
    expect(taxAdded(100_000, 0)).toBe(0);
    expect(taxIncluded(100_000, 0)).toBe(0);
  });
});

describe('комиссия оплаты', () => {
  it('фикс + процент считаются явно: 30 ₽ + 1,5% от 2 000 ₽', () => {
    expect(paymentFee(200_000, { percentBp: 150, fixedKopecks: 3_000 }, { rule: 'nearest', step: 'kopeck' })).toBe(6_000);
  });
  it('правило округления из настроек применяется к проценту', () => {
    const r = { percentBp: 150, fixedKopecks: 0 };
    expect(paymentFee(333, r, { rule: 'down', step: 'kopeck' })).toBe(4);
    expect(paymentFee(333, r, { rule: 'up', step: 'kopeck' })).toBe(5);
    expect(paymentFee(10_000, r, { rule: 'up', step: 'ruble' })).toBe(200);
  });
  it('без комиссии — ноль', () => {
    expect(paymentFee(500_000, { percentBp: 0, fixedKopecks: 0 }, { rule: 'nearest', step: 'kopeck' })).toBe(0);
  });
});

describe('распределение скидки и итоги заказа', () => {
  it('скидка делится по строкам, сумма долей равна скидке', () => {
    const shares = allocateDiscount([10_000, 20_000, 30_001], 7_777);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(7_777);
    expect(shares.every((s) => s >= 0)).toBe(true);
  });
  it('скидка не больше суммы строк', () => {
    expect(() => allocateDiscount([100], 101)).toThrow(MoneyError);
  });

  const base: ChargeRules = { fee: { percentBp: 0, fixedKopecks: 0 }, tax: null, rounding: { rule: 'nearest', step: 'kopeck' } };

  it('без налога и комиссии итог = товары − скидка + доставка (как было до C12)', () => {
    const t = orderCharges({ lines: [100_000, 50_000], discountKopecks: 10_000, deliveryKopecks: 30_000, rules: base });
    expect(t).toMatchObject({ feeKopecks: 0, taxKopecks: 0, taxMode: null, totalKopecks: 170_000 });
  });

  it('комиссия считается от товаров − скидка + известная доставка', () => {
    const t = orderCharges({ lines: [100_000], discountKopecks: 0, deliveryKopecks: 10_000, rules: { ...base, fee: { percentBp: 200, fixedKopecks: 100 } } });
    expect(t.feeKopecks).toBe(2_300);
    expect(t.totalKopecks).toBe(112_300);
  });

  it('налог внутри цены не меняет итог, но попадает в строки', () => {
    const t = orderCharges({ lines: [120_000], discountKopecks: 0, deliveryKopecks: 0, rules: { ...base, tax: { rateBp: 2000, included: true } } });
    expect(t).toMatchObject({ taxKopecks: 20_000, taxMode: 'included', totalKopecks: 120_000 });
    expect(t.lineTaxKopecks).toEqual([20_000]);
  });

  it('налог сверху прибавляется к итогу', () => {
    const t = orderCharges({ lines: [100_000], discountKopecks: 10_000, deliveryKopecks: 0, rules: { ...base, tax: { rateBp: 2000, included: false } } });
    expect(t).toMatchObject({ taxKopecks: 18_000, taxMode: 'added', totalKopecks: 108_000 });
  });

  it('налог считается с цены после скидки, доля скидки по строкам', () => {
    const t = orderCharges({ lines: [60_000, 40_000], discountKopecks: 10_000, deliveryKopecks: 0, rules: { ...base, tax: { rateBp: 1000, included: false } } });
    expect(t.lineTaxKopecks.reduce((a, b) => a + b, 0)).toBe(t.taxKopecks);
    expect(t.taxKopecks).toBe(9_000);
  });
});
