/**
 * Настройка фильтров по категории (C06) поверх общих фильтров каталога (C03).
 * Нет строки — фильтр как задан в «Фильтрах каталога». Строка категории: enabled = false прячет фильтр,
 * sort переопределяет порядок. Из цепочки «категория → предки» главнее ближайшая к категории строка,
 * поэтому настройка родителя действует на подкатегории, пока они не задали свою.
 */
export type CategoryFilterSetting = { categoryId: number; filterId: number; sort: number | null; enabled: boolean };

export function applyCategoryFilterSettings<T extends { id: number; sort: number; categorySettings: readonly { categoryId: number; sort: number | null; enabled: boolean }[] }>(
  filters: readonly T[],
  /** Категория и её предки, ближайшая первой. */
  chain: Iterable<number>,
): T[] {
  const order = [...chain];
  if (order.length === 0) return [...filters];
  const out: T[] = [];
  for (const f of filters) {
    let nearest: { sort: number | null; enabled: boolean } | undefined;
    let best = Infinity;
    for (const s of f.categorySettings) {
      const r = order.indexOf(s.categoryId);
      if (r >= 0 && r < best) {
        best = r;
        nearest = s;
      }
    }
    if (!nearest) out.push(f);
    else if (nearest.enabled) out.push(nearest.sort === null ? f : { ...f, sort: nearest.sort });
  }
  return out;
}
