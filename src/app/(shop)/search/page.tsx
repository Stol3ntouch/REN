import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { buildCatalogQueryString, parseCatalogParams } from '@/domain/catalog/params';
import { searchProducts } from '@/domain/catalog/search';
import { Breadcrumbs } from '@/ui/catalog/Breadcrumbs';
import { CatalogListing } from '@/ui/catalog/CatalogListing';
import { EmptyState } from '@/ui/states';
import '@/ui/catalog/catalog.css';

export const metadata: Metadata = { title: 'Поиск по каталогу', robots: { index: false, follow: false } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const query = parseCatalogParams(sp);
  const text = query.text?.trim() ?? '';

  const result = text === '' ? null : await searchProducts(query);
  if (result) {
    const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
    if (query.page > lastPage) {
      redirect(`/search?${buildCatalogQueryString(query, { page: lastPage })}`);
    }
  }

  return (
    <>
      <Breadcrumbs items={[]} current="Поиск" />
      <h1>{text === '' ? 'Поиск по каталогу' : `Результаты поиска: «${text}»`}</h1>
      <form className="search-page-form" role="search" action="/search" method="get">
        <label className="visually-hidden" htmlFor="search-page-q">
          Название, модель или артикул
        </label>
        <input id="search-page-q" name="q" type="search" defaultValue={text} maxLength={100} placeholder="Название, модель или артикул" autoComplete="off" />
        <button type="submit" className="button">
          Найти
        </button>
      </form>

      {result === null ? (
        <EmptyState title="Введите запрос">
          <p>Название товара, модель или артикул — например, «HT625R» или «бензоножницы».</p>
        </EmptyState>
      ) : result.total === 0 && Object.keys(query.filters).length === 0 && query.priceMin === undefined && query.priceMax === undefined && !query.inStockOnly ? (
        <EmptyState title="Ничего не найдено">
          <p>По запросу «{text}» товаров нет. Проверьте написание или попробуйте другое слово, часть названия или артикул.</p>
        </EmptyState>
      ) : (
        <CatalogListing basePath="/search" query={query} result={result} facets={[]} withRelevance />
      )}
    </>
  );
}
