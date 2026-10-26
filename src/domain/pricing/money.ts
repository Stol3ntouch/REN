/**
 * Деньги без плавающей арифметики (C12, ADR-016). Все суммы — целые копейки; дробные значения (процент от суммы,
 * налог внутри цены) представляются дробью «числитель / знаменатель» в копейках и округляются целочисленно (BigInt).
 * Отрицательные значения запрещены: возврат и скидка — отдельные поля, а не минус.
 */

export type RoundingRule = 'none' | 'down' | 'up' | 'nearest';
export type RoundingStep = 'kopeck' | 'ruble';
export const ROUNDING_RULES: readonly RoundingRule[] = ['none', 'down', 'up', 'nearest'];
export const ROUNDING_STEPS: readonly RoundingStep[] = ['kopeck', 'ruble'];
export type Rounding = { rule: RoundingRule; step: RoundingStep };

export const DEFAULT_ROUNDING: Readonly<Rounding> = { rule: 'nearest', step: 'kopeck' };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

const STEP_KOPECKS: Record<RoundingStep, bigint> = { kopeck: 1n, ruble: 100n };

function toBig(v: number | bigint, label: string): bigint {
  if (typeof v === 'bigint') {
    if (v < 0n) throw new MoneyError(`${label}: отрицательное значение недопустимо`);
    return v;
  }
  if (!Number.isInteger(v)) throw new MoneyError(`${label}: нужно целое число`);
  if (v < 0) throw new MoneyError(`${label}: отрицательное значение недопустимо`);
  return BigInt(v);
}

/**
 * Округляет дробь numerator/denominator (в копейках) до целого шага.
 *  - none: без дополнительного округления — до копейки (минимальная единица), половина вверх; шаг игнорируется;
 *  - down / up / nearest: к меньшему / большему / ближайшему (половина — вверх) кратному шагу (копейка или рубль).
 */
export function roundMoney(numerator: number | bigint, denominator: number | bigint, rule: RoundingRule = 'nearest', step: RoundingStep = 'kopeck'): number {
  const n = toBig(numerator, 'Сумма');
  const d = toBig(denominator, 'Знаменатель');
  if (d === 0n) throw new MoneyError('Знаменатель не может быть нулём');
  const effRule: Exclude<RoundingRule, 'none'> = rule === 'none' ? 'nearest' : rule;
  const unit = rule === 'none' ? 1n : STEP_KOPECKS[step];
  const dd = d * unit;
  const q = n / dd;
  const r = n % dd;
  let units = q;
  if (r > 0n) {
    if (effRule === 'up') units = q + 1n;
    else if (effRule === 'nearest' && r * 2n >= dd) units = q + 1n;
  }
  const out = units * unit;
  if (out > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyError('Сумма слишком велика');
  return Number(out);
}

/** Процент (в сотых долях процента: 150 = 1,5 %) от суммы в копейках. */
export function percentOf(kopecks: number, basisPoints: number, rule: RoundingRule = 'nearest', step: RoundingStep = 'kopeck'): number {
  return roundMoney(toBig(kopecks, 'Сумма') * toBig(basisPoints, 'Ставка'), 10_000n, rule, step);
}

/** Налог, начисляемый сверху на сумму без налога. */
export function taxAdded(netKopecks: number, rateBp: number, rounding: Rounding = DEFAULT_ROUNDING): number {
  return percentOf(netKopecks, rateBp, rounding.rule, rounding.step);
}

/** Налог, уже содержащийся в сумме с налогом: gross × ставка / (100 % + ставка). */
export function taxIncluded(grossKopecks: number, rateBp: number, rounding: Rounding = DEFAULT_ROUNDING): number {
  const rate = toBig(rateBp, 'Ставка');
  return roundMoney(toBig(grossKopecks, 'Сумма') * rate, 10_000n + rate, rounding.rule, rounding.step);
}
