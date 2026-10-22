import Link from 'next/link';
import type { CatalogQuery, Facet } from '@/domain/catalog/types';

/** Сколько фильтров выбрано (для подписи кнопки на телефоне). */
export function countActiveFilters(q: Pick<CatalogQuery, 'filters' | 'priceMin' | 'priceMax' | 'inStockOnly'>): number {
  const attrs = Object.values(q.filters).reduce((n, v) => n + (v.length > 0 ? 1 : 0), 0);
  return attrs + (q.priceMin !== undefined || q.priceMax !== undefined ? 1 : 0) + (q.inStockOnly ? 1 : 0);
}

/**
 * Форма фильтров. Обычная GET-форма: работает без JS, «Применить» отправляет выбор и сбрасывает страницу
 * (поле page в форму не входит), «Сбросить» — ссылка на адрес без фильтров (текст поиска и сортировка сохраняются).
 */
export function FiltersPanel({
  action,
  query,
  facets,
  resetHref,
}: {
  action: string;
  query: CatalogQuery;
  facets: Facet[];
  resetHref: string;
}) {
  const priceMin = query.priceMin !== undefined ? Math.floor(query.priceMin / 100) : '';
  const priceMax = query.priceMax !== undefined ? Math.floor(query.priceMax / 100) : '';
  return (
    <form className="filters-form" action={action} method="get" aria-label="Фильтры товаров">
      {query.text ? <input type="hidden" name="q" value={query.text} /> : null}
      {query.sort !== (query.text ? 'relevance' : 'name') ? <input type="hidden" name="sort" value={query.sort} /> : null}

      <fieldset className="filters-group">
        <legend>Цена, ₽</legend>
        <div className="filters-price">
          <label>
            <span className="visually-hidden">Цена от, рублей</span>
            <input type="number" name="min" inputMode="numeric" min={0} placeholder="от" defaultValue={priceMin} />
          </label>
          <span aria-hidden="true">—</span>
          <label>
            <span className="visually-hidden">Цена до, рублей</span>
            <input type="number" name="max" inputMode="numeric" min={0} placeholder="до" defaultValue={priceMax} />
          </label>
        </div>
      </fieldset>

      <fieldset className="filters-group">
        <legend>Наличие</legend>
        <label className="filters-check">
          <input type="checkbox" name="stock" value="1" defaultChecked={Boolean(query.inStockOnly)} />
          <span>Только в наличии</span>
        </label>
      </fieldset>

      {facets.map((f, i) => {
        const selected = query.filters[String(f.id)] ?? [];
        return (
          <details key={f.id} className="filters-group filters-facet" open={i < 4 || selected.length > 0}>
            <summary>
              {f.name}
              {selected.length > 0 ? <span className="filters-facet__badge"> ({selected.length})</span> : null}
            </summary>
            <ul className="filters-facet__values">
              {f.values.map((v) => {
                const checked = selected.includes(v.value);
                return (
                  <li key={v.value}>
                    <label className="filters-check">
                      <input type="checkbox" name={`a${f.id}`} value={v.value} defaultChecked={checked} disabled={v.count === 0 && !checked} />
                      <span>{v.value}</span>
                      <span className="filters-check__count">{v.count}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}

      <div className="filters-actions">
        <button type="submit" className="button">
          Применить
        </button>
        <Link href={resetHref} className="button button--outline" prefetch={false}>
          Сбросить
        </Link>
      </div>
    </form>
  );
}
