import Link from 'next/link';
import type { CatalogQuery, Facet, FacetValue } from '@/domain/catalog/types';

type ActiveQuery = Pick<CatalogQuery, 'filters' | 'priceMin' | 'priceMax' | 'inStockOnly' | 'brands' | 'ranges' | 'subcategories'>;

/** Сколько фильтров выбрано (для подписи кнопки на телефоне). */
export function countActiveFilters(q: ActiveQuery): number {
  const attrs = Object.values(q.filters).reduce((n, v) => n + (v.length > 0 ? 1 : 0), 0);
  const ranges = Object.values(q.ranges ?? {}).reduce((n, r) => n + (r.min !== undefined || r.max !== undefined ? 1 : 0), 0);
  return (
    attrs +
    ranges +
    (q.brands && q.brands.length > 0 ? 1 : 0) +
    (q.subcategories && q.subcategories.length > 0 ? 1 : 0) +
    (q.priceMin !== undefined || q.priceMax !== undefined ? 1 : 0) +
    (q.inStockOnly ? 1 : 0)
  );
}

const labelOf = (v: FacetValue): string => v.label ?? v.value;

function Values({ name, values, selected }: { name: string; values: FacetValue[]; selected: string[] }) {
  return (
    <ul className="filters-facet__values">
      {values.map((v) => {
        const checked = selected.includes(v.value);
        return (
          <li key={v.value}>
            <label className="filters-check">
              <input type="checkbox" name={name} value={v.value} defaultChecked={checked} disabled={v.count === 0 && !checked} />
              <span>{labelOf(v)}</span>
              <span className="filters-check__count">{v.count}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function SelectOne({ name, label, values, selected }: { name: string; label: string; values: FacetValue[]; selected: string | undefined }) {
  return (
    <label className="filters-select">
      <span className="visually-hidden">{label}</span>
      <select name={name} defaultValue={selected ?? ''}>
        <option value="">Любой</option>
        {values.map((v) => (
          <option key={v.value} value={v.value} disabled={v.count === 0 && selected !== v.value}>
            {labelOf(v)} ({v.count})
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Форма фильтров, построенная из настроенных в админке фильтров (Facet[]): цена, наличие, бренд, подкатегории, характеристики.
 * Обычная GET-форма: работает без JS, «Применить» отправляет выбор и сбрасывает страницу
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

      {facets.map((f, i) => {
        if (f.kind === 'price') {
          return (
            <fieldset key={f.filterId} className="filters-group">
              <legend>{f.name}</legend>
              <div className="filters-price">
                <label>
                  <span className="visually-hidden">Цена от, рублей</span>
                  <input type="number" name="min" inputMode="numeric" min={0} placeholder={f.range ? `от ${f.range.min}` : 'от'} defaultValue={priceMin} />
                </label>
                <span aria-hidden="true">—</span>
                <label>
                  <span className="visually-hidden">Цена до, рублей</span>
                  <input type="number" name="max" inputMode="numeric" min={0} placeholder={f.range ? `до ${f.range.max}` : 'до'} defaultValue={priceMax} />
                </label>
              </div>
            </fieldset>
          );
        }
        if (f.kind === 'stock') {
          return (
            <fieldset key={f.filterId} className="filters-group">
              <legend>{f.name}</legend>
              <label className="filters-check">
                <input type="checkbox" name="stock" value="1" defaultChecked={Boolean(query.inStockOnly)} />
                <span>{f.values[0]?.label ?? 'Только в наличии'}</span>
              </label>
            </fieldset>
          );
        }

        const selected: string[] =
          f.kind === 'brand' ? (query.brands ?? []) : f.kind === 'category' ? (query.subcategories ?? []) : (query.filters[String(f.id)] ?? []);
        const range = f.kind === 'attribute' && f.widget === 'range' ? query.ranges?.[String(f.id)] : undefined;
        const active = f.widget === 'range' ? (range && (range.min !== undefined || range.max !== undefined) ? 1 : 0) : selected.length;
        return (
          <details key={f.filterId} className="filters-group filters-facet" open={i < 4 || active > 0}>
            <summary>
              {f.name}
              {f.unit ? <span className="filters-facet__unit">, {f.unit}</span> : null}
              {active > 0 ? <span className="filters-facet__badge"> ({active})</span> : null}
            </summary>
            {f.widget === 'range' ? (
              <div className="filters-price">
                <label>
                  <span className="visually-hidden">{f.name}: от</span>
                  <input type="number" step="any" name={`${f.key}_min`} inputMode="decimal" placeholder={f.range ? `от ${f.range.min}` : 'от'} defaultValue={range?.min ?? ''} />
                </label>
                <span aria-hidden="true">—</span>
                <label>
                  <span className="visually-hidden">{f.name}: до</span>
                  <input type="number" step="any" name={`${f.key}_max`} inputMode="decimal" placeholder={f.range ? `до ${f.range.max}` : 'до'} defaultValue={range?.max ?? ''} />
                </label>
              </div>
            ) : f.widget === 'select' ? (
              <SelectOne name={f.key} label={f.name} values={f.values} selected={selected[0]} />
            ) : (
              <Values name={f.key} values={f.values} selected={selected} />
            )}
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
