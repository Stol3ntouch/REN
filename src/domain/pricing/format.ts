const NBSP = ' ';

/** Деньги из копеек в строку «1 234,50 ₽» (целые рубли — без копеек). Только для показа. */
export function formatRub(kopecks: number): string {
  const rub = kopecks / 100;
  const whole = Number.isInteger(rub);
  const text = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(rub);
  return `${text}${NBSP}₽`;
}

/** Ввод суммы в рублях («1 250,50», «500») → копейки; неверный формат → null. */
export function parseRubles(input: string): number | null {
  const t = input.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
