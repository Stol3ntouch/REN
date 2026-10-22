import Link from 'next/link';
import type { ReactNode } from 'react';
import { buildCatalogQueryString } from '@/domain/catalog/params';
import { pluralize } from '@/domain/catalog/format';
import type { CatalogQuery, Facet, SearchResult, SortKey } from '@/domain/catalog/types';
import { EmptyState } from '../states';
import { FilterDrawer } from './FilterDrawer';
import { countActiveFilters, FiltersPanel } from './FiltersPanel';
import { LoadMoreGrid } from './LoadMoreGrid';
import { Pagination } from './Pagination';
import { SortLinks } from './SortLinks';

/**
 * Сетка товаров с фильтрами, сортировкой и страницами — общая часть страницы категории и поиска.
 * basePath — адрес страницы без параметров; apiCategory — slug категории для API «Показать ещё».
 */
export function CatalogListing({
  basePath,
  query,
  result,
  facets,
  apiCategory,
  emptyContent,
  withRelevance = false,
  sidebar,
}: {
  basePath: string;
  query: CatalogQuery;
  result: SearchResult;
  facets: Facet[];
  apiCategory?: string;
  /** Что показать, если товаров нет вовсе (без фильтров и текста): «Здесь пока нет товаров» и т. п. */
  emptyContent?: ReactNode;
  withRelevance?: boolean;
  /** Дерево категорий и т. п. над фильтрами. */
  sidebar?: ReactNode;
}) {
  const href = (overrides: Partial<CatalogQuery> = {}) => {
    const qs = buildCatalogQueryString(query, overrides);
    return qs === '' ? basePath : `${basePath}?${qs}`;
  };
  const resetQs = buildCatalogQueryString({ filters: {}, sort: query.sort, page: 1, text: query.text }, {});
  const resetHref = resetQs === '' ? basePath : `${basePath}?${resetQs}`;
  const active = countActiveFilters(query);
  const apiQuery = [apiCategory ? `category=${encodeURIComponent(apiCategory)}` : '', buildCatalogQueryString(query, { page: 1 })].filter(Boolean).join('&');

  return (
    <div className="catalog-layout">
      <aside className="catalog-aside" aria-label="Фильтры и категории">
        {sidebar}
        <FilterDrawer activeCount={active}>
          <FiltersPanel action={basePath} query={query} facets={facets} resetHref={resetHref} />
        </FilterDrawer>
      </aside>

      <section className="catalog-content" aria-label="Товары">
        <div className="catalog-toolbar">
          <p className="catalog-toolbar__count" role="status">
            Найдено: {result.total} {pluralize(result.total, ['товар', 'товара', 'товаров'])}
          </p>
          <SortLinks current={query.sort} hrefFor={(sort: SortKey) => href({ sort, page: 1 })} withRelevance={withRelevance} />
        </div>

        {result.items.length > 0 ? (
          <>
            <LoadMoreGrid
              key={buildCatalogQueryString(query)}
              initialItems={result.items}
              total={result.total}
              startPage={result.page}
              hasMore={result.hasMore}
              apiQuery={apiQuery}
            />
            <Pagination current={result.page} total={result.total} pageSize={result.pageSize} hrefFor={(page) => href({ page })} />
          </>
        ) : active > 0 || query.text ? (
          <EmptyState title="Ничего не найдено">
            <p>Попробуйте изменить условия поиска или снять часть фильтров.</p>
            {active > 0 ? (
              <p>
                <Link className="button button--outline" href={resetHref}>
                  Сбросить фильтры
                </Link>
              </p>
            ) : null}
          </EmptyState>
        ) : (
          emptyContent
        )}
      </section>
    </div>
  );
}
