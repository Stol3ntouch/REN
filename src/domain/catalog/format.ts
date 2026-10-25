import { currencySymbol } from '@/domain/pricing/format';
const NBSP = ' ';

/** Копейки → «32 990 ₽» (неразрывные пробелы); копейки показываются, только если они есть. */
export function formatPrice(kopecks: number): string {
  const rubles = Math.trunc(kopecks / 100);
  const cents = Math.abs(kopecks % 100);
  const grouped = String(rubles).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${grouped}${cents > 0 ? `,${String(cents).padStart(2, '0')}` : ''}${NBSP}${currencySymbol()}`;
}

/** Русское склонение: pluralize(2, ['товар', 'товара', 'товаров']) → «товара». */
export function pluralize(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
