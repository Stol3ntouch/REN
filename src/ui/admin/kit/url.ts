/** Параметры адреса страницы (как их отдаёт Next: значение или массив значений). */
export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

export const firstParam = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

type Patch = Record<string, string | number | null | undefined>;

/**
 * Адрес страницы с изменёнными параметрами: текущие параметры сохраняются (фильтры, сортировка не теряются),
 * `patch` переопределяет их; null / undefined / '' — убирает параметр.
 */
export function buildHref(basePath: string, params: SearchParams, patch: Patch = {}): string {
  const qs = new URLSearchParams();
  for (const [k, raw] of Object.entries(params)) {
    if (k in patch) continue;
    const v = firstParam(raw);
    if (v !== '') qs.set(k, v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export type SortDir = 'asc' | 'desc';
export type ListParams = { page: number; pageSize: number; sort: string | null; dir: SortDir; q: string };

const positiveInt = (raw: string): number | null => {
  const n = Number(raw);
  return raw !== '' && Number.isInteger(n) && n >= 1 ? n : null;
};

/**
 * Единый разбор параметров списка из URL: page, pageSize (10/20/50/100), sort (только из разрешённых), dir, q.
 * Неверные значения заменяются значениями по умолчанию — список не падает от ручной правки адреса.
 */
export function parseListParams(
  sp: SearchParams,
  opts: { sorts?: readonly string[]; defaultSort?: string | null; defaultDir?: SortDir; defaultPageSize?: number } = {},
): ListParams {
  const size = positiveInt(firstParam(sp.pageSize));
  const fallbackSize = opts.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const sortRaw = firstParam(sp.sort);
  const sort = opts.sorts?.includes(sortRaw) ? sortRaw : (opts.defaultSort ?? null);
  const dirRaw = firstParam(sp.dir);
  return {
    page: positiveInt(firstParam(sp.page)) ?? 1,
    pageSize: size !== null && (PAGE_SIZES as readonly number[]).includes(size) ? size : fallbackSize,
    sort,
    dir: dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : (opts.defaultDir ?? 'asc'),
    q: firstParam(sp.q).trim().slice(0, 200),
  };
}

/** Следующий адрес для поиска: меняет один параметр и сбрасывает страницу. Работает с `location.search`. */
export function nextSearchHref(pathname: string, search: string, name: string, value: string, resetKeys: readonly string[] = ['page']): string {
  const qs = new URLSearchParams(search);
  const v = value.trim();
  if (v === '') qs.delete(name);
  else qs.set(name, v);
  for (const k of resetKeys) qs.delete(k);
  const s = qs.toString();
  return s ? `${pathname}?${s}` : pathname;
}
