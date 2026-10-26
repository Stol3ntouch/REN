import { MoneyError, percentOf, taxAdded, taxIncluded, type Rounding } from './money';

/**
 * Надбавки заказа (C12, ADR-016): комиссия способа оплаты и налог. Чистые функции без БД — их же использует форма
 * оформления для показа, а сервер пересчитывает сам и результату из браузера не верит.
 *
 * Правила (явные):
 *  - комиссия = фиксированная часть + процент от (товары − скидка + известная доставка); доставка «рассчитает менеджер» в базу не входит;
 *  - налог считается по каждой позиции с её цены после доли скидки; доставка и комиссия налогом не облагаются;
 *  - налог «внутри цены» только раскрывается (итог не меняется), «сверху» — прибавляется к итогу;
 *  - округление процентов — по настройке (правило и шаг), деньги всегда целые копейки.
 */
export type FeeRule = { percentBp: number; fixedKopecks: number };
export type TaxRule = { rateBp: number; included: boolean };
export type ChargeRules = { fee: FeeRule; tax: TaxRule | null; rounding: Rounding };
export type TaxMode = 'included' | 'added';

export function paymentFee(baseKopecks: number, fee: FeeRule, rounding: Rounding): number {
  if (fee.fixedKopecks < 0 || !Number.isInteger(fee.fixedKopecks)) throw new MoneyError('Фиксированная комиссия: нужны целые копейки не меньше нуля');
  return fee.fixedKopecks + percentOf(baseKopecks, fee.percentBp, rounding.rule, rounding.step);
}

/** Делит скидку между строками пропорционально их сумме; остаток от деления достаётся последней строке. Сумма долей = скидке. */
export function allocateDiscount(lines: readonly number[], discountKopecks: number): number[] {
  const total = lines.reduce((a, b) => a + b, 0);
  if (discountKopecks < 0 || !Number.isInteger(discountKopecks)) throw new MoneyError('Скидка: нужны целые копейки не меньше нуля');
  if (discountKopecks > total) throw new MoneyError('Скидка больше суммы товаров');
  if (total === 0) return lines.map(() => 0);
  const shares = lines.map((l) => Number((BigInt(discountKopecks) * BigInt(l)) / BigInt(total)));
  const given = shares.reduce((a, b) => a + b, 0);
  const last = shares.length - 1;
  if (last >= 0) shares[last] = (shares[last] as number) + (discountKopecks - given);
  return shares;
}

export type OrderChargesInput = {
  /** Суммы строк (цена × количество). */
  lines: readonly number[];
  discountKopecks: number;
  /** null — доставку рассчитает менеджер. */
  deliveryKopecks: number | null;
  rules: ChargeRules;
};

export type OrderCharges = {
  feeKopecks: number;
  taxKopecks: number;
  taxMode: TaxMode | null;
  /** Налог по строкам (в том же порядке); пусто, если налога нет. */
  lineTaxKopecks: number[];
  totalKopecks: number;
};

export function orderCharges(input: OrderChargesInput): OrderCharges {
  const { rules } = input;
  const subtotal = input.lines.reduce((a, b) => a + b, 0);
  const delivery = input.deliveryKopecks ?? 0;
  const goodsAfterDiscount = subtotal - input.discountKopecks;
  if (goodsAfterDiscount < 0) throw new MoneyError('Скидка больше суммы товаров');

  const feeKopecks = paymentFee(goodsAfterDiscount + delivery, rules.fee, rules.rounding);

  let taxKopecks = 0;
  let lineTaxKopecks: number[] = [];
  let taxMode: TaxMode | null = null;
  if (rules.tax && rules.tax.rateBp > 0) {
    const shares = allocateDiscount(input.lines, input.discountKopecks);
    taxMode = rules.tax.included ? 'included' : 'added';
    const { rateBp, included } = rules.tax;
    lineTaxKopecks = input.lines.map((l, i) => {
      const base = l - (shares[i] as number);
      return included ? taxIncluded(base, rateBp, rules.rounding) : taxAdded(base, rateBp, rules.rounding);
    });
    taxKopecks = lineTaxKopecks.reduce((a, b) => a + b, 0);
  }

  const totalKopecks = goodsAfterDiscount + delivery + feeKopecks + (taxMode === 'added' ? taxKopecks : 0);
  return { feeKopecks, taxKopecks, taxMode, lineTaxKopecks, totalKopecks };
}
