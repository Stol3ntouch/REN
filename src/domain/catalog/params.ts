import { MAX_QUERY_LENGTH, type CatalogQuery, type SortKey } from './types';

/** Строка запроса из URL: URLSearchParams или объект searchParams страницы Next.js. */
export type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

const SORTS: readonly SortKey[] = ['name', 'popular', 'price_asc', 'price_desc', 'relevance'];
const MAX_PAGE = 1000;
const MAX_ATTRS = 12;
const MAX_VALUES_PER_ATTR = 30;
const MAX_VALUE_LENGTH = 200;
const ATTR_KEY = /^a(\d{1,9})$/;

function entries(raw: RawParams): [string, string][] {
  if (raw instanceof URLSearchParams) return [...raw.entries()];
  return Object.entries(raw).flatMap(([k, v]): [string, string][] => (v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]));
}

function first(list: [string, string][], key: string): string | undefined {
  return list.find(([k]) => k === key)?.[1];
}

function rublesToKopecks(v: string | undefined): number | undefined {
  if (v === undefined || !/^\d{1,9}$/.test(v.trim())) return undefined;
  return Number(v.trim()) * 100;
}

function defaultSort(hasText: boolean): SortKey {
  return hasText ? 'relevance' : 'name';
}

/**
 * URL → запрос каталога. Любой мусор приводится к безопасным значениям:
 * страница 1..1000, неизвестная сортировка → по умолчанию, текст ≤100 символов, ключи характеристик — только `a<число>`.
 * Параметры: q, sort, page, min/max (рубли), stock=1, a<id>=значение (повторяется).
 */
export function parseCatalogParams(raw: RawParams, base: { categorySlug?: string } = {}): CatalogQuery {
  const list = entries(raw);
  const text = (first(list, 'q') ?? '').slice(0, MAX_QUERY_LENGTH);

  const sortRaw = first(list, 'sort');
  const sortCandidate = SORTS.find((s) => s === sortRaw);
  // «relevance» осмысленна только при тексте
  const sort = sortCandidate && (sortCandidate !== 'relevance' || text.trim() !== '') ? sortCandidate : defaultSort(text.trim() !== '');

  const pageNum = Number(first(list, 'page'));
  const page = Number.isFinite(pageNum) ? Math.min(MAX_PAGE, Math.max(1, Math.trunc(pageNum))) : 1;

  const filters: Record<string, string[]> = {};
  for (const [k, v] of list) {
    const m = ATTR_KEY.exec(k);
    if (!m || v === '' || v.length > MAX_VALUE_LENGTH) continue;
    const id = m[1] as string;
    if (!(id in filters) && Object.keys(filters).length >= MAX_ATTRS) continue;
    const values = (filters[id] ??= []);
    if (values.length < MAX_VALUES_PER_ATTR && !values.includes(v)) values.push(v);
  }

  const q: CatalogQuery = { filters, sort, page };
  if (base.categorySlug) q.categorySlug = base.categorySlug;
  if (text !== '') q.text = text;
  const priceMin = rublesToKopecks(first(list, 'min'));
  const priceMax = rublesToKopecks(first(list, 'max'));
  if (priceMin !== undefined) q.priceMin = priceMin;
  if (priceMax !== undefined) q.priceMax = priceMax;
  if (first(list, 'stock') === '1') q.inStockOnly = true;
  return q;
}

/** Запрос → строка параметров URL без «?» (значения по умолчанию опускаются). overrides — поверх q. */
export function buildCatalogQueryString(q: CatalogQuery, overrides: Partial<CatalogQuery> = {}): string {
  const m: CatalogQuery = { ...q, ...overrides };
  const p = new URLSearchParams();
  const text = (m.text ?? '').trim();
  if (text !== '') p.set('q', text);
  if (m.sort !== defaultSort(text !== '')) p.set('sort', m.sort);
  if (m.page > 1) p.set('page', String(m.page));
  if (m.priceMin !== undefined) p.set('min', String(Math.floor(m.priceMin / 100)));
  if (m.priceMax !== undefined) p.set('max', String(Math.floor(m.priceMax / 100)));
  if (m.inStockOnly) p.set('stock', '1');
  for (const [id, values] of Object.entries(m.filters)) for (const v of values) p.append(`a${id}`, v);
  return p.toString();
}
