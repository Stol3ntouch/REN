import { getDb, type Db } from '@/server/db/connection';
import { buildMatchQuery } from './fts';
import { categoryScope, countProducts, listCards, resolveSubcategories, type Scope } from './store';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type CatalogQuery, type SearchResult } from './types';

function empty(page: number, pageSize: number): SearchResult {
  return { items: [], total: 0, page, pageSize, hasMore: false };
}

/**
 * Поиск, фильтры, сортировка и страница каталога.
 * Пустой текст — без текстового отбора (листинг); текст без букв и цифр — ничего не найдено.
 * Порядок всегда завершается id: страницы не пересекаются и не прыгают.
 */
export async function searchProducts(q: CatalogQuery, opts: { db?: Db } = {}): Promise<SearchResult> {
  const db = opts.db ?? getDb();
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(q.pageSize ?? DEFAULT_PAGE_SIZE)));
  const page = Math.max(1, Math.trunc(q.page || 1));

  let categoryIds: number[] | undefined;
  if (q.categorySlug) {
    const scope = categoryScope(db, q.categorySlug);
    if (!scope) return empty(page, pageSize);
    categoryIds = scope.ids;
  }

  const text = (q.text ?? '').trim();
  let match: string | null = null;
  if (text !== '') {
    match = buildMatchQuery(text);
    if (match === null) return empty(page, pageSize);
  }

  const scope: Scope = {
    categoryIds,
    subCategoryIds: resolveSubcategories(db, categoryIds, q.subcategories),
    match,
    text: q.text,
    filters: q.filters,
    priceMin: q.priceMin,
    priceMax: q.priceMax,
    inStockOnly: q.inStockOnly,
    brands: q.brands,
    ranges: q.ranges,
  };
  const total = countProducts(db, scope);
  const offset = (page - 1) * pageSize;
  const items = listCards(db, scope, q.sort, pageSize, offset);
  return { items, total, page, pageSize, hasMore: offset + items.length < total };
}
