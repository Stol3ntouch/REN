const NBSP = ' ';

/**
 * Символ валюты берётся из настроек магазина (C11). Деньги в системе всегда в копейках; валюта меняет только показ.
 * Поставщик ставится модулем настроек; на globalThis, чтобы он был общим для бандлов Next.
 */
const g = globalThis as unknown as { __rtsCurrencySymbol?: () => string };
export function setCurrencySymbolProvider(fn: (() => string) | null): void {
  if (fn) g.__rtsCurrencySymbol = fn;
  else delete g.__rtsCurrencySymbol;
}
export function currencySymbol(): string {
  try {
    return g.__rtsCurrencySymbol?.() || '₽';
  } catch {
    return '₽';
  }
}

/** Деньги из копеек в строку «1 234,50 ₽» (целые рубли — без копеек). Только для показа. */
export function formatRub(kopecks: number): string {
  const rub = kopecks / 100;
  const whole = Number.isInteger(rub);
  const text = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(rub);
  return `${text}${NBSP}${currencySymbol()}`;
}

/** Ввод суммы в рублях («1 250,50», «500») → копейки; неверный формат → null. */
export function parseRubles(input: string): number | null {
  const t = input.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
