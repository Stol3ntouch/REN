import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from './url';

export type PageItem = number | 'gap';

/**
 * Номера страниц для строки пагинации: первая, последняя и окрестность текущей, пропуски — 'gap'.
 * 54 страницы, текущая 1 → 1 2 3 4 5 … 54.
 */
export function pageWindow(page: number, pageCount: number): PageItem[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const p = Math.min(Math.max(1, page), pageCount);
  if (p <= 4) return [1, 2, 3, 4, 5, 'gap', pageCount];
  if (p >= pageCount - 3) return [1, 'gap', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
  return [1, 'gap', p - 1, p, p + 1, 'gap', pageCount];
}

export const pageCountOf = (total: number, pageSize: number): number => Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));

/** «Показано 21–40 из 135»: границы для текущей страницы (0–0 при пустом списке). */
export function shownRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = (Math.max(1, page) - 1) * pageSize + 1;
  return { from: Math.min(from, total), to: Math.min(total, from + pageSize - 1) };
}

/** Допустимый размер страницы (10/20/50/100), иначе значение по умолчанию. */
export function clampPageSize(size: number): number {
  return (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE;
}
